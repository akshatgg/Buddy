package com.akshatgg.buddy.bubble

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MoodsTest {
    @Test fun blinksEveryThreeToSixSecondsAndSaysSoBeforehand() {
        val b = Blinker { 0.5 }               // first blink at 2 + 1.5 = 3.5 s
        assertEquals(0f, b.value(3.4))
        assertTrue(b.soon(3.4, 1.0 / Moods.REST_FPS))
        assertEquals(1f, b.value(3.57), 0.01f)  // shut at 70 ms
        assertEquals(0f, b.value(3.7))          // done, next one scheduled 3 + 1.5 s later
        assertFalse(b.soon(4.0, 0.1))
    }

    @Test fun theHappyEyesNeverBlinkAndShutEyesStayShut() {
        assertEquals(0f, Moods.blinkWeight(Moods.pose(Mood.HAPPY, 0.1), 1f))
        assertEquals(1f, Moods.blinkWeight(Moods.pose(Mood.SLEEPY, 3.0), 0f))
        assertEquals(0.4f, Moods.blinkWeight(Moods.pose(Mood.IDLE, 0.0), 0.4f))
    }

    @Test fun shortMoodsEndOnTheirOwn() {
        assertFalse(Moods.pose(Mood.HAPPY, 1.0).done); assertTrue(Moods.pose(Mood.HAPPY, 1.2).done)
        assertTrue(Moods.pose(Mood.WAVE, 1.8).done)
        assertFalse(Moods.pose(Mood.THINKING, 30.0).done)
        assertFalse(Moods.pose(Mood.SLEEPY, 30.0).done)
        assertFalse(Moods.pose(Mood.WOBBLE, 30.0).done)
        assertFalse(Moods.pose(Mood.IDLE, 30.0).done)
    }

    @Test fun thinkingSweepsTheEyesLikeAScanner() {
        val p = Moods.pose(Mood.THINKING, 0.2)
        assertTrue(p.eyesClosed)
        assertTrue(p.eyeL in -1f..1f && p.eyeR in -1f..1f && p.eyeL != p.eyeR)
    }

    @Test fun drawsAsSeldomAsItCan() {
        assertEquals(Moods.FPS, Moods.fpsFor(Mood.THINKING, pressing = false, blinkSoon = false, sinceActive = 99.0))
        assertEquals(Moods.IDLE_FPS, Moods.fpsFor(Mood.IDLE, false, false, 3.0))
        assertEquals(Moods.REST_FPS, Moods.fpsFor(Mood.IDLE, false, false, 30.0))
        assertEquals(Moods.FPS, Moods.fpsFor(Mood.IDLE, false, true, 30.0))
        assertEquals(Moods.FPS, Moods.fpsFor(Mood.IDLE, true, false, 30.0))
    }

    @Test fun floatsUpAndDownOnceEveryThreeSeconds() {
        assertEquals(0f, Moods.floatOffset(0.0), 1e-6f)
        assertEquals(0.035f, Moods.floatOffset(0.75), 1e-6f)
        assertEquals(0f, Moods.floatOffset(3.0), 1e-5f)
    }

    @Test fun aPickerHeadTurnsSlowlyFromSideToSide() {
        assertEquals(0f, Moods.turn(0.0), 1e-6f)
        assertEquals(0.5f, Moods.turn(2.0), 1e-6f)
        assertEquals(-0.5f, Moods.turn(6.0), 1e-6f)
        assertEquals(0f, Moods.turn(8.0), 1e-5f)
    }

    @Test fun aHeadToldToStopTurningFinishesItsSwingFacingFront() {
        assertEquals(4.0, Moods.turnEnd(0.1), 1e-9)
        assertEquals(8.0, Moods.turnEnd(5.0), 1e-9)
        assertEquals(8.0, Moods.turnEnd(8.0), 1e-9)
        for (t in listOf(0.3, 2.0, 5.5, 13.7)) assertEquals(0f, Moods.turn(Moods.turnEnd(t)), 1e-5f)
    }

    @Test fun theWaveTurnsTheHeadAndSmiles() {
        val p = Moods.pose(Mood.WAVE, 0.5)
        assertEquals(0.8f, p.smile)
        assertTrue(p.yaw != 0f && p.yaw in -0.25f..0.25f)
    }
}

class SnapTest {
    @Test fun goesToTheNearerEdgeAndStaysOnScreen() {
        assertEquals(Spot(8, 300), Snap.toEdge(x = 100, y = 300, size = 150, screenW = 1080, screenH = 2400, margin = 8))
        assertEquals(Spot(1080 - 150 - 8, 2400 - 150 - 8), Snap.toEdge(900, 5000, 150, 1080, 2400, 8))
        assertEquals(Spot(8, 8), Snap.toEdge(-50, -40, 150, 1080, 2400, 8))
    }

    @Test fun theCloseTargetCatchesTheHeadNearIt() {
        assertTrue(Snap.nearTarget(540f, 2200f, 540f, 2250f, 120f))
        assertFalse(Snap.nearTarget(540f, 1900f, 540f, 2250f, 120f))
    }

    @Test fun theHeightIsRememberedAsAFractionOfTheScreen() {
        val f = Snap.yFraction(1000, 150, 2400)
        assertEquals(1000, Snap.yFromFraction(f, 150, 2400, 8))
        assertEquals(2400 - 150 - 8, Snap.yFromFraction(2f, 150, 2400, 8))
    }
}
