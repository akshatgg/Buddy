package com.akshatgg.buddy.bubble

import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

data class Spot(val x: Int, val y: Int)

/** Where the head goes: pure functions on pixels, so they can be tested without a screen. */
object Snap {
    // Like the Mac's clamp: when the area is too small the low bound wins.
    private fun clamp(v: Int, lo: Int, hi: Int) = min(max(v, lo), max(lo, hi))

    /** Glide to the nearer left or right edge, staying inside the screen. */
    fun toEdge(x: Int, y: Int, size: Int, screenW: Int, screenH: Int, margin: Int): Spot {
        val left = x + size / 2.0 < screenW / 2.0
        val edgeX = if (left) margin else screenW - size - margin
        return Spot(
            clamp(edgeX, margin, screenW - size - margin),
            clamp(y, margin, screenH - size - margin),
        )
    }

    /** Is the head's centre within `radius` of the target's centre? */
    fun nearTarget(cx: Float, cy: Float, targetCx: Float, targetCy: Float, radius: Float): Boolean =
        hypot(cx - targetCx, cy - targetCy) <= radius

    /** The height as a fraction of the room the head has, so it survives a rotation or a new screen. */
    fun yFraction(y: Int, size: Int, screenH: Int): Float = y.toFloat() / max(1, screenH - size)

    fun yFromFraction(f: Float, size: Int, screenH: Int, margin: Int): Int =
        clamp((f * (screenH - size)).roundToInt(), margin, screenH - size - margin)
}
