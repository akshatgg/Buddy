package com.akshatgg.buddy.voice

import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class FakeSpeaker(private val block: CompletableDeferred<Unit>? = null) : Speaker {
    val log = ArrayList<String>()
    override suspend fun say(text: String) { log.add(text); block?.await() }
    override fun stop() { log.add("<stop>"); block?.complete(Unit) }
}

@OptIn(ExperimentalCoroutinesApi::class)
class PhoneTalkBackTest {
    @get:Rule val tmp = TemporaryFolder()

    private var fetches = 0
    private var serverSays: () -> String = { "Priya Sharma" }

    private fun model(scope: CoroutineScope) = VoiceModel(
        tmp.newFolder(), ModelSpec("m", "u", "x", 1),
        download = { _, _, _ -> fetches++; throw BuddyError("network", "x") }, scope = scope,
    )

    private fun talk(scope: CoroutineScope, speaker: Speaker = FakeSpeaker(), mic: FakeMic, spotter: FakeSpotter? = null): PhoneTalkBack {
        val t: suspend (ByteArray, String) -> String = { _, _ -> serverSays() }
        val ears = Ears({ mic }, { spotter?.let { s -> Spotters { s } } }, { null }, t)
        return PhoneTalkBack(speaker, ears, model(scope), t)
    }

    private fun speech(chunks: Int) = FakeMic(List(chunks) { 0.3f to 1_600 })

    @Test fun hearStartsTheModelDownloadWhenItIsMissing() = runTest(UnconfinedTestDispatcher()) {
        val t = talk(this, mic = speech(5), spotter = FakeSpotter(mapOf(2 to """{"text":"yes"}"""), "{}"))
        assertEquals(Heard.YES, t.hear("send"))
        assertEquals(1, fetches)
    }

    @Test fun stopWhileHearWaitsAnswersNoAndStopsTheSpeaker() = runTest(UnconfinedTestDispatcher()) {
        val speaker = FakeSpeaker()
        val t = talk(this, speaker, mic = FakeMic(emptyList(), starts = true), spotter = null)
        val hearing = async { t.hear("send") }
        t.stop()
        assertEquals(Heard.NO, hearing.await())
        assertTrue(speaker.log.contains("<stop>"))
        assertEquals(Heard.NO, t.hear("send")) // stopped until the next say()
    }

    @Test fun stopWhileSpeakingEndsTheSayAndTheNextHearIsNo() = runTest(UnconfinedTestDispatcher()) {
        val speaker = FakeSpeaker(CompletableDeferred())
        val t = talk(this, speaker, mic = speech(5), spotter = FakeSpotter(mapOf(1 to """{"text":"yes"}"""), "{}"))
        val saying = async { t.say("Send it?") }
        t.stop()
        saying.await()
        assertEquals(Heard.NO, t.hear("send"))
    }

    @Test fun listenGivesTheWrittenWords() = runTest(UnconfinedTestDispatcher()) {
        val t = talk(this, mic = FakeMic(List(6) { 0.3f to 1_600 } + List(30) { 0f to 1_600 }))
        assertEquals("Priya Sharma", t.listen())
    }

    @Test fun listenGivesNullForNothingOrAnError() = runTest(UnconfinedTestDispatcher()) {
        serverSays = { "" }
        assertNull(talk(this, mic = FakeMic(List(6) { 0.3f to 1_600 } + List(30) { 0f to 1_600 })).listen())
        serverSays = { throw BuddyError("network", "x") }
        assertNull(talk(this, mic = FakeMic(List(6) { 0.3f to 1_600 } + List(30) { 0f to 1_600 })).listen())
    }

    @Test fun silentTalkBackAnswersNo() = runTest {
        assertEquals(Heard.NO, TalkBack.SILENT.hear("send"))
        assertNull(TalkBack.SILENT.listen())
        assertTrue(Lock.OPEN.unlocked(1))
    }

    @Test fun stopCancelsEveryHearInFlight() = runTest(UnconfinedTestDispatcher()) {
        val t = talk(this, mic = FakeMic(emptyList(), starts = true), spotter = null)
        val a = async { t.hear("send") }
        val b = async { t.hear("call") }
        t.stop()
        assertEquals(Heard.NO, a.await())
        assertEquals(Heard.NO, b.await())
    }
}
