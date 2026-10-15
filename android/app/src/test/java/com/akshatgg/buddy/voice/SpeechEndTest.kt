package com.akshatgg.buddy.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** When listening ends (src/renderer/panel/voice-timing.js, test/voice-timing.test.js). */
class SpeechEndTest {
    private val loud = 0.2f
    private val quiet = 0.01f

    private fun run(end: SpeechEnd, from: Long, to: Long, level: (Long) -> Float): Map<Long, End> {
        val out = LinkedHashMap<Long, End>()
        var ms = from
        while (ms <= to) { out[ms] = end.feed(level(ms), ms); ms += 100 }
        return out
    }

    @Test fun theNumbersAreTheOnesAgreed() {
        assertEquals(0.06f, SpeechEnd.SPEECH_LEVEL, 0f)
        assertEquals(300L, SpeechEnd.MIN_SPEECH_MS)
        assertEquals(250L, SpeechEnd.LEVEL_SPAN_MS)
    }

    @Test fun itKeepsListeningWhileThePersonSpeaks() {
        val end = SpeechEnd()
        assertTrue(run(end, 100, 5_000) { loud }.values.all { it == End.LISTEN })
        assertTrue(end.heardVoice)
    }

    @Test fun oneAndAHalfSecondsOfQuietAfterSpeakingEndsIt() {
        val end = SpeechEnd()
        val out = run(end, 100, 4_000) { if (it in 1_501..2_500) loud else quiet }
        assertEquals(End.LISTEN, out[3_900]); assertEquals(End.DONE, out[4_000]); assertTrue(end.heardVoice)
    }

    @Test fun aShortPauseBetweenWordsDoesNotEndIt() {
        val out = run(SpeechEnd(), 100, 4_500) { if (it <= 1_000 || it in 2_301..3_000) loud else quiet }
        assertTrue(out.filterKeys { it < 4_500 }.values.all { it == End.LISTEN })
        assertEquals(End.DONE, out[4_500])
    }

    @Test fun aLevelAtTheSpeechLevelIsSpeechAndOneJustUnderIsNot() {
        val a = SpeechEnd(); run(a, 100, 300) { SpeechEnd.SPEECH_LEVEL }; assertTrue(a.heardVoice)
        val b = SpeechEnd(); run(b, 100, 3_000) { SpeechEnd.SPEECH_LEVEL - 0.001f }; assertFalse(b.heardVoice)
    }

    @Test fun tooLittleSoundIsNoiseNotAVoice() {
        val end = SpeechEnd()
        assertTrue(run(end, 100, 7_900) { if (it in 1_001..1_200) loud else quiet }.values.all { it == End.LISTEN })
        assertFalse(end.heardVoice)
        assertEquals(End.NOTHING, end.feed(quiet, 8_000))
    }

    @Test fun shortSoundsThatAddUpTo300MsAreAVoice() {
        val end = SpeechEnd()
        val out = run(end, 100, 2_900) { if (it == 1_000L || it == 1_200L || it == 1_400L) loud else quiet }
        assertTrue(end.heardVoice); assertEquals(End.LISTEN, out[2_800]); assertEquals(End.DONE, out[2_900])
    }

    @Test fun aWordBegunJustBefore8sIsHeardOut() {
        val out = run(SpeechEnd(), 100, 9_800) { if (it in 7_900..8_300) loud else quiet }
        assertEquals(End.LISTEN, out[8_000]); assertEquals(End.LISTEN, out[9_700]); assertEquals(End.DONE, out[9_800])
    }

    @Test fun at60sItIsTooLong() {
        val talking = SpeechEnd()
        val out = run(talking, 100, 60_000) { loud }
        assertEquals(End.LISTEN, out[59_900]); assertEquals(End.TOO_LONG, out[60_000]); assertTrue(talking.heardVoice)
        val out2 = run(SpeechEnd(), 100, 60_000) { if (it % 2_000 < 1_000) loud else quiet }
        assertEquals(End.LISTEN, out2[59_900]); assertEquals(End.TOO_LONG, out2[60_000])
    }

    @Test fun quietAfterSpeechAt60sIsDoneRatherThanTooLong() {
        val end = SpeechEnd(); run(end, 58_000, 58_500) { loud }
        assertEquals(End.DONE, end.feed(quiet, 60_000))
    }

    @Test fun onceItHasEndedItStaysEnded() {
        val done = SpeechEnd(); run(done, 100, 500) { loud }
        assertEquals(End.DONE, done.feed(quiet, 2_000)); assertEquals(End.DONE, done.feed(loud, 2_100))
        val nothing = SpeechEnd()
        assertEquals(End.NOTHING, nothing.feed(quiet, 8_000)); assertEquals(End.NOTHING, nothing.feed(loud, 8_100))
        assertFalse(nothing.heardVoice)
    }

    @Test fun aLongGapWithNoLevelsIsNotTakenForThatMuchSpeech() {
        val end = SpeechEnd()
        assertEquals(End.LISTEN, end.feed(loud, 3_000)); assertFalse(end.heardVoice)
        end.feed(loud, 3_100); assertTrue(end.heardVoice)
    }

    @Test fun aLevelThatIsNotANumberIsQuiet() {
        val end = SpeechEnd()
        var ms = 100L
        while (ms <= 1_000) { assertEquals(End.LISTEN, end.feed(Float.NaN, ms)); ms += 100 }
        assertFalse(end.heardVoice)
    }

    @Test fun theQuietAndTheLongestAreOptions() {
        val end = SpeechEnd(quietMs = 1_200, nothingMs = 8_000, maxMs = 20_000)
        var ms = 0L
        while (ms <= 1_000) { assertEquals(End.LISTEN, end.feed(0.2f, ms)); ms += 100 }
        assertEquals(End.LISTEN, end.feed(0.0f, 2_100))
        assertEquals(End.DONE, end.feed(0.0f, 2_200))
    }

    @Test fun nothingSaidEndsAtNothingMs() {
        val end = SpeechEnd(nothingMs = 8_000)
        assertEquals(End.LISTEN, end.feed(0f, 7_900))
        assertEquals(End.NOTHING, end.feed(0f, 8_000))
        assertFalse(end.heardVoice)
    }
}
