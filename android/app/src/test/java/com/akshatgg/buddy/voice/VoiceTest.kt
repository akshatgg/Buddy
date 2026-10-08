package com.akshatgg.buddy.voice

import com.akshatgg.buddy.bubble.Mood
import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class VoiceTest {
    @get:Rule val tmp = TemporaryFolder()

    private val notCaught = listOf("no_words", "I didn't catch that. Try again, or type.")
    private val sound = "a recording".toByteArray()

    /** Writes `sound` into the file when it is stopped, as MediaRecorder finishes its file on stop(). */
    private inner class FakeRecorder : Recorder {
        var file: File? = null
        var recording = false
        var starts = 0
        var stops = 0
        var failStart: Exception? = null
        var failStop: Exception? = null
        var writes: ByteArray = sound
        override fun start(file: File) {
            starts++
            failStart?.let { throw it }
            file.writeBytes(ByteArray(0)) // the header MediaRecorder writes at once
            this.file = file
            recording = true
        }
        override fun stop() {
            stops++
            recording = false
            failStop?.let { throw it }
            file!!.writeBytes(writes)
        }
    }

    private var clock = 1_000L
    private var on = true
    private val sent = mutableListOf<ByteArray>()
    private var answer: suspend (ByteArray) -> String = { "Kal mujhe chutti chahiye." }
    private val recorder = FakeRecorder()
    private val moods = mutableListOf<Mood>()
    private val cache by lazy { tmp.newFolder("cache") }
    private val voice by lazy {
        Voice(recorder, { sent += it; answer(it) }, { on }, cache, now = { clock }, mood = { moods += it })
    }
    private fun cacheFiles() = cache.listFiles()!!.map { it.name }
    private suspend fun error(block: suspend () -> Unit): BuddyError = try { block(); throw AssertionError("no error") } catch (e: BuddyError) { e }

    @Test fun startRecordsIntoTheCacheAndStopSendsItAndGivesTheWords() = runTest {
        assertEquals(VoiceState.Idle, voice.state.value)
        voice.start()
        assertEquals(VoiceState.Recording, voice.state.value)
        assertEquals(cache, recorder.file!!.parentFile)
        assertTrue(recorder.file!!.name.endsWith(".m4a"))
        assertEquals("Kal mujhe chutti chahiye.", voice.stop())
        assertArrayEquals(sound, sent.single())
        assertEquals(VoiceState.Idle, voice.state.value)
        assertEquals("no recording is kept", emptyList<String>(), cacheFiles())
    }

    @Test fun itShowsSendingWhileTheWordsAreWrittenDown() = runTest {
        val gate = CompletableDeferred<String>()
        answer = { gate.await() }
        voice.start()
        val words = async { voice.stop() }
        runCurrent()
        assertEquals(VoiceState.Sending, voice.state.value)
        assertEquals("deleted as soon as it is read", emptyList<String>(), cacheFiles())
        gate.complete("  hello  ")
        assertEquals("trimmed", "hello", words.await())
        assertEquals(VoiceState.Idle, voice.state.value)
    }

    @Test fun voiceOffDoesNotStart() = runTest {
        on = false
        val e = error { voice.start() }
        assertEquals(listOf("voice_off", "Voice isn't set up yet."), listOf(e.code, e.message))
        assertEquals(0, recorder.starts)
        assertEquals(VoiceState.Idle, voice.state.value)
    }

    @Test fun aServerErrorComesThroughAndTheFileIsStillDeleted() = runTest {
        answer = { throw BuddyError("voice_busy", "Voice is busy right now. Type, or try again in a minute.") }
        voice.start()
        val e = error { voice.stop() }
        assertEquals("voice_busy", e.code)
        assertEquals(VoiceState.Idle, voice.state.value)
        assertEquals(emptyList<String>(), cacheFiles())
    }

    @Test fun noWordsBackSaysItDidNotCatchThat() = runTest {
        answer = { " \n " }
        voice.start()
        val e = error { voice.stop() }
        assertEquals(notCaught, listOf(e.code, e.message))
        assertEquals(VoiceState.Idle, voice.state.value)
    }

    @Test fun anEmptyOrUnfinishedRecordingIsNotSent() = runTest {
        recorder.writes = ByteArray(0)
        voice.start()
        assertEquals(notCaught, error { voice.stop() }.let { listOf(it.code, it.message) })
        // MediaRecorder's stop() throws when it was stopped before anything was recorded.
        recorder.writes = sound
        recorder.failStop = RuntimeException("stop failed")
        voice.start()
        assertEquals(notCaught, error { voice.stop() }.let { listOf(it.code, it.message) })
        assertEquals(emptyList<ByteArray>(), sent)
        assertEquals(VoiceState.Idle, voice.state.value)
        assertEquals(emptyList<String>(), cacheFiles())
    }

    @Test fun aMicrophoneThatWillNotStartSaysSo() = runTest {
        recorder.failStart = IOException("busy")
        val e = error { voice.start() }
        assertEquals(listOf("mic_failed", "I couldn't use the microphone. Try again."), listOf(e.code, e.message))
        recorder.failStart = SecurityException("no permission")
        val refused = error { voice.start() }
        assertEquals(listOf("no_microphone", "Buddy needs the microphone to hear you. Allow it in Settings."), listOf(refused.code, refused.message))
        assertEquals(VoiceState.Idle, voice.state.value)
        assertEquals(emptyList<String>(), cacheFiles())
    }

    @Test fun aSecondStartWhileRecordingDoesNothing() = runTest {
        voice.start()
        voice.start()
        assertEquals(1, recorder.starts)
        assertEquals(VoiceState.Recording, voice.state.value)
    }

    @Test fun cancelWhileRecordingStopsTheMicrophoneAndSendsNothing() = runTest {
        voice.start()
        voice.cancel()
        assertFalse(recorder.recording)
        assertEquals(VoiceState.Idle, voice.state.value)
        assertEquals(emptyList<String>(), cacheFiles())
        assertEquals(emptyList<ByteArray>(), sent)
        voice.cancel() // twice, or when idle: nothing happens
        assertEquals(1, recorder.stops)
    }

    @Test fun cancelWhileRecordingAlsoDropsTheSixtySecondStop() = runTest {
        // The panel left the screen (Home, or it stepped aside) while recording: nothing is uploaded later either.
        voice.start()
        val atLimit = async { voice.stopAtLimit() }
        runCurrent()
        voice.cancel()
        assertFalse(recorder.recording)
        assertEquals(emptyList<String>(), cacheFiles())
        advanceUntilIdle()
        assertTrue(atLimit.isCancelled)
        assertEquals(emptyList<ByteArray>(), sent)
        assertEquals(VoiceState.Idle, voice.state.value)
    }

    @Test fun cancelWhileSendingDropsTheWords() = runTest {
        val gate = CompletableDeferred<String>()
        answer = { gate.await() }
        voice.start()
        val words = async { voice.stop() }
        runCurrent()
        voice.cancel()
        assertEquals(VoiceState.Idle, voice.state.value)
        voice.start() // a new recording, while the old one is still being written down
        gate.complete("old words")
        advanceUntilIdle()
        assertTrue("dropped", words.isCancelled)
        assertEquals("the new recording goes on", VoiceState.Recording, voice.state.value)
    }

    @Test fun cancelWhileTheSettingsAreFetchedDoesNotStart() = runTest {
        val gate = CompletableDeferred<Boolean>()
        val slow = Voice(recorder, { "x" }, { gate.await() }, cache, now = { clock })
        val starting = async { slow.start() }
        runCurrent()
        slow.cancel()
        gate.complete(true)
        starting.await()
        assertEquals(0, recorder.starts)
        assertEquals(VoiceState.Idle, slow.state.value)
    }

    @Test fun itStopsByItselfAfterSixtySecondsAndGivesTheWords() = runTest {
        voice.start() // at 1 000 ms
        clock += 10_000 // the caller begins waiting 10 s later
        val words = async { voice.stopAtLimit() }
        advanceTimeBy(49_999)
        runCurrent()
        assertEquals(VoiceState.Recording, voice.state.value)
        advanceTimeBy(2)
        runCurrent()
        assertEquals("Kal mujhe chutti chahiye.", words.await())
        assertEquals(1, sent.size)
        assertEquals(VoiceState.Idle, voice.state.value)
    }

    @Test fun theSixtySecondStopIsDroppedWhenStoppedFirst() = runTest {
        voice.start()
        val atLimit = async { voice.stopAtLimit() }
        runCurrent()
        assertEquals("Kal mujhe chutti chahiye.", voice.stop())
        advanceUntilIdle()
        assertTrue(atLimit.isCancelled)
        assertEquals("sent once", 1, sent.size)
    }

    @Test fun recordingsLeftFromAnEarlierRunAreDeletedOnStart() = runTest {
        File(cache, "voice-1.m4a").writeBytes(sound)
        File(cache, "other.txt").writeBytes(sound)
        voice.start()
        voice.cancel()
        assertEquals(listOf("other.txt"), cacheFiles())
    }

    @Test fun stopWhenNotRecordingIsDropped() = runTest {
        val e = try { voice.stop(); null } catch (e: CancellationException) { e }
        assertTrue(e != null)
        assertEquals(VoiceState.Idle, voice.state.value)
    }

    // ---- the head while it listens (Android has no "listening" face: it thinks) ----

    @Test fun theHeadThinksWhileRecordingAndIsIdleWhenTheWordsAreBack() = runTest {
        val gate = CompletableDeferred<String>()
        answer = { gate.await() }
        voice.start()
        assertEquals(listOf(Mood.THINKING), moods)
        val words = async { voice.stop() }
        runCurrent()
        assertEquals("still thinking while the words are written down", listOf(Mood.THINKING), moods)
        gate.complete("hello")
        words.await()
        assertEquals(listOf(Mood.THINKING, Mood.IDLE), moods)
    }

    @Test fun theHeadIsIdleAgainWhenListeningIsCancelledOrFails() = runTest {
        voice.start()
        voice.cancel()
        assertEquals(listOf(Mood.THINKING, Mood.IDLE), moods)
        moods.clear()
        answer = { throw BuddyError("voice_busy", "Voice is busy right now. Type, or try again in a minute.") }
        voice.start()
        error { voice.stop() }
        assertEquals(listOf(Mood.THINKING, Mood.IDLE), moods)
    }

    @Test fun nothingToListenToChangesNoMood() = runTest {
        voice.cancel() // the panel stepping aside, with the microphone off: the head's mood is someone else's
        on = false
        error { voice.start() }
        recorder.failStart = IOException("busy")
        on = true
        error { voice.start() }
        assertEquals(emptyList<Mood>(), moods)
    }
}
