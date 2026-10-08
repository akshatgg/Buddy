package com.akshatgg.buddy.bubble

import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BubbleBusTest {
    private val panel = Any()
    private val fix = Any()

    @After fun noSheetLeftOpen() {
        BubbleBus.sheetGone(panel)
        BubbleBus.sheetGone(fix)
    }

    @Test fun aFixOverThePanelKeepsTheHeadAwayUntilThePanelGoesToo() {
        BubbleBus.sheetShown(panel)
        BubbleBus.sheetShown(fix)
        BubbleBus.sheetGone(fix)
        assertTrue(BubbleBus.sheetOpen.value)
        BubbleBus.sheetGone(panel)
        assertFalse(BubbleBus.sheetOpen.value)
    }

    @Test fun aSheetShownAgainAfterATurnOfThePhoneGoesAtOnce() {
        BubbleBus.sheetShown(fix)
        BubbleBus.sheetShown(fix)
        BubbleBus.sheetGone(fix)
        assertFalse(BubbleBus.sheetOpen.value)
    }

    @Test fun whereThePersonTypesReachesTheBuddy() = runTest {
        val got = mutableListOf<BubbleEvent>()
        val buddy = launch(UnconfinedTestDispatcher(testScheduler)) { BubbleBus.events.collect { got += it } }
        BubbleBus.lookAt(120f, 1800f)
        BubbleBus.lookAway()
        assertEquals(listOf(BubbleEvent.LookAt(120f, 1800f), BubbleEvent.LookAway), got)
        buddy.cancel()
    }

    @Test fun aLookNeverShowsAHeadThatASheetHides() {
        BubbleBus.sheetShown(panel)
        BubbleBus.lookAt(120f, 1800f)
        assertTrue(BubbleBus.sheetOpen.value)
    }

    @Test fun saysWhetherABuddyIsListening() = runTest {
        assertFalse(BubbleBus.listening)
        val buddy = launch(UnconfinedTestDispatcher(testScheduler)) { BubbleBus.events.collect {} }
        assertTrue(BubbleBus.listening)
        buddy.cancel()
        assertFalse(BubbleBus.listening)
    }
}
