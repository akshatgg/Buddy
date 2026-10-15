package com.akshatgg.buddy.voice

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Who else uses the microphone in Buddy now (the 🎤, a spoken answer): the wake listener steps aside meanwhile, so that
 * two never record at once. `busy` counts the users.
 */
object MicBus {
    private val count = MutableStateFlow(0)
    val busy: StateFlow<Int> = count

    fun hold() { count.value = count.value + 1 }

    fun release() { count.value = maxOf(0, count.value - 1) }

    /** Holds the microphone while `block` runs, however it ends. */
    suspend fun <T> holding(block: suspend () -> T): T {
        hold()
        try {
            return block()
        } finally {
            release()
        }
    }
}
