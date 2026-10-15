package com.akshatgg.buddy.voice

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WakeRulesTest {
    private val all = WakeSituation(
        wakeOn = true, buddyOn = true, signedIn = true, voiceOn = true,
        micAllowed = true, modelReady = true, nameOk = true, micService = true,
    )

    @Test fun listensWhenEverythingIsTrue() = assertTrue(WakeRules.listen(all))

    @Test fun eachMissingThingStopsIt() {
        assertFalse(WakeRules.listen(all.copy(wakeOn = false)))
        assertFalse(WakeRules.listen(all.copy(buddyOn = false)))
        assertFalse(WakeRules.listen(all.copy(signedIn = false)))
        assertFalse(WakeRules.listen(all.copy(voiceOn = false)))
        assertFalse(WakeRules.listen(all.copy(micAllowed = false)))
        assertFalse(WakeRules.listen(all.copy(modelReady = false)))
        assertFalse(WakeRules.listen(all.copy(nameOk = false)))
        assertFalse(WakeRules.listen(all.copy(micService = false)))
    }

    @Test fun nothingIsPausedWhenAllIsQuiet() = assertFalse(WakeRules.paused(false, false, 0, false))

    @Test fun eachBusyThingPauses() {
        assertTrue(WakeRules.paused(inCall = true, silenced = false, micBusy = 0, turn = false))
        assertTrue(WakeRules.paused(inCall = false, silenced = true, micBusy = 0, turn = false))
        assertTrue(WakeRules.paused(inCall = false, silenced = false, micBusy = 1, turn = false))
        assertTrue(WakeRules.paused(inCall = false, silenced = false, micBusy = 0, turn = true))
    }
}
