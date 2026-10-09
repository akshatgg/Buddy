package com.akshatgg.buddy.bubble

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ClawdTest {
    @Test fun everyFrameIsTwelveByEightWithItsLegs() {
        for ((name, rows) in Clawd.FRAMES) {
            assertEquals(name, Clawd.ROWS, rows.size)
            rows.forEach { assertEquals("$name: $it", Clawd.COLUMNS, it.length) }
        }
        assertEquals(8, Clawd.FRAMES.getValue("stand").takeLast(2).sumOf { row -> row.count { it == 'X' } })
    }

    @Test fun workingWalksAStepEveryQuarterSecond() {
        val a = Clawd.pose(ClawdKind.WORKING, 0.0)
        assertTrue(a.visible); assertEquals("walkA", a.frame); assertEquals(ClawdEyes.OPEN, a.eyes)
        assertEquals("walkB", Clawd.pose(ClawdKind.WORKING, Clawd.STEP).frame)
        assertEquals(0.5f, Clawd.pose(ClawdKind.WORKING, Clawd.STEP).lift)
        assertTrue(Clawd.pose(ClawdKind.WORKING, 3600.0).visible)
        assertEquals("walkA", Clawd.pose(ClawdKind.WORKING, -2.0).frame)
    }

    @Test fun needsYouWavesDoneIsHappyAMomentFailedDroops() {
        assertEquals("stand", Clawd.pose(ClawdKind.NEEDS_YOU, 0.0).frame)
        assertEquals("wave", Clawd.pose(ClawdKind.NEEDS_YOU, Clawd.WAVE).frame)
        val done = Clawd.pose(ClawdKind.DONE, 0.2)
        assertEquals(ClawdEyes.HAPPY, done.eyes); assertTrue(done.lift > 0f)
        assertFalse(Clawd.pose(ClawdKind.DONE, Clawd.MOMENT).visible)
        assertEquals(ClawdEyes.SAD, Clawd.pose(ClawdKind.FAILED, 1.0).eyes)
        assertFalse(Clawd.pose(ClawdKind.FAILED, Clawd.MOMENT + 1).visible)
        assertFalse(Clawd.pose(null, 0.0).visible)
    }

    @Test fun workingWalksBackAndForthFacingTheWayItGoes() {
        val quarter = Math.PI / 2 / Clawd.PACE
        assertEquals(1f, Clawd.pose(ClawdKind.WORKING, quarter, walk = quarter).x, 1e-6f)
        assertEquals(1f, Clawd.pose(ClawdKind.WORKING, 0.1, walk = 0.1).facing)
        assertEquals(-1f, Clawd.pose(ClawdKind.WORKING, 0.1, walk = quarter + 0.1).facing)
        for (kind in listOf(ClawdKind.NEEDS_YOU, ClawdKind.DONE, ClawdKind.FAILED)) assertEquals(0f, Clawd.pose(kind, 0.1).x)
    }

    @Test fun theTwoLooksTheHeadWatchesUpOrDownAndEasesThere() {
        assertEquals(Clawd.LOOKS.getValue("face"), Clawd.lookOf("face"))
        for (name in listOf("head", null, "eyes")) assertEquals(Clawd.LOOKS.getValue("head"), Clawd.lookOf(name))
        val pose = ClawdPose(true, "walkA", ClawdEyes.OPEN, 0f, x = 0.5f)
        val up = Clawd.watch(pose, Clawd.lookOf("head"), ClawdWatch(), 10.0)
        assertEquals(0.6f, up.look, 1e-4f); assertTrue(up.pitch < 0f); assertEquals(0.09f, up.yaw, 1e-4f); assertEquals(1f, up.amount, 1e-4f)
        assertTrue(Clawd.watch(pose, Clawd.lookOf("face"), ClawdWatch(), 10.0).look < 0f)
        val halfway = Clawd.watch(pose, Clawd.lookOf("head"), ClawdWatch(), 0.05)
        assertTrue(halfway.look > 0f && halfway.look < 0.6f)
        val back = Clawd.watch(ClawdPose(false, "stand", ClawdEyes.OPEN, 0f), Clawd.lookOf("head"), up, 10.0)
        assertEquals(0f, back.amount, 1e-4f)
    }

    @Test fun theKindFollowsTheSessions() {
        assertEquals(ClawdKind.NEEDS_YOU, Clawd.kindOf(listOf("working", "waiting"), null))
        assertEquals(ClawdKind.WORKING, Clawd.kindOf(listOf("idle", "working"), null))
        assertNull(Clawd.kindOf(listOf("done", "idle"), null))
        assertEquals(ClawdKind.DONE, Clawd.kindOf(listOf("done"), ClawdKind.WORKING))
        assertEquals(ClawdKind.FAILED, Clawd.kindOf(listOf("failed", "done"), ClawdKind.NEEDS_YOU))
        assertEquals("the session ended", ClawdKind.DONE, Clawd.kindOf(emptyList(), ClawdKind.WORKING))
        assertNull(Clawd.kindOf(listOf("done"), ClawdKind.DONE))
    }

    @Test fun theWatchLooksOftenWhileAComputerSharesAndSaysEachChange() = runTest {
        val kinds = mutableListOf<ClawdKind?>()
        var answer: List<String>? = listOf("working")
        var off = false
        val watch = ClaudeWatch(this, look = { answer ?: throw IllegalStateException("offline") }, paused = { off }, onKind = { kinds += it })
        assertEquals(CLAUDE_LOOK_MS, watch.step())
        assertEquals(CLAUDE_LOOK_MS, watch.step())
        answer = listOf("idle")
        assertEquals(CLAUDE_LOOK_MS, watch.step())
        answer = null
        assertEquals(CLAUDE_QUIET_MS, watch.step())
        off = true
        answer = listOf("waiting")
        assertEquals(CLAUDE_LOOK_MS, watch.step())
        assertEquals(listOf(ClawdKind.WORKING, ClawdKind.DONE, null), kinds)
        off = false
        watch.step()
        watch.stop()
        assertEquals(listOf(ClawdKind.WORKING, ClawdKind.DONE, null, ClawdKind.NEEDS_YOU, null), kinds)
    }
}
