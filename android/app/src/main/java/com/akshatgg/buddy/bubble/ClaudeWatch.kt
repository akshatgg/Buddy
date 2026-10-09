package com.akshatgg.buddy.bubble

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** How often the phone looks while a computer shares its Claude Code sessions, and while none does or a look fails. */
const val CLAUDE_LOOK_MS = 10_000L
const val CLAUDE_QUIET_MS = 30_000L

/**
 * Whether Claude Code is at work on one of the person's computers, for Clawd in the head's eye (Clawd.kt). It looks
 * at the sessions they share through Buddy's server (the same look as Claude mode, with no session: nothing is
 * watched, so the computer sends nothing more for it) every [CLAUDE_LOOK_MS] while one shares, and every
 * [CLAUDE_QUIET_MS] while none does, the person is signed out or a look fails. `look` gives the statuses of the shared
 * sessions, or null when there is nothing to look at (signed out, no computer sharing); it may throw. `paused` says
 * not to look now (the screen is off). `onKind` hears every change.
 */
class ClaudeWatch(
    private val scope: CoroutineScope,
    private val look: suspend () -> List<String>?,
    private val paused: () -> Boolean,
    private val onKind: (ClawdKind?) -> Unit,
) {
    private var job: Job? = null
    var kind: ClawdKind? = null
        private set

    /** One look: the kind it comes to (also told to onKind, when it changed), and how long until the next look. */
    suspend fun step(): Long {
        if (paused()) return CLAUDE_LOOK_MS
        val statuses = try {
            look()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null // offline, the server down, signed out meanwhile: no Clawd, and look again later
        }
        val next = Clawd.kindOf(statuses.orEmpty(), kind)
        if (next != kind) {
            kind = next
            onKind(next)
        }
        return if (statuses.isNullOrEmpty()) CLAUDE_QUIET_MS else CLAUDE_LOOK_MS
    }

    fun start() {
        if (job != null) return
        job = scope.launch {
            while (true) delay(step())
        }
    }

    fun stop() {
        job?.cancel()
        job = null
        if (kind != null) {
            kind = null
            onKind(null)
        }
    }
}
