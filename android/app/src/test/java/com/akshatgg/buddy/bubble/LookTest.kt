package com.akshatgg.buddy.bubble

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LookTest {
    private val box = ScreenRect(100f, 1000f, 900f, 1100f)

    @Test fun looksAtTheMiddleOfTheBoxWithoutACursor() {
        assertEquals(LookPoint(500f, 1050f), Look.point(box, cursor = null))
    }

    @Test fun looksAtTheCursorWhenAndroidSaysWhereItIs() {
        assertEquals(LookPoint(300f, 1040f), Look.point(box, ScreenRect(300f, 1020f, 300f, 1060f)))
    }

    @Test fun aCursorOutsideTheBoxIsNotBelieved() {
        assertEquals(LookPoint(500f, 1050f), Look.point(box, ScreenRect(1200f, 1020f, 1210f, 1060f)))
    }

    @Test fun turnsAsTheMacDoesInDp() {
        // 240 dp to the right and 100 dp down, at density 1: the Mac's lookAt(240, 100).
        val t = Look.turn(LookPoint(340f, 600f), headX = 100f, headY = 500f, density = 1f)
        assertEquals(0.4f, t.yaw, 1e-6f)
        assertEquals(0.2f, t.pitch, 1e-6f)
        // The same pixels on a screen twice as dense are half as far.
        val dense = Look.turn(LookPoint(340f, 600f), headX = 100f, headY = 500f, density = 2f)
        assertEquals(0.2f, dense.yaw, 1e-6f)
        assertEquals(0.1f, dense.pitch, 1e-6f)
    }

    @Test fun neverTurnsFurtherThanTheMac() {
        val farRightDown = Look.turn(LookPoint(5000f, 5000f), 0f, 0f, 1f)
        assertEquals(Turn(0.45f, 0.25f), farRightDown)
        val farLeftUp = Look.turn(LookPoint(-5000f, -5000f), 0f, 0f, 1f)
        assertEquals(Turn(-0.45f, -0.2f), farLeftUp)
        assertEquals(Turn(0f, 0f), Look.turn(LookPoint(10f, 20f), 10f, 20f, 3f))
    }

    @Test fun theTurnEasesInAndOutOverAQuarterSecond() {
        val ease = LookEase()
        assertEquals(Turn(0f, 0f), ease.value(0.0))
        assertFalse(ease.moving(0.0))
        ease.to(Turn(0.4f, 0.2f), t = 1.0)
        assertTrue(ease.moving(1.0))
        assertEquals(Turn(0f, 0f), ease.value(1.0))
        val early = ease.value(1.05)
        assertTrue(early.yaw > 0f && early.yaw < 0.4f * 0.2f) // slow at first
        assertEquals(0.2f, ease.value(1.125).yaw, 1e-6f) // half way at half time
        assertEquals(Turn(0.4f, 0.2f), ease.value(1.25))
        assertFalse(ease.moving(1.25))
        assertEquals(Turn(0.4f, 0.2f), ease.value(9.0))
    }

    @Test fun aNewTargetMidTurnStartsFromWhereTheHeadIs() {
        val ease = LookEase()
        ease.to(Turn(0.4f, 0f), t = 0.0)
        val mid = ease.value(0.125)
        ease.to(Turn(0f, 0f), t = 0.125)
        assertEquals(mid, ease.value(0.125))
        assertEquals(Turn(0f, 0f), ease.value(0.375))
    }

    @Test fun theSameTargetAgainDoesNotStartTheTurnOver() {
        val ease = LookEase()
        ease.to(Turn(0.4f, 0f), t = 0.0)
        ease.to(Turn(0.4f, 0f), t = 0.2)
        assertFalse(ease.moving(0.25))
    }
}
