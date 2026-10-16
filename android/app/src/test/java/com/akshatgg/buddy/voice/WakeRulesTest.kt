package com.akshatgg.buddy.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WakeRulesTest {
    private val all = WakeSituation(
        wakeOn = true, buddyOn = true, signedIn = true, voiceOn = true,
        micAllowed = true, modelReady = true, micService = true,
    )

    @Test fun listensWhenEverythingIsTrue() = assertTrue(WakeRules.listen(all))

    @Test fun eachMissingThingStopsIt() {
        assertFalse(WakeRules.listen(all.copy(wakeOn = false)))
        assertFalse(WakeRules.listen(all.copy(buddyOn = false)))
        assertFalse(WakeRules.listen(all.copy(signedIn = false)))
        assertFalse(WakeRules.listen(all.copy(voiceOn = false)))
        assertFalse(WakeRules.listen(all.copy(micAllowed = false)))
        assertFalse(WakeRules.listen(all.copy(modelReady = false)))
        assertFalse(WakeRules.listen(all.copy(micService = false)))
    }

    @Test fun nothingIsPausedWhenAllIsQuiet() = assertFalse(WakeRules.paused(false, 0, false))

    @Test fun eachBusyThingPauses() {
        assertTrue(WakeRules.paused(inCall = true, micBusy = 0, turn = false))
        assertTrue(WakeRules.paused(inCall = false, micBusy = 1, turn = false))
        assertTrue(WakeRules.paused(inCall = false, micBusy = 0, turn = true))
    }

    @Test fun aNameTheModelCannotHearDoesNotStopTheListening() {
        // nameHeard only picks the copy: WakeSituation has no name at all, and "Hey Buddy" always wakes it
        assertTrue(WakeRules.listen(all))
        assertEquals(listOf("hey buddy", "buddy"), VoiceWords.wakePhrases("Aarav", setOf("aarav")))
    }

    @Test fun aNameIsHeardUnlessLettersOrModelLackIt() {
        assertFalse(WakeRules.nameHeard("Buddy", emptySet()))
        assertFalse(WakeRules.nameHeard("Hey", emptySet()))
        assertFalse(WakeRules.nameHeard("Hey Buddy", emptySet()))
        assertEquals(listOf("hey rahul", "rahul", "hey buddy", "buddy"), VoiceWords.wakePhrases("Hey Rahul", emptySet()))
        assertTrue(WakeRules.nameHeard("Rahul", emptySet()))
        assertFalse(WakeRules.nameHeard("Rahul", setOf("rahul")))
        assertFalse(WakeRules.nameHeard("R2D2", emptySet()))
        assertFalse(WakeRules.nameHeard("", emptySet()))
    }

    @Test fun untilQuietWaitsForTwoQuietPollsInARow() = kotlinx.coroutines.test.runTest {
        var polls = 0
        val answers = listOf(true, true, false, true, false, false) // busy, busy, quiet, busy again, quiet, quiet
        WakeRules.untilQuiet(pollMs = 250) { answers[polls++] }
        assertEquals(6, polls)
        assertEquals(1_250L, testScheduler.currentTime)
    }

    @Test fun untilQuietGivesUpAfterTheMaximum() = kotlinx.coroutines.test.runTest {
        WakeRules.untilQuiet(pollMs = 250, maxMs = 1_000) { true }
        assertEquals(1_000L, testScheduler.currentTime)
    }
}
