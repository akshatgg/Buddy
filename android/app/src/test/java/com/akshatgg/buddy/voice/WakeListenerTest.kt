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
    private val RAHUL = listOf("hey rahul", "hey buddy")

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
        val job = collect(WakeListener({ mic }, spotters, RAHUL), events)
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
        val job = collect(WakeListener({ mic }, spotters, RAHUL), events)
        runCurrent()
        job.cancel()
        val wav = (events[1] as WakeEvent.Request).wav!!
        assertEquals(44 + (41 - 16) * 1_600 * 2, wav.size) // chunks 16..40
    }

    @Test fun aPhraseInTheMiddleOrNotSureEnoughDoesNotWake() = runTest {
        val mic = FakeMic(voice(10))
        val spotters = Made(mutableListOf(FakeSpotter(mapOf(
            2 to hey("[unk]" to 0.5f, "hey" to 1.0f, "rahul" to 1.5f),
            5 to hey("[unk]" to 0.5f, "buddy" to 1.0f),
            8 to hey("hey" to 1.0f, "rahul" to 1.5f, conf = 0.3f),
        ), "")))
        val events = ArrayList<WakeEvent>()
        val job = collect(WakeListener({ mic }, spotters, RAHUL), events)
        runCurrent()
        job.cancel()
        assertTrue(events.isEmpty())
    }

    @Test fun nothingAfterTheWakeIsARequestWithNoRecording() = runTest {
        val mic = FakeMic(quiet(1) + quiet(100))
        val spotters = Made(mutableListOf(FakeSpotter(mapOf(0 to hey("hey" to 0.1f, "rahul" to 0.1f)), "")))
        val events = ArrayList<WakeEvent>()
        val job = collect(WakeListener({ mic }, spotters, RAHUL), events)
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
        val job = collect(WakeListener({ mic }, spotters, RAHUL, testOnly = true), events)
        runCurrent()
        job.cancel()
        assertEquals(2, events.size)
        assertTrue(events.all { it is WakeEvent.Woke })
    }

    @Test fun aBareBuddyDoesNotWake() = runTest {
        val mic = FakeMic(voice(21) + quiet(15))
        val spotters = Made(mutableListOf(FakeSpotter(mapOf(5 to hey("buddy" to 0.5f), 9 to hey("rahul" to 0.5f)), "")))
        val events = ArrayList<WakeEvent>()
        val job = collect(WakeListener({ mic }, spotters, RAHUL, testOnly = true), events)
        runCurrent()
        job.cancel()
        assertTrue(events.isEmpty())
    }

    @Test fun pausedLetsGoOfTheMicAndComesBack() = runTest {
        val mics = ArrayList<FakeMic>()
        var checks = 0
        val listener = WakeListener(
            mic = { FakeMic(quiet(100)).also { mics.add(it) } },
            spotters = Made(mutableListOf()),
            phrases = RAHUL,
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
            phrases = RAHUL,
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
        val job = collect(WakeListener({ mic }, spotters, RAHUL), events)
        runCurrent()
        advanceTimeBy(5_000)
        runCurrent()
        job.cancel()
        assertEquals(RAHUL + "[unk]", spotters.grammars[0])
        assertTrue(spotters.made.size >= 3) // one to begin with, one after each of the two wakes
        assertTrue(spotters.made[0].let { (it as FakeSpotter).closed })
    }

    @Test fun aMicThatCannotStartIsRetriedEveryFiveSecondsOfClock() = runTest {
        var tries = 0
        val listener = WakeListener({ tries++; FakeMic(emptyList(), starts = false) }, Made(mutableListOf()), RAHUL)
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

    // --- "Only my voice": the check on the phrase's own audio ---

    /** A mic whose chunk number i is all the value i + 1, so a sample shows where in the audio it came from. */
    private fun ramp(n: Int) = List(n) { (it + 1) / 32767f to 1_600 }

    @Test fun aNoFromTheCheckIsSilence() = runTest {
        val said = hey("hey" to 0.7f, "rahul" to 1.6f)
        val mic = FakeMic(voice(21) + voice(15) + quiet(15))
        val spotters = Made(mutableListOf(FakeSpotter(mapOf(20 to said), ""), FakeSpotter(emptyMap(), "")))
        val events = ArrayList<WakeEvent>()
        val job = collect(WakeListener({ mic }, spotters, RAHUL, check = { false }), events)
        runCurrent()
        job.cancel()
        assertTrue(events.isEmpty())
        assertEquals(2, spotters.made.size) // a new recognizer after the refused wake
        assertTrue((spotters.made[0] as FakeSpotter).closed)
        assertEquals(51, mic.reads) // the loop went on listening to the end; nothing took a request
    }

    @Test fun aYesFromTheCheckGivesWokeThenTheRequestAsBefore() = runTest {
        val mic = FakeMic(ramp(21) + voice(15) + quiet(15))
        val spotters = Made(mutableListOf(FakeSpotter(mapOf(20 to hey("hey" to 1.0f, "rahul" to 1.6f)), "")))
        val events = ArrayList<WakeEvent>()
        val job = collect(WakeListener({ mic }, spotters, RAHUL, check = { true }), events)
        runCurrent()
        job.cancel()
        assertEquals(2, events.size)
        val phrase = (events[0] as WakeEvent.Woke).phrase!!
        // hey starts at 0.7 s and rahul ends at 1.6 s: 0.1 s before and after, so 0.6 s .. 1.7 s = chunks 6..16
        assertEquals(((1.6f - 0.7f + 0.2f) * 16000).toInt(), phrase.size)
        assertEquals(7, phrase.first().toInt()) // chunk 6 holds the value 7
        assertEquals(17, phrase.last().toInt())
        assertNotNull((events[1] as WakeEvent.Request).wav)
    }

    @Test fun theCheckGetsTheSameSamplesAsWoke() = runTest {
        val mic = FakeMic(ramp(21) + quiet(20))
        val spotters = Made(mutableListOf(FakeSpotter(mapOf(20 to hey("hey" to 1.0f, "rahul" to 1.6f)), "")))
        val events = ArrayList<WakeEvent>()
        var seen: ShortArray? = null
        val job = collect(WakeListener({ mic }, spotters, RAHUL, check = { seen = it; true }), events)
        runCurrent()
        job.cancel()
        assertArrayEquals((events[0] as WakeEvent.Woke).phrase, seen)
        assertNotNull(seen)
    }

    @Test fun aPhraseTooShortToCutOutReachesTheCheckAsNull() = runTest {
        val mic = FakeMic(voice(25) + quiet(20))
        val spotters = Made(mutableListOf(FakeSpotter(mapOf(20 to hey("hey" to 1.5f, "rahul" to 1.5f)), "")))
        var calls = 0
        var seen: ShortArray? = ShortArray(1)
        val job = collect(WakeListener({ mic }, spotters, RAHUL, check = { calls++; seen = it; false }), ArrayList())
        runCurrent()
        job.cancel()
        assertEquals(1, calls)
        assertNull(seen)
    }

    @Test fun testItOnlyWithANoGivesNotYou() = runTest {
        val mic = FakeMic(voice(21) + quiet(5))
        val spotters = Made(mutableListOf(FakeSpotter(mapOf(20 to hey("hey" to 1.0f, "rahul" to 1.6f)), "")))
        val events = ArrayList<WakeEvent>()
        val job = collect(WakeListener({ mic }, spotters, RAHUL, testOnly = true, check = { false }), events)
        runCurrent()
        job.cancel()
        assertEquals(listOf(WakeEvent.NotYou), events)
    }

    @Test fun withoutACheckAWakeStillHasItsPhrase() = runTest {
        val mic = FakeMic(voice(21) + quiet(20))
        val spotters = Made(mutableListOf(FakeSpotter(mapOf(20 to hey("hey" to 1.0f, "rahul" to 1.6f)), "")))
        val events = ArrayList<WakeEvent>()
        val job = collect(WakeListener({ mic }, spotters, RAHUL), events)
        runCurrent()
        job.cancel()
        assertNotNull((events[0] as WakeEvent.Woke).phrase)
    }

    // --- "Yes?" after a bare wake ---

    private class Asked {
        val log = ArrayList<String>()
        val mics = ArrayList<FakeMic>()
    }

    private fun asking(a: Asked, canAsk: Boolean = true, testOnly: Boolean = false, check: ((ShortArray?) -> Boolean)? = null, said: String, second: List<Pair<Float, Int>>) =
        WakeListener(
            mic = {
                a.log += "mic ${a.mics.size}"
                (if (a.mics.isEmpty()) FakeMic(voice(21)) else FakeMic(second)).also { a.mics.add(it) }
            },
            spotters = Made(mutableListOf(FakeSpotter(mapOf(2 to said), ""), FakeSpotter(emptyMap(), ""))),
            phrases = RAHUL, testOnly = testOnly, check = check,
            canAsk = { canAsk }, ask = { a.log += "yes (mic0 stopped=${a.mics[0].stopped})" },
        )

    @Test fun aBareWakeSaysYesWithTheMicLetGoOfThenRecordsOnlyAfterIt() = runTest {
        val a = Asked()
        val events = ArrayList<WakeEvent>()
        val l = asking(a, said = hey("hey" to 0.1f, "rahul" to 0.2f), second = voice(10) + quiet(15))
        val job = collect(l, events)
        runCurrent()
        advanceTimeBy(300); runCurrent() // after "Yes?"
        job.cancel()
        assertEquals(listOf("mic 0", "yes (mic0 stopped=true)", "mic 1"), a.log.take(3)) // then it listens for the next wake
        assertTrue(events[0] is WakeEvent.Woke)
        val wav = (events[1] as WakeEvent.Request).wav
        assertNotNull(wav)
        assertEquals(44 + 22 * 1_600 * 2, wav!!.size) // only the new microphone's audio: 10 of voice, 12 quiet
    }

    @Test fun aWakeWithWordsAfterItDoesNotSayYes() = runTest {
        val a = Asked()
        val events = ArrayList<WakeEvent>()
        val l = asking(a, said = hey("hey" to 0.1f, "rahul" to 0.2f, "call" to 0.5f), second = quiet(5))
        val job = collect(l, events)
        runCurrent()
        job.cancel()
        assertTrue(a.log.none { it.startsWith("yes") })
        assertTrue(events[1] is WakeEvent.Request)
    }

    @Test fun busyTestOnlyAndANoFromTheCheckNeverSayYes() = runTest {
        val said = hey("hey" to 0.1f, "rahul" to 0.2f)
        for (case in 0..2) {
            val a = Asked()
            val events = ArrayList<WakeEvent>()
            val l = when (case) {
                0 -> asking(a, canAsk = false, said = said, second = quiet(5))
                1 -> asking(a, testOnly = true, said = said, second = quiet(5))
                else -> asking(a, check = { false }, said = said, second = quiet(5))
            }
            val job = collect(l, events)
            runCurrent()
            job.cancel()
            assertTrue("case $case", a.log.none { it.startsWith("yes") })
            if (case == 2) assertTrue(events.isEmpty())
        }
    }

    @Test fun nothingSaidAfterYesIsNoRecording() = runTest {
        val a = Asked()
        val events = ArrayList<WakeEvent>()
        val l = asking(a, said = hey("hey" to 0.1f, "rahul" to 0.2f), second = quiet(100))
        val job = collect(l, events)
        runCurrent()
        advanceTimeBy(300); runCurrent() // after "Yes?"
        job.cancel()
        assertNull((events[1] as WakeEvent.Request).wav)
    }
}
