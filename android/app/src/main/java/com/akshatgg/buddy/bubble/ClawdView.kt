package com.akshatgg.buddy.bubble

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.view.View
import androidx.core.graphics.withSave

private const val ORANGE = 0xFFEF8A62.toInt() // Claude Code's orange, a little brighter: it glows as the eyes do
private const val DARK = 0xFF130E0C.toInt() // its eyes: the dark of the face screen

/**
 * Clawd drawn with the head (Clawd.kt), on top of the head's TextureView: on top of the head or along its face screen,
 * as the admin picked. HeadView tells it where it is on screen each frame (HeadRenderer.spotOnScreen: the spot, the
 * pixels a unit of the head takes across and up there, and the head's tilt), so Clawd turns and tips with the head. It
 * is never touched: the head under it takes the touches.
 */
class ClawdView(context: Context) : View(context) {
    private var pose: ClawdPose? = null
    private var clawdWidth = 0f // Clawd's width, in units of the head
    private val place = FloatArray(5) // the spot's x, y, pixels a unit of the head across, up, tilt in degrees
    private val orange = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ORANGE }
    private val dark = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = DARK }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = DARK; style = Paint.Style.STROKE; strokeCap = Paint.Cap.SQUARE }
    private val path = Path()

    init {
        isClickable = false
        isFocusable = false
        visibility = GONE
    }

    /** Show `pose`, Clawd `width` units of the head wide, at `where` (as spotOnScreen gives it). */
    fun show(pose: ClawdPose, width: Float, where: FloatArray) {
        this.pose = pose
        clawdWidth = width
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
        canvas.withSave { drawClawd(p, rows) }
    }

    private fun Canvas.drawClawd(p: ClawdPose, rows: List<String>) {
        val w = clawdWidth * place[2]
        val h = clawdWidth * Clawd.ROWS / Clawd.COLUMNS * place[3]
        val cw = w / Clawd.COLUMNS
        val ch = h / Clawd.ROWS
        translate(place[0], place[1])
        rotate(place[4])
        scale(p.facing, 1f) // walking left: turned round
        translate(-w / 2, -h / 2 - p.lift * ch)
        rows.forEachIndexed { y, row ->
            row.forEachIndexed { x, cell ->
                if (cell == 'X') drawRect(x * cw, y * ch, (x + 1) * cw + 0.5f, (y + 1) * ch + 0.5f, orange)
            }
        }
        when (p.eyes) {
            ClawdEyes.OPEN -> {
                drawRect(3 * cw, ch, 4 * cw, 2 * ch, dark)
                drawRect(8 * cw, ch, 9 * cw, 2 * ch, dark)
            }
            ClawdEyes.HAPPY -> { // > <
                line.strokeWidth = ch * 0.45f
                path.reset()
                path.moveTo(2.6f * cw, 0.6f * ch); path.lineTo(3.7f * cw, 1.2f * ch); path.lineTo(2.6f * cw, 1.8f * ch)
                path.moveTo(9.4f * cw, 0.6f * ch); path.lineTo(8.3f * cw, 1.2f * ch); path.lineTo(9.4f * cw, 1.8f * ch)
                drawPath(path, line)
            }
            ClawdEyes.SAD -> {
                drawRect(2.8f * cw, 1.4f * ch, 4.2f * cw, 1.9f * ch, dark)
                drawRect(7.8f * cw, 1.4f * ch, 9.2f * cw, 1.9f * ch, dark)
            }
        }
    }
}
