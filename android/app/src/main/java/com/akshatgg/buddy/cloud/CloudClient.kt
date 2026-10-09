package com.akshatgg.buddy.cloud

import com.akshatgg.buddy.account.Account
import com.akshatgg.buddy.account.notSetUp
import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.AskInput
import com.akshatgg.buddy.ai.Prompts
import com.akshatgg.buddy.ai.providers.AI_TIMEOUT_MS
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.net.Http
import com.akshatgg.buddy.net.HttpRequest
import com.akshatgg.buddy.store.AppSettings
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.IOException
import java.net.URLEncoder
import java.util.Base64
import java.net.SocketTimeoutException

private const val FRESH_MS = 60_000L // settings fetched (or found out of reach, with some kept) less than this long ago are not fetched again
private const val CALL_TIMEOUT_MS = 30_000 // for calls that bring no deadline of their own
private const val CONFIG_TIMEOUT_MS = 8_000 // for the settings, which a request waits for before it goes anywhere
// For a recording: longer than the server waits for Groq (30 s, web/lib/transcribe.js), so that its own answer ("I
// couldn't write down what you said") comes first. As on the Mac (cloud.js).
private const val TRANSCRIBE_TIMEOUT_MS = 45_000
// For Claude mode's calls: a look comes every 1.5 s while the phone watches a session, so one that hangs is given up
// on sooner than other calls, and the next look tries again.
private const val REMOTE_TIMEOUT_MS = 10_000
private const val AUDIO_MAX_BYTES = 2_000_000 // about 2 MB: the most Buddy's server takes (the Mac's panel stops there too)
private val UNREACHABLE = listOf("network", "timeout", "server") // the server cannot be used now: fall back to what is kept
// The codes Buddy's server answers errors with: the keys of STATUS in web/lib/handlers.js, and `server` (which its
// handle() also answers for a failure of its own). An error answer with any other code comes from something in front
// of the server, such as the hosting platform.
private val SERVER_CODES = listOf(
    "bad_request", "free_no_vision", "unauthenticated", "blocked", "free_off", "not_admin", "not_found",
    "method_not_allowed", "free_limit", "upstream", "server", "voice_off", "voice_busy", "mac_offline",
)

private fun serverProblem() = BuddyError("server", "Buddy's server had a problem. Try again.")
private fun tookTooLong() = BuddyError("timeout", "Buddy's server took too long to answer. Try again.")

private fun JsonObject.string(name: String): String? = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

/** Buddy's server's own error in an answer, with a code it sends; null for anything else. */
private fun serverError(j: JsonObject?): BuddyError? {
    val e = j?.get("error") as? JsonObject ?: return null
    val code = e.string("code")
    val message = e.string("message")
    return if (code != null && code in SERVER_CODES && message != null) BuddyError(code, message) else null
}

/**
 * Buddy's server (web/): this person's free-mode settings (GET /api/config) and free answers (POST /api/ask), as the
 * Mac's cloud.js asks for them. Every call carries the signed-in person's ID token; one the server turns down is
 * renewed and the call made once more, and only the server's own "unauthenticated" after that signs the person out.
 * The last settings are kept in the app's settings (`cloud`), so Buddy still knows them after a restart without
 * internet.
 */
