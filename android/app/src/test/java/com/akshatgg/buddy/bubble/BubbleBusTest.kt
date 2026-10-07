package com.akshatgg.buddy.bubble

import org.junit.After
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
}
