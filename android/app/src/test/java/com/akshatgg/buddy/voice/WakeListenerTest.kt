package com.akshatgg.buddy.voice

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class WakeListenerTest {
    private fun hey(vararg words: Pair<String, Float>, conf: Float = 0.9f): String {
        // words: (word, end second)
        val parts = words.joinToString(",") { (w, end) -> """{"word":"$w","conf":$conf,"start":${end - 0.3f},"end":$end}""" }
        return """{"text":"${words.joinToString(" ") { it.first }}","result":[$parts]}"""
    }

    private fun quiet(n: Int) = List(n) { 0.0f to 1_600 }
    private fun voice(n: Int) = List(n) { 0.3f to 1_600 }

    private class Made(val spotters: MutableList<FakeSpotter>, val made: MutableList<Spotter> = ArrayList()) : Spotters {
        val grammars = ArrayList<List<String>>()
        override fun make(grammar: List<String>): Spotter {
            grammars.add(grammar)
            val s = if (spotters.isEmpty()) FakeSpotter(emptyMap(), "") else spotters.removeAt(0)
            made.add(s); return s
        }
    }

    private suspend fun kotlinx.coroutines.test.TestScope.collect(
        listener: WakeListener,
        events: MutableList<WakeEvent>,
    ) = launch { listener.run { events.add(it) } }

    @Test fun aWakeAloneRecordsWhatIsSaidAfterItUntilQuiet() = runTest {
        // 21 chunks (2.1 s) of talk where the phrase ended at 1.6 s, then 15 chunks of voice, 15 of quiet.
        val mic = FakeMic(voice(21) + voice(15) + quiet(15))
        val spotters = Made(mutableListOf(FakeSpotter(mapOf(20 to hey("hey" to 1.0f, "rahul" to 1.6f)), "")))
        val events = ArrayList<WakeEvent>()
        val job = collect(WakeListener({ mic }, spotters, "hey rahul"), events)
        runCurrent()
        job.cancel()
        assertEquals(2, events.size)
        assertTrue(events[0] is WakeEvent.Woke)
        val wav = (events[1] as WakeEvent.Request).wav
        assertNotNull(wav)
        // from 1.6 s (chunk 16) to 1.2 s (12 chunks) after the last voice (chunk 35): chunks 16..47 = 32 chunks
        assertEquals(44 + 32 * 1_600 * 2, wav!!.size)
    }

    @Test fun aRequestInTheSameBreathIsTakenFromWhatWasKept() = runTest {
        // the final comes at chunk 40; the voice after 1.6 s is already kept, and 1.2 s of quiet too
        val mic = FakeMic(voice(41 - 12) + quiet(12) )
        val spotters = Made(mutableListOf(FakeSpotter(mapOf(40 to hey("hey" to 1.0f, "rahul" to 1.6f, "[unk]" to 2.0f)), "")))
        val events = ArrayList<WakeEvent>()
        val job = collect(WakeListener({ mic }, spotters, "hey rahul"), events)
        runCurrent()
        job.cancel()
        val wav = (events[1] as WakeEvent.Request).wav!!
        assertEquals(44 + (41 - 16) * 1_600 * 2, wav.size) // chunks 16..40
    }

    @Test fun theNameAloneOrInTheMiddleDoesNotWake() = runTest {
        val mic = FakeMic(voice(10))
        val spotters = Made(mutableListOf(FakeSpotter(mapOf(
            2 to hey("[unk]" to 0.5f, "hey" to 1.0f, "rahul" to 1.5f),
            5 to hey("rahul" to 1.0f),
            8 to hey("hey" to 1.0f, "rahul" to 1.5f, conf = 0.3f),
        ), "")))
        val events = ArrayList<WakeEvent>()
        val job = collect(WakeListener({ mic }, spotters, "hey rahul"), events)
        runCurrent()
        job.cancel()
        assertTrue(events.isEmpty())
    }

    @Test fun nothingAfterTheWakeIsARequestWithNoRecording() = runTest {
        val mic = FakeMic(quiet(1) + quiet(100))
        val spotters = Made(mutableListOf(FakeSpotter(mapOf(0 to hey("hey" to 0.1f, "rahul" to 0.1f)), "")))
        val events = ArrayList<WakeEvent>()
        val job = collect(WakeListener({ mic }, spotters, "hey rahul"), events)
        runCurrent()
        job.cancel()
        assertTrue(events[0] is WakeEvent.Woke)
        assertNull((events[1] as WakeEvent.Request).wav)
    }

    @Test fun testOnlyGivesWokeAndNoRequest() = runTest {
        val mic = FakeMic(quiet(10))
        val said = hey("hey" to 0.1f, "rahul" to 0.2f)
        val spotters = Made(mutableListOf(FakeSpotter(mapOf(1 to said), ""), FakeSpotter(mapOf(2 to said), "")))
        val events = ArrayList<WakeEvent>()
        val job = collect(WakeListener({ mic }, spotters, "hey rahul", testOnly = true), events)
        runCurrent()
        job.cancel()
        assertEquals(listOf(WakeEvent.Woke, WakeEvent.Woke), events)
    }

    @Test fun pausedLetsGoOfTheMicAndComesBack() = runTest {
        val mics = ArrayList<FakeMic>()
        var checks = 0
        val listener = WakeListener(
            mic = { FakeMic(quiet(100)).also { mics.add(it) } },
            spotters = Made(mutableListOf()),
            phrase = "hey rahul",
            paused = { checks++ in 3..7 },
        )
        val job = launch { listener.run { } }
        runCurrent()
        assertEquals(1, mics.size)
        assertTrue(mics[0].stopped)
        advanceTimeBy(5_000) // five checks say paused, a second apart
        runCurrent()
        assertEquals(2, mics.size)
        job.cancel()
    }

    @Test fun aSilencedMicStaysOpenAndIsNotFedUntilItIsHeardAgain() = runTest {
        // the 6th to 15th reads are silenced (another app records): nothing is fed, nothing is released or made again
        var mics = 0
        val mic = FakeMic(quiet(30))
        val spotter = FakeSpotter(emptyMap(), "")
        val spotters = Made(mutableListOf(spotter))
        var checks = 0
        val listener = WakeListener(
            mic = { mics++; mic },
            spotters = spotters,
            phrase = "hey rahul",
            silenced = { checks++ in 5..14 },
        )
        val events = ArrayList<WakeEvent>()
        val job = launch { listener.run { events.add(it) } }
        runCurrent()
        assertEquals(1, mics)
        assertEquals(1, spotters.made.size)
        assertEquals(20, spotter.chunk) // 30 reads, 10 of them silenced
        advanceTimeBy(0)
        job.cancel()
    }

    @Test fun aNewSpotterAfterEachWake() = runTest {
        val said = hey("hey" to 0.1f, "rahul" to 0.2f)
        val mic = FakeMic(quiet(300))
        val spotters = Made(mutableListOf(FakeSpotter(mapOf(0 to said), ""), FakeSpotter(mapOf(0 to said), "")))
        val events = ArrayList<WakeEvent>()
        val job = collect(WakeListener({ mic }, spotters, "hey rahul"), events)
        runCurrent()
        advanceTimeBy(5_000)
        runCurrent()
        job.cancel()
        assertEquals(listOf("hey rahul", "[unk]"), spotters.grammars[0])
        assertTrue(spotters.made.size >= 3) // one to begin with, one after each of the two wakes
        assertTrue(spotters.made[0].let { (it as FakeSpotter).closed })
    }

    @Test fun aMicThatCannotStartIsRetriedEveryFiveSecondsOfClock() = runTest {
        var tries = 0
        val listener = WakeListener({ tries++; FakeMic(emptyList(), starts = false) }, Made(mutableListOf()), "hey rahul")
        val job = launch { listener.run { } }
        runCurrent()
        assertEquals(1, tries)
        advanceTimeBy(4_999); runCurrent()
        assertEquals(1, tries)
        advanceTimeBy(1); runCurrent()
        assertEquals(2, tries)
        assertEquals(5_000, currentTime)
        job.cancel()
    }
}
