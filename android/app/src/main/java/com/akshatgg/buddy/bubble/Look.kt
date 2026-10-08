package com.akshatgg.buddy.bubble

import android.view.accessibility.AccessibilityEvent
import kotlin.math.max
import kotlin.math.min

// Look where I type: the head turns toward the text box the person types in, in any app, as the Mac's head turns
// toward the pointer. LookService finds the box; this file is the arithmetic, pure so that it can be tested on the JVM.
// Places are screen pixels; turns are radians.

/** A rectangle on the screen, in pixels. */
data class ScreenRect(val left: Float, val top: Float, val right: Float, val bottom: Float) {
    val centreX get() = (left + right) / 2
    val centreY get() = (top + bottom) / 2

    fun holds(x: Float, y: Float) = x in left..right && y in top..bottom
}

/** A point on the screen, in pixels. */
data class LookPoint(val x: Float, val y: Float)

/** How far the head is turned: yaw to the right, pitch down (radians), as the Mac's lookAt. */
data class Turn(val yaw: Float, val pitch: Float) {
    companion object {
        val FRONT = Turn(0f, 0f)
    }
}

object Look {
    /**
     * Where to look: the cursor's centre when Android said where it is, else the middle of the box. A cursor that is
     * not in the box (a stale place, a box scrolled meanwhile) is not believed.
     */
    fun point(box: ScreenRect, cursor: ScreenRect?): LookPoint {
        if (cursor != null && box.holds(cursor.centreX, cursor.centreY)) return LookPoint(cursor.centreX, cursor.centreY)
        return LookPoint(box.centreX, box.centreY)
    }

    /**
     * The turn toward `point` from the head's centre (headX, headY), with the Mac's numbers (moods.js lookAt) in dp:
     * the Mac's are CSS pixels, which a dp is meant to match.
     */
    fun turn(point: LookPoint, headX: Float, headY: Float, density: Float): Turn {
        val dx = (point.x - headX) / density
        val dy = (point.y - headY) / density
        return Turn(clamp(dx / 600f, -0.45f, 0.45f), clamp(dy / 500f, -0.2f, 0.25f))
    }

    private fun clamp(v: Float, lo: Float, hi: Float) = min(hi, max(lo, v))
}

/** What an Accessibility event asks of the head. */
enum class LookAction { LOOK, AWAY, NONE }

object LookFilter {
    /**
     * What to do for an event of `type` (AccessibilityEvent.TYPE_*) on a view that is `editable` (a text box) and maybe
     * a `password` box. A box getting the focus, typed in or its cursor moved: look at it. The focus going anywhere
     * else, or another window coming up: look back to the front. A password box is never looked at. Buddy's own
     * windows (its panel and sheets, where the head is hidden anyway) and the keyboard's change nothing: the keyboard
     * coming up is a window too, and must not turn the head away from the box it is for.
     */
    fun action(type: Int, fromBuddy: Boolean, fromKeyboard: Boolean, editable: Boolean, password: Boolean): LookAction {
        if (fromBuddy || fromKeyboard) return LookAction.NONE
        val box = editable && !password
        return when (type) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> LookAction.AWAY
            AccessibilityEvent.TYPE_VIEW_FOCUSED -> if (box) LookAction.LOOK else LookAction.AWAY
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED, AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED -> when {
                box -> LookAction.LOOK
                editable -> LookAction.AWAY // a password box
                else -> LookAction.NONE // text that is not a box: a label, a counter
            }
            else -> LookAction.NONE
        }
    }
}

private const val EASE_SECONDS = 0.25

/**
 * The head's turn as it eases toward the asked one, in and out over EASE_SECONDS: a new target starts from wherever
 * the head is at that moment, so it never jumps. Times are the view's seconds.
 */
class LookEase {
    private var from = Turn.FRONT
    private var target = Turn.FRONT
    private var since = Double.NEGATIVE_INFINITY

    /** Turn toward `turn` from `t`. The target it is already turning to changes nothing. */
    fun to(turn: Turn, t: Double) {
        if (turn == target) return
        from = value(t)
        target = turn
        since = t
    }

    fun value(t: Double): Turn {
        val k = (t - since) / EASE_SECONDS
        if (k >= 1) return target
        if (k <= 0) return from
        val s = (k * k * (3 - 2 * k)).toFloat()
        return Turn(from.yaw + (target.yaw - from.yaw) * s, from.pitch + (target.pitch - from.pitch) * s)
    }

    /** True while the head is still on its way: the view then draws at no less than the settling rate. */
    fun moving(t: Double): Boolean = t - since < EASE_SECONDS
}
