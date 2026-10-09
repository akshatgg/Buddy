package com.akshatgg.buddy.ui.panel

import com.akshatgg.buddy.cloud.RemoteItem
import com.akshatgg.buddy.cloud.RemoteLook
import com.akshatgg.buddy.cloud.RemoteSession
import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** How often the phone looks at the session it shows: the computer reports every few seconds. */
const val CLAUDE_POLL_MS = 1_500L

/** A session's status, in the Mac panel's words (panel.js CLAUDE_STATUS); one the phone does not know shows as it is. */
val CLAUDE_STATUS = mapOf("working" to "working…", "waiting" to "waiting for you", "done" to "done", "failed" to "hit a problem", "idle" to "idle")

const val CLAUDE_OFFLINE = "None of your computers is sharing right now. Keep Buddy open on one, with Settings → Claude Code → Show my sessions on my other devices on."
const val CLAUDE_NONE = "No Claude Code session is running on your computer."
const val CLAUDE_NO_TALK = "Your computer can't type into this terminal; what you send is copied there to paste."
private const val FAILED = "Something went wrong. Try again."

/**
 * What Claude mode shows. `on`: in Claude mode (its screen is open, and the person signed in). While `session` is null
 * the sessions are listed: `looking` while they are asked for, `online` whether the computer shares them (null: not
 * known, as when the asking failed with `listError`). With a `session`, its `items` (null until the computer has sent
 * them) and `problem`, why the last look at it failed. `draft` and `boxError` are the box's.
 */
data class ClaudeState(
    val on: Boolean = false,
    val looking: Boolean = false,
    val online: Boolean? = null,
    val sessions: List<RemoteSession> = emptyList(),
    val listError: String? = null,
    val session: RemoteSession? = null,
    val items: List<RemoteItem>? = null,
    val problem: String? = null,
    val draft: String = "",
    val sending: Boolean = false,
    val boxError: String? = null,
) {
    /** What the box says: where its words go, once a session is open. */
    val placeholder: String? get() = session?.let { "Message Claude in ${it.shown}…" }

    /** Whether the send button (and ↩) sends: to an open session, one message at a time, with words in the box. */
    val canSend: Boolean get() = session != null && !sending && draft.isNotBlank()
}

/**
 * Claude mode, on its own screen (ClaudeActivity), as the Mac panel's (panel.js, its end) on a phone: the Claude Code
 * sessions running on the person's computers, reached through Buddy's server, and one of them shown, with the box
 * typing into it. The phone looks at the session it shows every 1.5 s, and only while the screen is in view: the
 * computer sends its items only while the phone looks, and stops when it is told (`stop`: back to the list, out of
 * Claude mode, the screen hidden or closed). Plain Kotlin, so that it is tested on the JVM; `look`, `send` and `stop` are CloudClient's calls.
 */
