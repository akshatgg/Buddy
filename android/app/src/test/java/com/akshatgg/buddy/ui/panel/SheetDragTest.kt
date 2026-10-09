package com.akshatgg.buddy.ui.panel

import org.junit.Assert.assertEquals
import org.junit.Test

class SheetDragTest {
    private val screen = 2_000f // px: a pull counts from 300 px, a flick from 1000 px a second

    @Test fun upFromTheCardFillsTheScreen() {
        assertEquals(SheetMove.EXPAND, sheetMove(full = false, dragY = -300f, velocityY = 0f, screenHeight = screen))
        assertEquals(SheetMove.EXPAND, sheetMove(full = false, dragY = -900f, velocityY = -200f, screenHeight = screen))
    }

    @Test fun downFromFullScreenGoesBackToTheCard() {
        assertEquals(SheetMove.COLLAPSE, sheetMove(full = true, dragY = 300f, velocityY = 0f, screenHeight = screen))
        assertEquals(SheetMove.COLLAPSE, sheetMove(full = true, dragY = 1_800f, velocityY = 0f, screenHeight = screen))
    }

    @Test fun downFromTheCardClosesIt() {
        assertEquals(SheetMove.CLOSE, sheetMove(full = false, dragY = 300f, velocityY = 0f, screenHeight = screen))
    }

    @Test fun aShortSlowPullStaysAsItWas() {
        assertEquals(SheetMove.STAY, sheetMove(full = false, dragY = -299f, velocityY = -999f, screenHeight = screen))
        assertEquals(SheetMove.STAY, sheetMove(full = false, dragY = 299f, velocityY = 999f, screenHeight = screen))
        assertEquals(SheetMove.STAY, sheetMove(full = true, dragY = 120f, velocityY = 0f, screenHeight = screen))
        assertEquals(SheetMove.STAY, sheetMove(full = false, dragY = 0f, velocityY = 0f, screenHeight = screen))
    }

    @Test fun upWhenFullAlreadyStays() {
        assertEquals(SheetMove.STAY, sheetMove(full = true, dragY = -600f, velocityY = -3_000f, screenHeight = screen))
    }

    @Test fun aFlickCountsHoweverShort() {
        assertEquals(SheetMove.EXPAND, sheetMove(full = false, dragY = -10f, velocityY = -1_000f, screenHeight = screen))
        assertEquals(SheetMove.CLOSE, sheetMove(full = false, dragY = 10f, velocityY = 1_000f, screenHeight = screen))
        assertEquals(SheetMove.COLLAPSE, sheetMove(full = true, dragY = 10f, velocityY = 1_500f, screenHeight = screen))
    }

    @Test fun aFlickWinsOverTheWayTheFingerWentBefore() {
        // Pulled up far, then flicked back down: the card does not grow, it closes.
        assertEquals(SheetMove.CLOSE, sheetMove(full = false, dragY = -500f, velocityY = 1_200f, screenHeight = screen))
        // Pulled down far from full screen, then flicked back up: it stays full.
        assertEquals(SheetMove.STAY, sheetMove(full = true, dragY = 500f, velocityY = -1_200f, screenHeight = screen))
    }

    @Test fun noScreenOrOddNumbersMoveNothing() {
        assertEquals(SheetMove.STAY, sheetMove(full = false, dragY = -500f, velocityY = 0f, screenHeight = 0f))
        assertEquals(SheetMove.STAY, sheetMove(full = false, dragY = Float.NaN, velocityY = 0f, screenHeight = screen))
        assertEquals(SheetMove.STAY, sheetMove(full = true, dragY = 0f, velocityY = Float.POSITIVE_INFINITY, screenHeight = screen))
    }
}
