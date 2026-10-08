package com.akshatgg.buddy.bubble

import android.content.Context
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.View.MeasureSpec
import android.view.WindowManager
import android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
import android.widget.TextView
import com.akshatgg.buddy.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.max

private const val MAX_DP = 240
private const val SHOW_MS = 3500L

/**
 * A few words beside the head ("Copied — …"), on the side away from the edge it sits on, as the Mac's bubble: a card
 * in the Mac's colours, shown for a few seconds. Touches go through it to the app underneath.
 */
internal class SpeechBubble(private val context: Context, private val windows: WindowManager, private val scope: CoroutineScope) {
    private var view: TextView? = null // while it is on screen
    private var timer: Job? = null

    /** Show `text` beside the head's window `head`, inside `area`, the part of the screen the head keeps to. */
    fun say(text: String, head: Rect, area: Rect) {
        val bubble = view ?: make()
        bubble.text = text
        val margin = context.px(MARGIN_DP)
        bubble.measure(
            MeasureSpec.makeMeasureSpec(area.width() - 2 * margin, MeasureSpec.AT_MOST),
            MeasureSpec.makeMeasureSpec(area.height(), MeasureSpec.AT_MOST),
        )
        val width = bubble.measuredWidth
        val height = bubble.measuredHeight
        val x = if (head.centerX() > area.centerX()) head.left - width - margin else head.right + margin
        val place = overlay(width, height, FLAG_NOT_TOUCHABLE)
        place.x = Snap.clamp(x, area.left + margin, area.right - width - margin)
        place.y = Snap.clamp(head.centerY() - height / 2, area.top + margin, area.bottom - height - margin)
        if (view == null) {
            if (!windows.tryAdd(bubble, place)) return
            view = bubble
        } else {
            windows.updateViewLayout(bubble, place)
        }
        timer?.cancel()
        timer = scope.launch {
            delay(SHOW_MS)
            hide()
        }
    }

    fun hide() {
        timer?.cancel()
        timer = null
        view?.let { windows.removeView(it) }
        view = null
    }

    private fun make() = TextView(context).apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setTextColor(context.getColor(R.color.buddy_fg))
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        maxWidth = context.px(MAX_DP)
        setPadding(context.px(14), context.px(8), context.px(14), context.px(8))
        background = GradientDrawable().apply {
            cornerRadius = context.px(16).toFloat()
            setColor(context.getColor(R.color.buddy_card))
            setStroke(max(1, context.px(1)), context.getColor(R.color.buddy_line))
        }
    }
}
