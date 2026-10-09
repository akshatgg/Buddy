package com.akshatgg.buddy.ui.panel

/** What a pull on the card's handle does, once the finger lets go. */
enum class SheetMove { STAY, EXPAND, COLLAPSE, CLOSE }

/** How far the handle is pulled to count, as a share of the screen's height: a little under a sixth. */
const val SHEET_PULL = 0.15f

/** How fast a flick counts on its own, however short: half the screen's height in a second. */
const val SHEET_FLICK = 0.5f

/**
 * What a pull on the card's handle does, in plain Kotlin so that it is tested on the JVM. `full`: the card filled the
 * screen when the pull began. `dragY` is how far the finger went (down is more), `velocityY` how fast it was going as
 * it let go (px a second, down is more), `screenHeight` the screen's height in px. Up from the normal card fills the
 * screen; down from a full one goes back to the normal card; down from the normal card closes it, as a tap outside it
 * does. A pull that is short and slow stays as it was. A flick wins over the way the finger went before it, as it is
 * the finger's last word.
 */
fun sheetMove(full: Boolean, dragY: Float, velocityY: Float, screenHeight: Float): SheetMove {
    if (screenHeight <= 0f || !dragY.isFinite() || !velocityY.isFinite()) return SheetMove.STAY
    val far = screenHeight * SHEET_PULL
    val fast = screenHeight * SHEET_FLICK
    val up = when {
        velocityY <= -fast -> true
        velocityY >= fast -> false
        dragY <= -far -> true
        dragY >= far -> false
        else -> return SheetMove.STAY
    }
    return when {
        up -> if (full) SheetMove.STAY else SheetMove.EXPAND
        full -> SheetMove.COLLAPSE
        else -> SheetMove.CLOSE
    }
}
