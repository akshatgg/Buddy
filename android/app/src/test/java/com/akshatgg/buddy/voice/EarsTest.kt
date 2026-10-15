package com.akshatgg.buddy.voice

import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** A microphone that gives chunks of a constant level, then ends. */
class FakeMic(private val chunks: List<Pair<Float, Int>>, private val starts: Boolean = true) : PcmSource {
    var reads = 0
    var stopped = false
    override fun start() = starts
    override fun read(into: ShortArray): Int {
        if (reads >= chunks.size) return -1
        val (level, n) = chunks[reads++]
        val v = (level * 32767).toInt().toShort()
        val count = minOf(n, into.size)
        for (i in 0 until count) into[i] = v
        return count
    }
    override fun stop() { stopped = true }
}

class FakeSpotter(private val results: Map<Int, String>, private val final: String) : Spotter {
    var chunk = 0
    var closed = false
    override fun accept(pcm: ShortArray, n: Int): String? = results[chunk++]
    override fun finish() = final
    override fun close() { closed = true }
}

class EarsTest {
    private val sentToServer = ArrayList<String>()
    private var serverSays: () -> String = { "" }

    private fun said(text: String) = """{"text":"$text"}"""
    private fun speech(chunks: Int) = FakeMic(List(chunks) { 0.3f to 1_600 })
    private fun silence(chunks: Int) = FakeMic(List(chunks) { 0.0f to 1_600 })
    private fun speechThenQuiet(speechChunks: Int, quietChunks: Int) =
        FakeMic(List(speechChunks) { 0.3f to 1_600 } + List(quietChunks) { 0.0f to 1_600 })

    private fun ears(
        mic: FakeMic,
        spotter: FakeSpotter? = null,
        spotters: Boolean = spotter != null,
        known: Set<String>? = null,
    ) = Ears(
        mic = { mic },
        spotters = { if (spotters) Spotters { spotter!! } else null },
        known = { known },
        transcribe = { _, type -> sentToServer.add(type); serverSays() },
    )

    @Test fun aYesOnTheDeviceIsYesAndNothingGoesToTheServer() = runTest {
        val ears = ears(mic = speech(20), spotter = FakeSpotter(mapOf(8 to said("haan")), said("")))
        assertEquals(Heard.YES, ears.hear("send"))
        assertEquals(emptyList<String>(), sentToServer)
    }

    @Test fun nothingDecisiveIn8SecondsIsNo() = runTest {
        val mic = silence(100)
        val spotter = FakeSpotter(emptyMap(), said("[unk]"))
        assertEquals(Heard.NO, ears(mic, spotter).hear("call"))
        assertEquals(80, mic.reads)
        assertTrue(mic.stopped)
        assertTrue(spotter.closed)
    }

    @Test fun aNoWinsOverAYesInOneAnswer() = runTest {
        assertEquals(Heard.NO, ears(speech(20), FakeSpotter(mapOf(5 to said("yes no")), said(""))).hear("send"))
    }

    @Test fun aYesWithAnUnknownWordIsNo() = runTest {
        assertEquals(Heard.NO, ears(speech(20), FakeSpotter(mapOf(5 to said("yes banana")), said(""))).hear("send"))
    }

    @Test fun withoutTheModelTheAnswerIsWrittenDownByTheServer() = runTest {
        serverSays = { "Haan, send it." }
        assertEquals(Heard.YES, ears(speechThenQuiet(6, 20), spotters = false).hear("send"))
        assertEquals(listOf("audio/wav"), sentToServer)
    }

    @Test fun withoutTheModelTheServerSayingNoIsNo() = runTest {
        serverSays = { "no, stop" }
        assertEquals(Heard.NO, ears(speechThenQuiet(6, 20), spotters = false).hear("send"))
    }

    @Test fun withoutTheModelNothingSaidSendsNothing() = runTest {
        val mic = silence(100)
        assertEquals(Heard.NO, ears(mic, spotters = false).hear("send"))
        assertEquals(emptyList<String>(), sentToServer)
        assertEquals(80, mic.reads)
    }

    @Test fun aWordTheModelLacksIsAskedOfTheServerOnlyWhenSomethingWasSaid() = runTest {
        serverSays = { "haan" }
        val known = setOf("yes", "yeah", "ha", "okay", "send", "no", "na", "cancel", "don't", "stop", "not", "mat", "nope", "nah", "wait")
        val spoken = ears(speech(100), FakeSpotter(emptyMap(), said("[unk]")), known = known)
        assertEquals(Heard.YES, spoken.hear("send"))
        assertEquals(listOf("audio/wav"), sentToServer)
        sentToServer.clear()
        val mute = ears(silence(100), FakeSpotter(emptyMap(), said("[unk]")), known = known)
        assertEquals(Heard.NO, mute.hear("send"))
        assertEquals(emptyList<String>(), sentToServer)
    }

    @Test fun aServerFailureIsNo() = runTest {
        serverSays = { throw BuddyError("network", "down") }
        assertEquals(Heard.NO, ears(speechThenQuiet(6, 20), spotters = false).hear("send"))
    }

    @Test fun aMicThatCannotStartIsNo() = runTest {
        val mic = FakeMic(emptyList(), starts = false)
        val spotter = FakeSpotter(emptyMap(), said(""))
        assertEquals(Heard.NO, ears(mic, spotter).hear("send"))
        assertEquals(0, mic.reads)
        assertTrue(spotter.closed)
    }

    @Test fun requestRecordsUntilQuietAndGivesAWav() = runTest {
        val wav = ears(speechThenQuiet(10, 30), spotters = false).request(quietMs = 1_200)
        assertEquals("RIFF", String(wav!!, 0, 4))
        assertEquals(44 + (10 + 12) * 1_600 * 2, wav.size)
    }

    @Test fun requestWithNothingSaidIsNull() = runTest {
        assertNull(ears(silence(100), spotters = false).request())
    }

    @Test fun theAnswerTurnJudgesWithTheStrictRule() {
        val turn = AnswerTurn("send", needsServer = false)
        assertNull(turn.result("[unk]"))
        assertEquals(Decision.Words("yes please"), turn.result("yes please"))
        assertEquals(Decision.Words(""), turn.timeUp(""))
        val server = AnswerTurn("send", needsServer = true).also { it.level(0.3f) }
        assertEquals(Decision.Recording, server.timeUp(""))
    }
}
