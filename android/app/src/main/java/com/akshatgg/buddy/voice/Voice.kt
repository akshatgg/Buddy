package com.akshatgg.buddy.voice

import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.File

sealed interface VoiceState {
    data object Idle : VoiceState
    data object Recording : VoiceState
    data object Sending : VoiceState // what was said is being written down by the server
}

private const val FILE_PREFIX = "voice-"

private fun notCaught() = BuddyError("no_words", "I didn't catch that. Try again, or type.")

/**
 * Talking to Buddy, as on the desktop (the panel's 🎤): the microphone is recorded into the app's cache, the recording
 * is written down by Buddy's server, and the words come back for the box. No recording is kept: the file is deleted
 * however it ends. At most `maxMs` is recorded (stopAtLimit()). Used from one thread, the main one.
 */
class Voice(
    private val recorder: Recorder,
    private val transcribe: suspend (ByteArray) -> String,
    private val voiceOn: suspend () -> Boolean,
    private val cacheDir: File,
    private val now: () -> Long = System::currentTimeMillis,
    private val maxMs: Long = 60_000,
) {
    private val current = MutableStateFlow<VoiceState>(VoiceState.Idle)
    val state: StateFlow<VoiceState> = current

    private var turn = 0 // one more with each start() and cancel(): what comes back for an earlier one is dropped
    private var starting = false
    private var file: File? = null
    private var startedAt = 0L

    /** Starts recording. Throws when voice is off on the server or the microphone cannot be used. */
    suspend fun start() {
        if (starting || current.value != VoiceState.Idle) return
        starting = true
        val mine = ++turn
        try {
            if (!voiceOn()) throw BuddyError("voice_off", "Voice isn't set up yet.")
            if (mine != turn) return // cancelled meanwhile
            // A recording left by an earlier run that ended mid-way (the app killed while recording).
            cacheDir.listFiles { f -> f.name.startsWith(FILE_PREFIX) }?.forEach { it.delete() }
            val f = File(cacheDir, "$FILE_PREFIX${now()}.m4a")
            try {
                recorder.start(f)
            } catch (e: Exception) {
                f.delete()
                throw if (e is SecurityException) {
                    BuddyError("no_microphone", "Buddy needs the microphone to hear you. Allow it in Settings.")
                } else {
                    BuddyError("mic_failed", "I couldn't use the microphone. Try again.")
                }
            }
            file = f
            startedAt = now()
            current.value = VoiceState.Recording
        } finally {
            starting = false
        }
    }

    /**
     * Stops recording and gives what was said. Throws a BuddyError when nothing was heard or the server could not write
     * it down, and a CancellationException when it was not recording or was cancelled meanwhile.
     */
    suspend fun stop(): String {
        if (current.value != VoiceState.Recording) throw CancellationException("Not recording")
        val mine = turn
        val f = file!!
        file = null
        current.value = VoiceState.Sending
        try {
            val audio = try {
                recorder.stop()
                f.readBytes()
            } catch (e: Exception) {
                ByteArray(0) // stopped before anything was recorded
            } finally {
                f.delete()
            }
            if (audio.isEmpty()) throw notCaught()
            val words = try {
                transcribe(audio).trim()
            } catch (e: BuddyError) {
                if (mine != turn) throw CancellationException("Cancelled") else throw e
            }
            if (mine != turn) throw CancellationException("Cancelled")
            if (words.isEmpty()) throw notCaught()
            return words
        } finally {
            if (mine == turn) current.value = VoiceState.Idle
        }
    }

    /**
     * Waits until `maxMs` have passed since recording started, then stops and gives the words as stop() does. Throws a
     * CancellationException when the recording ended otherwise first.
     */
    suspend fun stopAtLimit(): String {
        if (current.value != VoiceState.Recording) throw CancellationException("Not recording")
        val mine = turn
        delay(maxMs - (now() - startedAt))
        if (mine != turn || current.value != VoiceState.Recording) throw CancellationException("Stopped before the limit")
        return stop()
    }

    /** Stops at once and sends nothing: what is being written down is dropped. */
    fun cancel() {
        turn++
        if (current.value == VoiceState.Recording) {
            try {
                recorder.stop()
            } catch (e: Exception) {
                // nothing recorded: nothing to finish
            }
        }
        file?.delete()
        file = null
        current.value = VoiceState.Idle
    }
}
