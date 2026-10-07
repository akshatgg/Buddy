package com.akshatgg.buddy.ai.providers

import android.util.Log
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.net.Http
import com.akshatgg.buddy.net.HttpRequest
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import java.io.IOException
import java.net.SocketTimeoutException

/** How long a provider gets to answer, reading the answer included. */
const val AI_TIMEOUT_MS = 60_000

/**
 * The HTTP plumbing every provider shares: one request, JSON in and out, and
 * provider failures turned into BuddyErrors whose messages can be shown to the
 * user as they are.
 */
object ProviderHttp {
    // A kind of error is a short identifier ("overloaded_error", "INVALID_ARGUMENT"). Nothing else from an
    // answer is ever logged: a provider can echo the person's own text back inside its message.
    private val TYPE_SHAPE = Regex("^[A-Za-z][A-Za-z0-9_.-]{0,63}$")
    private val NO_CREDIT = Regex("credit balance|insufficient_quota|exceeded your current quota|billing", RegexOption.IGNORE_CASE)
    private val BAD_MODEL = Regex("model.*(not found|does not exist|not supported)", RegexOption.IGNORE_CASE)

    private fun JsonObject.string(name: String): String? = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    /** What an error answer says: `text` is only for telling the kinds of failure apart; `type` is safe to log. */
    private fun readBody(body: String): Pair<String, String?> {
        val j = try { Json.parseToJsonElement(body) as? JsonObject } catch (e: Exception) { null }
            ?: return body.take(300) to null
        val error = j["error"] as? JsonObject
        val type = listOf(error?.string("type"), error?.string("status")).firstOrNull { it != null && TYPE_SHAPE.matches(it) }
        val text = listOf(error?.string("message"), error?.string("status"), j.string("message"))
            .firstOrNull { !it.isNullOrEmpty() } ?: body
        return text.take(300) to type
    }

    fun errorFromResponse(status: Int, body: String, label: String): BuddyError {
        val (text, type) = readBody(body)
        // The log gets the status and the kind of error, never the answer's own words.
        Log.w("Buddy", "$label answered $status${if (type != null) " ($type)" else ""}")
        if (status == 401 || status == 403) {
            return BuddyError("bad_key", "Your $label key was rejected. Check it in Settings.")
        }
        // Checked before 429: OpenAI reports an empty wallet as a 429 too.
        if (status == 402 || NO_CREDIT.containsMatchIn(text)) {
            return BuddyError("no_credit", "Your $label account is out of credit.")
        }
        if (status == 429) {
            return BuddyError("rate_limited", "$label is busy right now. Try again in a minute.")
        }
        if (status == 404 || BAD_MODEL.containsMatchIn(text)) {
            return BuddyError("bad_model", "This model isn't available for your key. Pick another in Settings.")
        }
        return BuddyError("upstream", "$label had a problem. Try again in a moment.") // the status is in the log, not here
    }

    private fun tookTooLong(label: String) = BuddyError("timeout", "$label took too long to answer. Try again.")

    /**
     * HTTP + JSON. A network failure becomes BuddyError("network"), and a request that ran out of time
     * BuddyError("timeout"); a cancellation is passed through untouched so callers can tell "cancelled" from "failed".
     */
    suspend fun requestJson(
        http: Http,
        label: String,
        url: String,
        method: String = "GET",
        headers: Map<String, String> = emptyMap(),
        body: JsonObject? = null,
    ): JsonObject {
        val response = try {
            http.send(
                HttpRequest(
                    url = url,
                    method = method,
                    headers = if (body == null) headers else mapOf("content-type" to "application/json") + headers,
                    body = body?.toString(),
                    timeoutMs = AI_TIMEOUT_MS,
                ),
            )
        } catch (e: SocketTimeoutException) {
            currentCoroutineContext().ensureActive()
            throw tookTooLong(label)
        } catch (e: IOException) {
            // A caller that let go of the request interrupts its read, which then fails like no internet: that is a
            // cancellation, and is passed on as one.
            currentCoroutineContext().ensureActive()
            throw BuddyError("network", "Couldn't reach $label. Check your internet.")
        }
        if (response.status !in 200..299) throw errorFromResponse(response.status, response.body, label)
        return try {
            Json.parseToJsonElement(response.body).jsonObject
        } catch (e: Exception) {
            throw BuddyError("upstream", "$label had a problem. Try again in a moment.")
        }
    }
}
