package com.akshatgg.buddy.bubble

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.sin

/**
 * Clawd in the head's eye, as on the Mac (src/renderer/buddy/clawd.js): while a Claude Code session runs on the
 * person's computer, Claude Code's little orange pixel critter takes the place of the head's right eye (as the person
 * sees it), and the left eye stays the buddy's own. It walks while Claude works, waves when Claude needs the person,
 * and when the work ends it is happy (done) or droops (failed) for a moment, then the eye comes back.
 */
enum class ClawdKind { WORKING, NEEDS_YOU, DONE, FAILED }

/** How Clawd's eyes are drawn: two dark squares, happy > <, or two low sad dashes. */
enum class ClawdEyes { OPEN, HAPPY, SAD }

/** What shows at a moment: a frame of [Clawd.FRAMES], its eyes, its lift in grid cells (up is more), and whether at all. */
data class ClawdPose(val visible: Boolean, val frame: String, val eyes: ClawdEyes, val lift: Float)

object Clawd {
    const val COLUMNS = 12
    const val ROWS = 8
    const val STEP = 0.25 // seconds a step takes, walking
    const val WAVE = 0.35 // seconds an arm stays up or down, waving
    const val MOMENT = 3.0 // seconds done or failed shows before the eye comes back
    private const val HOP = 0.45 // the happy hop, seconds

    /** At least this many frames a second while Clawd shows: its steps are a quarter of a second. */
    const val FPS = 12

    // The right eye on the face (the model's Face node), the same in every buddy (art/build_buddies.py): its centre and
    // size, from the eye's own shape at rest. Clawd is drawn over it, as wide as the eye is tall, nearly twice.
    val EYE_CENTRE = floatArrayOf(0.18645f, 0.5304f, 0.4968f)
    const val EYE_WIDTH = 0.1213f
    const val EYE_HEIGHT = 0.1758f
    const val WIDTH = EYE_HEIGHT * 1.9f
    const val HEIGHT = WIDTH * ROWS / COLUMNS

    private val BODY = listOf("..XXXXXXXX..", "..XXXXXXXX..", "XXXXXXXXXXXX", "XXXXXXXXXXXX", "..XXXXXXXX..", "..XXXXXXXX..")
    private val WAVE_BODY = listOf("..XXXXXXXXXX", "..XXXXXXXXXX", "XXXXXXXXXX..", "XXXXXXXXXX..", "..XXXXXXXX..", "..XXXXXXXX..")
    private val STAND = listOf("..X.X..X.X..", "..X.X..X.X..")

    /** The critter on a 12 × 8 grid ('X' is orange), the frames it moves through. The eyes are drawn on top. */
    val FRAMES: Map<String, List<String>> = mapOf(
        "stand" to BODY + STAND,
        "walkA" to BODY + listOf("..X.X..X.X..", "..X....X...."),
        "walkB" to BODY + listOf("..X.X..X.X..", "....X....X.."),
        "wave" to WAVE_BODY + STAND,
    )

    private val HIDDEN = ClawdPose(false, "stand", ClawdEyes.OPEN, 0f)

    /** What Clawd shows `since` seconds into a status; nothing (the buddy's own eye) for none, or a moment that is over. */
    fun pose(kind: ClawdKind?, since: Double): ClawdPose {
        val t = max(0.0, since)
        return when (kind) {
            ClawdKind.WORKING -> {
                val step = floor(t / STEP).toInt() % 2
                ClawdPose(true, if (step == 1) "walkB" else "walkA", ClawdEyes.OPEN, if (step == 1) 0.5f else 0f)
            }
            ClawdKind.NEEDS_YOU -> ClawdPose(true, if (floor(t / WAVE).toInt() % 2 == 1) "wave" else "stand", ClawdEyes.OPEN, 0f)
            ClawdKind.DONE -> if (t >= MOMENT) HIDDEN else
                ClawdPose(true, "stand", ClawdEyes.HAPPY, if (t < 2 * HOP) (abs(sin(PI * t / HOP)) * 1.5).toFloat() else 0f)
            ClawdKind.FAILED -> if (t >= MOMENT) HIDDEN else ClawdPose(true, "stand", ClawdEyes.SAD, -0.5f)
            null -> HIDDEN
        }
    }

    /**
     * What Clawd should show for the statuses of the sessions the person's computers share now (working, waiting, done,
     * failed, idle, …), given what it showed before: a session that needs the person beats one at work; when nothing
     * runs any more after something did, a moment of done (or failed, if a session failed); else nothing.
     */
    fun kindOf(statuses: List<String>, before: ClawdKind?): ClawdKind? = when {
        "waiting" in statuses -> ClawdKind.NEEDS_YOU
        "working" in statuses -> ClawdKind.WORKING
        before == ClawdKind.WORKING || before == ClawdKind.NEEDS_YOU -> if ("failed" in statuses) ClawdKind.FAILED else ClawdKind.DONE
        else -> null
    }
}
