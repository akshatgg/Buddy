package com.akshatgg.buddy.bubble

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.View
import kotlin.math.max
import kotlin.math.min

private const val ORANGE = 0xFFEF8A62.toInt() // Claude Code's orange, a little brighter: it glows as the eyes do
private const val SCREEN = 0xFF130E0C.toInt() // the face screen's dark, over the eye Clawd takes the place of

/**
 * Clawd drawn over the head's right eye (Clawd.kt), on top of the head's TextureView: a patch of the face screen's
 * dark over the eye, and the critter on it. HeadView tells it where the eye is on screen each frame (HeadRenderer
 * .eyeOnScreen: the centre, the pixels a face unit takes across and up, and the head's tilt), so Clawd turns and tips
 * with the head. It is never touched: the head under it takes the touches.
 */
class ClawdEyeView(context: Context) : View(context) {
    private var pose: ClawdPose? = null
    private val place = FloatArray(5) // centre x, centre y, pixels a face unit across, up, tilt in degrees
    private val orange = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ORANGE }
    private val dark = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = SCREEN }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = SCREEN; style = Paint.Style.STROKE; strokeCap = Paint.Cap.SQUARE }
    private val patch = RectF()
    private val path = Path()

    init {
        isClickable = false
        isFocusable = false
        visibility = GONE
    }

    /** Show `pose` with the eye at `where` (as eyeOnScreen gives it). */
    fun show(pose: ClawdPose, where: FloatArray) {
        this.pose = pose
        where.copyInto(place)
        if (visibility != VISIBLE) visibility = VISIBLE
        invalidate()
    }

    fun hide() {
        pose = null
        if (visibility != GONE) visibility = GONE
    }

    override fun onDraw(canvas: Canvas) {
        val p = pose ?: return
        val rows = Clawd.FRAMES[p.frame] ?: return
        val sx = place[2]
        val sy = place[3]
        val w = Clawd.WIDTH * sx
        val h = Clawd.HEIGHT * sy
        val cw = w / Clawd.COLUMNS
        val ch = h / Clawd.ROWS
        canvas.save()
        canvas.translate(place[0], place[1])
        canvas.rotate(place[4])
        // The patch: over the whole eye and the whole critter, with room for its hop.
        val ew = Clawd.EYE_WIDTH * sx * 0.65f
        val eh = Clawd.EYE_HEIGHT * sy * 0.62f
        patch.set(min(-w / 2, -ew), min(-h / 2 - 1.5f * ch, -eh), max(w / 2, ew), max(h / 2 + 0.5f * ch, eh))
        canvas.drawRoundRect(patch, ch, ch, dark)
        canvas.translate(-w / 2, -h / 2 - p.lift * ch)
        rows.forEachIndexed { y, row ->
            row.forEachIndexed { x, cell ->
                if (cell == 'X') canvas.drawRect(x * cw, y * ch, (x + 1) * cw + 0.5f, (y + 1) * ch + 0.5f, orange)
            }
        }
        when (p.eyes) {
            ClawdEyes.OPEN -> {
                canvas.drawRect(3 * cw, ch, 4 * cw, 2 * ch, dark)
                canvas.drawRect(8 * cw, ch, 9 * cw, 2 * ch, dark)
            }
            ClawdEyes.HAPPY -> { // > <
                line.strokeWidth = ch * 0.45f
                path.reset()
                path.moveTo(2.6f * cw, 0.6f * ch); path.lineTo(3.7f * cw, 1.2f * ch); path.lineTo(2.6f * cw, 1.8f * ch)
                path.moveTo(9.4f * cw, 0.6f * ch); path.lineTo(8.3f * cw, 1.2f * ch); path.lineTo(9.4f * cw, 1.8f * ch)
                canvas.drawPath(path, line)
            }
            ClawdEyes.SAD -> {
                canvas.drawRect(2.8f * cw, 1.4f * ch, 4.2f * cw, 1.9f * ch, dark)
                canvas.drawRect(7.8f * cw, 1.4f * ch, 9.2f * cw, 1.9f * ch, dark)
            }
        }
        canvas.restore()
    }
}
