package com.akshatgg.buddy.calls

import org.junit.Assert.assertEquals
import org.junit.Test

class RingTest {
    @Test fun ringingKeepsTheNumberAndTheEndForgetsIt() {
        val r = Ring().after("RINGING", "+919812345678")
        assertEquals(Ring(true, "+919812345678"), r)
        assertEquals(Ring(), r.after("OFFHOOK", null))
        assertEquals(Ring(), r.after("IDLE", null))
    }
    @Test fun androidsSecondBroadcastWithoutTheNumberKeepsIt() {
        // Android 10 and later send the ringing twice: with the number (READ_CALL_LOG) and without.
        assertEquals(Ring(true, "+91981"), Ring().after("RINGING", "+91981").after("RINGING", null))
        assertEquals(Ring(true, "+91981"), Ring().after("RINGING", null).after("RINGING", "+91981"))
    }
    @Test fun aNewRingDoesNotKeepAnOldNumber() {
        assertEquals(Ring(true, null), Ring(false, "+91981").after("RINGING", ""))
    }
    @Test fun anythingElseChangesNothing() {
        assertEquals(Ring(true, "1"), Ring(true, "1").after(null, null))
    }
}