class CloudClient(
    private val http: Http,
    serverUrl: String,
    private val account: Account,
    private val settings: AppSettings,
    private val now: () -> Long = System::currentTimeMillis,
) {
    // The Mac keeps only the address's origin, so a path is never written twice.
    private val serverUrl = serverUrl.trim().trimEnd('/')

    private val state = MutableStateFlow(settings.cloud)

    /** The kept settings, told anew whenever they change. */
    val free: StateFlow<FreeSettings?> = state

    // Keeping or forgetting the settings, and the counters below, change together under this lock, so that settings
    // fetched on one thread are never kept after a forget() on another.
    private val lock = Any()
    private var fetchedAt: Long? = null // when the settings were last fetched in this run of the app, or found out of reach with some kept
    private var generation = 0 // one more with each forget(): settings fetched for an earlier one are not kept

    private suspend fun call(path: String, method: String = "GET", body: JsonObject? = null, timeoutMs: Int = CALL_TIMEOUT_MS, retried: Boolean = false): JsonObject {
        if (serverUrl.isEmpty()) throw notSetUp()
        val idToken = account.idToken(force = retried)
        val headers = buildMap {
            put("authorization", "Bearer $idToken")
            if (body != null) put("content-type", "application/json")
        }
        // A cancellation is passed through untouched, so callers can tell "cancelled" from "failed".
        val res = try {
            http.send(HttpRequest("$serverUrl$path", method, headers, body?.toString(), timeoutMs))
        } catch (e: SocketTimeoutException) {
            currentCoroutineContext().ensureActive()
            throw tookTooLong()
        } catch (e: IOException) {
            // Let go of, the read is interrupted and fails like no internet: a cancellation all the same.
            currentCoroutineContext().ensureActive()
            throw BuddyError("network", "Couldn't reach Buddy's server. Check your internet.")
        }
        val j = try { Json.parseToJsonElement(res.body) as? JsonObject } catch (e: Exception) { null } // not JSON: judged by the status below
        val own = serverError(j)
        if (res.status == 401) {
            // A token the server no longer takes: renew it once.
            if (!retried) return call(path, method, body, timeoutMs, retried = true)
            // Turned down again, with a token just renewed. Only the server's own answer means the sign-in is over: any
            // other 401 comes from something in front of it (a hosting page that wants a login of its own), and signing
            // the person out would not help them.
            if (own?.code != "unauthenticated") throw serverProblem()
            account.signOut()
            forget() // on the Mac, signing out tells cloud.js to forget; here both happen together
            throw BuddyError("signed_out", own.message ?: "")
        }
        if (res.status !in 200..299) throw own ?: serverProblem()
        return j ?: throw serverProblem()
    }

    fun last(): FreeSettings? = settings.cloud

    /**
     * Fetch the settings now, keep them, and say they changed. Settings that arrive after forget() are not kept: they
     * belong to the person who was signed out (or who someone else signed in over).
     */
    private suspend fun refresh(): FreeSettings? {
        val mine = synchronized(lock) { generation }
        val j = call("/api/config", timeoutMs = CONFIG_TIMEOUT_MS)
        synchronized(lock) {
            if (mine != generation) return last()
            val fetched = FreeSettings.read(j)
            settings.cloud = fetched
            state.value = fetched
            fetchedAt = now()
            return fetched
        }
    }

    /**
     * This person's free-mode settings: fetched again when the ones fetched in this run are a minute old (or with
     * `force`); the last known ones while the server cannot be reached (null if it never was). A server out of reach is
     * not asked again for a minute either, so that a server that hangs does not hold up every request until its
     * deadline -- but only when there are last known settings to go on with. With none, the next call asks again, so
     * that the first answer comes as soon as the server can give one.
     */
    suspend fun settings(force: Boolean = false): FreeSettings? {
        val (at, mine) = synchronized(lock) { fetchedAt to generation }
        if (!force && at != null && now() - at < FRESH_MS) return last()
        return try {
            refresh()
        } catch (e: BuddyError) {
            if (e.code !in UNREACHABLE) throw e
            synchronized(lock) {
                val kept = last()
                if (kept != null && mine == generation) fetchedAt = now()
                kept
            }
        }
    }

    /**
     * Forget the settings: when the person signs out, or someone else signs in, so that the next person does not
     * inherit them (or the admin's menu).
     */
    fun forget() = synchronized(lock) {
        generation += 1
        settings.cloud = null
        state.value = null
        fetchedAt = null
    }

    /** One free answer from the server. */
    suspend fun ask(action: Action, input: AskInput): Answer {
        val body = buildJsonObject {
            put("action", action.id)
            input.instruction?.let { put("instruction", it) }
            input.tone?.let { put("tone", it) }
            input.text?.let { put("text", it) }
            input.image?.let { put("image", it) }
            // A chat's inputs (shared/prompts.js chatPrompt), as the Mac's cloud.js sends them.
            input.message?.let { put("message", it) }
            input.selection?.let { put("selection", it) }
            input.box?.let { put("box", it) }
            input.history?.let { turns ->
                put("history", buildJsonArray { turns.forEach { add(buildJsonObject { put("from", it.from); put("text", it.text) }) } })
            }
            input.facts?.let { facts -> put("facts", buildJsonArray { facts.forEach { add(it) } }) }
            input.appName?.let { put("appName", it) }
            input.userName?.let { put("userName", it) }
            input.step?.let { put("step", it) }
        }
        // The Mac's panel gives a free answer the AI's own deadline (actions.js); here it is given where the call is made.
        val j = call("/api/ask", "POST", body, timeoutMs = AI_TIMEOUT_MS)
        val text = j.string("text") ?: throw serverProblem()
        val model = j.string("model") ?: ""
        // A Check is read here from the text, with the function the own-key route uses: what the server sends as its own
        // reading never reaches the panel. A chat is read by the router, on both routes.
        return Answer(text, model, if (action == Action.CHECK) Prompts.parseCheck(text) else null)
    }

    /** Whether the server can write down what is said (it has a Groq key): from the settings, off when they are unknown. */
    suspend fun voiceOn(): Boolean = settings()?.voiceOn == true

    /**
     * What was said in a recording (`audio`, of kind `mime`), written down by the server: the words, "" when none were
     * heard. An empty recording, or one larger than the server takes, is not sent.
     */
    suspend fun transcribe(audio: ByteArray, mime: String = "audio/mp4"): String {
        if (audio.isEmpty() || audio.size > AUDIO_MAX_BYTES) throw BuddyError("bad_request", "That recording didn't come through. Try again.")
        val body = buildJsonObject {
            put("audio", Base64.getEncoder().encodeToString(audio))
            put("mime", mime)
        }
        val j = call("/api/transcribe", "POST", body, timeoutMs = TRANSCRIBE_TIMEOUT_MS)
        return j.string("text") ?: throw serverProblem()
    }

    // ---- Claude mode: the Claude Code sessions on the person's computer (web/lib/remote.js) ----

    /**
     * Whether the person's computer shares its Claude Code sessions now, which, and with `session` that one's items
     * (once the computer has sent them). Looking at a session is what keeps it watched: the computer sends its items
     * only while the phone looks.
     */
    suspend fun remoteLook(session: String? = null): RemoteLook {
        val query = session?.let { "?session=" + URLEncoder.encode(it, "UTF-8") }.orEmpty()
        return RemoteLook.read(call("/api/remote/phone$query", timeoutMs = REMOTE_TIMEOUT_MS))
    }

    /** Words for a session's terminal: its computer types them in when it next reports. */
    suspend fun remoteSend(session: String, text: String) {
        val body = buildJsonObject {
            put("action", "send")
            put("session", session)
            put("text", text)
        }
        call("/api/remote/phone", "POST", body, timeoutMs = REMOTE_TIMEOUT_MS)
    }

    /** The phone stops watching: the computer stops sending the session's items, and the server drops them. */
    suspend fun remoteStop() {
        call("/api/remote/phone", "POST", buildJsonObject { put("action", "stop") }, timeoutMs = REMOTE_TIMEOUT_MS)
    }
}
