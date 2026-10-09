package com.akshatgg.buddy.bubble

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.sin

/**
 * Clawd with the head, as on the Mac (src/renderer/buddy/clawd.js): while a Claude Code session runs on the person's
 * computer, Claude Code's little orange pixel critter walks back and forth with the head, and the head's face stays its
 * own and watches it. Where it walks is the admin's choice (Admin → Claude Code, the server's clawdLook): on top of the
 * head beside the sprout, the head looking up at it, or along the face screen under the eyes, looking down at it. It
 * walks while Claude works, waves when Claude needs the person, and when the work ends it is happy (done) or droops
 * (failed) for a moment, then goes.
 */
enum class ClawdKind { WORKING, NEEDS_YOU, DONE, FAILED }

/** How Clawd's eyes are drawn: two dark squares, happy > <, or two low sad dashes. */
enum class ClawdEyes { OPEN, HAPPY, SAD }

/**
 * What shows at a moment: a frame of [Clawd.FRAMES], its eyes, its lift in grid cells (up is more), where along its walk
 * it is (`x`, -1 at the left end to 1 at the right) and which way it faces (1 right, -1 left), and whether at all.
 */
data class ClawdPose(
    val visible: Boolean, val frame: String, val eyes: ClawdEyes, val lift: Float, val x: Float = 0f, val facing: Float = 1f,
)

/**
 * Where Clawd walks, in the head's own space (the Face node's is the same), and how the head watches it there: Clawd's
 * width, the middle of its walk (its centre: y, z), how far either side it goes; the head's turn at most following it
 * and its tip (radians, back is less), and the eyes' look (the eyeLUp and eyeRUp morphs, up is more). Both stay inside
 * the head's own frame, so the camera needs no room made for Clawd.
 */
data class ClawdLook(
    val width: Float, val y: Float, val z: Float, val walk: Float, val turn: Float, val tip: Float, val look: Float,
)

/** How the head watches Clawd: its turn and tip toward it (radians), its eyes' look, and how much it is doing so (0 to 1). */
data class ClawdWatch(val yaw: Float = 0f, val pitch: Float = 0f, val look: Float = 0f, val amount: Float = 0f)

object Clawd {
    const val COLUMNS = 12
    const val ROWS = 8
    const val STEP = 0.25 // seconds a step takes, walking
    const val WAVE = 0.35 // seconds an arm stays up or down, waving
    const val MOMENT = 3.0 // seconds done or failed shows before the eye comes back
    private const val HOP = 0.45 // the happy hop, seconds

    /** At least this many frames a second while Clawd shows: its steps are a quarter of a second. */
    const val FPS = 12
    const val PACE = 0.9 // radians a second of the walk back and forth: there and back in about 7 s
    private const val WATCH_EASE = 0.2 // seconds the head takes, more or less, to turn to Clawd or back

    /** The looks the admin picks from, by the server's names; the same numbers as the Mac's (clawd.js LOOKS). */
    val LOOKS: Map<String, ClawdLook> = mapOf(
        "head" to ClawdLook(width = 0.3f, y = 1.02f + 0.1f, z = 0.42f, walk = 0.34f, turn = 0.18f, tip = -0.08f, look = 0.6f),
        "face" to ClawdLook(width = 0.21f, y = 0.3f, z = 0.535f, walk = 0.2f, turn = 0.22f, tip = 0f, look = -0.45f),
    )

    /** The look named `name`, or on the head for anything else. */
    fun lookOf(name: String?): ClawdLook = LOOKS[name] ?: LOOKS.getValue("head")

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

    /**
     * What Clawd shows `since` seconds into a status; nothing for none, or a moment that is over. `walk` is the seconds
     * the walk has gone on, for where along it Clawd is (the head's own clock, so a new status does not jump it back).
     */
    fun pose(kind: ClawdKind?, since: Double, walk: Double = since): ClawdPose {
        val t = max(0.0, since)
        return when (kind) {
            ClawdKind.WORKING -> {
                val step = floor(t / STEP).toInt() % 2
                ClawdPose(
                    true, if (step == 1) "walkB" else "walkA", ClawdEyes.OPEN, if (step == 1) 0.5f else 0f,
                    x = sin(PACE * walk).toFloat(), facing = if (cos(PACE * walk) >= 0) 1f else -1f,
                )
            }
            ClawdKind.NEEDS_YOU -> ClawdPose(true, if (floor(t / WAVE).toInt() % 2 == 1) "wave" else "stand", ClawdEyes.OPEN, 0f)
            ClawdKind.DONE -> if (t >= MOMENT) HIDDEN else
                ClawdPose(true, "stand", ClawdEyes.HAPPY, if (t < 2 * HOP) (abs(sin(PI * t / HOP)) * 1.5).toFloat() else 0f)
            ClawdKind.FAILED -> if (t >= MOMENT) HIDDEN else ClawdPose(true, "stand", ClawdEyes.SAD, -0.5f)
            null -> HIDDEN
        }
    }

    /** How the head watches Clawd at `pose` in `look`, eased from `was` over `dt` seconds so it turns there smoothly. */
    fun watch(pose: ClawdPose, look: ClawdLook, was: ClawdWatch, dt: Double): ClawdWatch {
        val want = if (pose.visible) ClawdWatch(look.turn * pose.x, look.tip, look.look, 1f) else ClawdWatch()
        val k = (1 - exp(-max(0.0, dt) / WATCH_EASE)).toFloat()
        fun ease(from: Float, to: Float) = from + (to - from) * k
        return ClawdWatch(ease(was.yaw, want.yaw), ease(was.pitch, want.pitch), ease(was.look, want.look), ease(was.amount, want.amount))
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