class ClaudeModel(
    private val look: suspend (String?) -> RemoteLook,
    private val send: suspend (String, String) -> Unit,
    private val stop: suspend () -> Unit,
    private val scope: CoroutineScope,
    private val pollMs: Long = CLAUDE_POLL_MS,
) {
    private val current = MutableStateFlow(ClaudeState())
    val state: StateFlow<ClaudeState> = current.asStateFlow()

    private var listing: Job? = null // the sessions being asked for now, if they are
    private var polling: Job? = null // the looks at the session shown, while the screen is in view
    private var shown = true
    private var generation = 0 // one more each time Claude mode ends: what was on its way for an earlier one is dropped

    private fun update(change: ClaudeState.() -> ClaudeState) {
        current.value = current.value.change()
    }

    // ---- in and out ----

    /**
     * Into Claude mode, on the list of sessions: the screen opened, or the person signed in on it. Already in it (the
     * screen made again after a turn of the phone), it stays where it is.
     */
    fun enter() {
        if (current.value.on) return
        update { copy(on = true) }
        list()
    }

    /** The screen was closed: Claude mode ends with it. */
    fun close() {
        shown = false
        leave()
    }

    /** Out of Claude mode (the person signed out): its work stops, and the computer's. */
    fun leave() {
        generation += 1
        listing?.cancel()
        listing = null
        leaveSession()
        current.value = ClaudeState()
    }

    /** The screen is in view again: the session it showed is looked at again, or the sessions asked for anew. */
    fun shown() {
        shown = true
        val s = current.value
        if (!s.on) return
        if (s.session != null) poll() else list()
    }

    /** The screen went out of view: the phone stops looking, and the computer stops sending. */
    fun hidden() {
        shown = false
        if (polling != null) {
            polling?.cancel()
            polling = null
            stopWatching()
        }
    }

    // ---- the list ----

    /** "Look again", and "‹ Sessions" from a session (which the computer then stops sending). */
    fun list() = list(note = null)

    private fun list(note: String?) {
        leaveSession()
        listing?.cancel()
        update { copy(session = null, items = null, problem = null, looking = true, listError = note) }
        val mine = generation
        listing = scope.launch {
            val job = coroutineContext[Job]
            val r = try {
                look(null)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (listing === job && mine == generation) {
                    listing = null
                    update { copy(looking = false, online = null, sessions = emptyList(), listError = note ?: messageOf(e)) }
                }
                return@launch
            }
            if (listing !== job || mine != generation) return@launch
            listing = null
            update { copy(looking = false, online = r.online, sessions = r.sessions, listError = note) }
        }
    }

    /** The session shown is left: the looks stop, and so does the computer. */
    private fun leaveSession() {
        val watched = polling != null || current.value.session != null
        polling?.cancel()
        polling = null
        if (watched) stopWatching()
    }

    private fun stopWatching() {
        scope.launch {
            try {
                stop()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // Nothing to tell the person: the server stops the watch on its own when the phone stops looking.
            }
        }
    }

    // ---- a session ----

    /** A session picked from the list: it shows, and is looked at every 1.5 s. */
    fun open(id: String) {
        val s = current.value
        val session = s.sessions.firstOrNull { it.id == id } ?: return
        if (!s.on || s.session != null) return
        listing?.cancel()
        listing = null
        update { copy(session = session, items = null, problem = null, looking = false, listError = null) }
        poll()
    }

    private fun poll() {
        val id = current.value.session?.id ?: return
        if (!shown || polling != null) return
        polling = scope.launch {
            val job = coroutineContext[Job]
            while (true) {
                val r = try {
                    look(id)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    if (polling !== job) return@launch
                    if (e is BuddyError && e.code == "not_found") {
                        // The session ended on the computer: back to the list, saying so.
                        polling = null
                        list(note = e.message)
                        return@launch
                    }
                    update { copy(problem = messageOf(e)) }
                    delay(pollMs)
                    continue
                }
                if (polling !== job) return@launch
                if (!r.online) {
                    // The computer stopped sharing: the list says so.
                    polling = null
                    leaveSession()
                    update { copy(session = null, items = null, problem = null, online = false, sessions = r.sessions, listError = null) }
                    return@launch
                }
                val feed = r.feed?.takeIf { it.session.id == id }
                update {
                    if (feed == null) copy(problem = null) else copy(session = feed.session, items = feed.items, problem = null)
                }
                delay(pollMs)
            }
        }
    }

    // ---- the box ----

    fun setDraft(text: String) = update { copy(draft = text, boxError = null) }

    /** Words the person said (voice): into the box after what is there, to send when they want. */
    fun voiceWords(text: String) {
        val words = text.trim()
        if (words.isEmpty()) return
        val typed = current.value.draft.trimEnd()
        setDraft(if (typed.isEmpty()) words else "$typed $words")
    }

    /** Listening went wrong: said under the box, as the chat is not on screen. */
    fun voiceError(err: BuddyError) = update { copy(boxError = if (err.code == "voice_off") "Voice isn't set up yet." else err.message.orEmpty()) }

    /**
     * The box's words, to the session's terminal. The box empties at once; when they could not be sent, they come back
     * (unless the person has typed something else meanwhile), with why under the box.
     */
    fun send() {
        val s = current.value
        val session = s.session ?: return
        if (!s.canSend) return
        val text = s.draft.trim()
        val mine = generation
        update { copy(draft = "", sending = true, boxError = null) }
        scope.launch {
            var failed: String? = null
            try {
                send(session.id, text)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failed = messageOf(e)
            } finally {
                if (mine == generation) {
                    update { copy(sending = false, draft = if (failed != null && draft.isEmpty()) text else draft, boxError = failed) }
                }
            }
        }
    }

    private fun messageOf(e: Exception): String = (e as? BuddyError)?.message?.ifEmpty { null } ?: FAILED
}
