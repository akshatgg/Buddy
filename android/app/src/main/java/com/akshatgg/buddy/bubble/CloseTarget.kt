package com.akshatgg.buddy.bubble

import android.content.Context
import android.graphics.Color
import android.graphics.PointF
import android.graphics.Rect
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
import android.widget.FrameLayout
import android.widget.TextView
import kotlin.math.roundToInt

private const val SIZE_DP = 64 // the circle
private const val LIFT_DP = 48 // from the bottom of the area the head keeps to (above the navigation bar) to the circle
private const val RADIUS_DP = 72 // a head whose centre is this close to the circle's turns Buddy off when let go
private const val GROW = 1.2f // how much the circle grows while the head is over it
private const val ROOM = 1.25f // the window leaves room for the circle to grow
private const val GROW_MS = 120L

/**
 * The ✕ at the bottom centre that the head is dropped on to turn Buddy off, shown while the head is dragged. Its
 * window is made once, hidden, before the head's: a window made later is drawn over it, and the head must go over the
 * ✕, not under. Touches go through it: the head is still being dragged over it, and a hidden window must not stop
 * taps on the app underneath.
 */
internal class CloseTarget(private val context: Context, private val windows: WindowManager) {
    private val circle = TextView(context).apply {
        text = "✕"
        gravity = Gravity.CENTER
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
        background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(0xCC1D1D1F.toInt())
            setStroke(context.px(2), 0x99FFFFFF.toInt())
        }
    }
    private val frame = FrameLayout(context).apply {
        addView(circle, FrameLayout.LayoutParams(context.px(SIZE_DP), context.px(SIZE_DP), Gravity.CENTER))
        visibility = View.INVISIBLE
    }
    private val place = overlay(box(), box(), FLAG_NOT_TOUCHABLE) // placed by show()
    private val centre = PointF()
    private var added = false

    /** True while the head is over the ✕: let go now and Buddy turns off. */
    var over = false
        private set

    private fun box() = (context.px(SIZE_DP) * ROOM).roundToInt()

    /** Make the hidden window. False when Android refuses it. */
    fun add(): Boolean {
        added = windows.tryAdd(frame, place)
        return added
    }

    /** Show the ✕ at the bottom centre of `area`, the part of the screen the head keeps to. */
    fun show(area: Rect) {
        if (!added) return
        val size = context.px(SIZE_DP)
        val box = box()
        centre.set(area.exactCenterX(), area.bottom - context.px(LIFT_DP) - size / 2f)
        circle.layoutParams = FrameLayout.LayoutParams(size, size, Gravity.CENTER)
        circle.scaleX = 1f
        circle.scaleY = 1f
        over = false
        place.width = box
        place.height = box
        place.x = (centre.x - box / 2f).roundToInt()
        place.y = (centre.y - box / 2f).roundToInt()
        windows.updateViewLayout(frame, place)
        frame.visibility = View.VISIBLE
    }

    /** The head's centre has moved here: the circle grows while it is close enough. */
    fun follow(cx: Float, cy: Float) {
        val near = added && Snap.nearTarget(cx, cy, centre.x, centre.y, context.px(RADIUS_DP).toFloat())
        if (near == over) return
        over = near
        val scale = if (near) GROW else 1f
        circle.animate().scaleX(scale).scaleY(scale).setDuration(GROW_MS).start()
    }

    fun hide() {
        circle.animate().cancel()
        over = false
        frame.visibility = View.INVISIBLE
    }

    fun remove() {
        if (added) windows.removeViewImmediate(frame)
        added = false
    }
}
