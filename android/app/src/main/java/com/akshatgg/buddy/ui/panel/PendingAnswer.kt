package com.akshatgg.buddy.ui.panel

import kotlinx.coroutines.CompletableDeferred

/**
 * One question to the person through an activity ("Allow Buddy to access your contacts?"), whose answer comes back
 * later through that activity. Whoever asks never waits forever: a new question ends the one before with `none`, and
 * so does giveUp() (the panel has gone, with nobody left to answer).
 */
class PendingAnswer<T>(private val none: T) {
    private var pending: CompletableDeferred<T>? = null

    /** Asks (`launch` shows the question) and waits for the answer, or `none` when it was ended first. */
    suspend fun ask(launch: () -> Unit): T {
        pending?.complete(none)
        val answer = CompletableDeferred<T>()
        pending = answer
        return try {
            launch()
            answer.await()
        } finally {
            if (pending === answer) pending = null
        }
    }

    /** The person's answer, to whoever is waiting (nobody, when it came too late). */
    fun answered(value: T) {
        pending?.complete(value)
    }

    /** Nobody is left to answer: whoever is waiting gets `none`. */
    fun giveUp() {
        pending?.complete(none)
        pending = null
    }
}
