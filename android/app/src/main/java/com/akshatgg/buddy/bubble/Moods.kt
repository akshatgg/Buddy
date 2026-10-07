package com.akshatgg.buddy.bubble

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

// How the head moves: pure functions of time, so they can be tested on the JVM and the view
// only has to apply them. Times are in seconds; lift is a fraction of the head's height;
// angles are radians. The phone shows only the head, so there are no arms.

enum class Mood { IDLE, THINKING, HAPPY, SLEEPY, WAVE, WOBBLE }

data class Pose(
    val lift: Float = 0f, val scaleX: Float = 1f, val scaleY: Float = 1f, val headTilt: Float = 0f,
    val yaw: Float = 0f, val smile: Float = 0f, val mouthO: Float = 0f, val eyesClosed: Boolean = false,
    val eyeL: Float = 0f, val eyeR: Float = 0f, val done: Boolean = false,
)

object Moods {
    // How often the head draws. The cost is mostly a fixed price per frame, whatever is on it,
    // so the head draws as seldom as it can without looking jerky:
    //   FPS       30  a mood, a press or a drag, and around each blink: what has to look smooth;
    //   IDLE_FPS  15  the 10 s after a mood or a press: slower is fine while it settles;
    //   REST_FPS   6  nothing has happened for 10 s: only the slow float and the occasional
    //                 blink are left.
    const val FPS = 30
    const val IDLE_FPS = 15
    const val REST_FPS = 6

    private const val SETTLE_SECONDS = 10.0 // how long the settling rate lasts, before the rest rate

    // Thinking: each eye is a glowing line (the blink shape) sweeping up and down SWEEP_HZ times
    // a second, the right line SWEEP_LAG radians behind the left, so together they read as one
    // line sweeping across, like a scanner. eyeL and eyeR run from -1 (down) to 1 (up).
    const val SWEEP_HZ = 1.2
    const val SWEEP_LAG = 0.6

    /**
     * How many frames a second to draw. `blinkSoon` is Blinker.soon(); `sinceActive` is seconds
     * since a mood or a press was last on. A blink is not counted as activity: it is brief, and
     * foreseen by Blinker.soon().
     */
    fun fpsFor(mood: Mood, pressing: Boolean, blinkSoon: Boolean, sinceActive: Double): Int {
        if (blinkSoon || mood != Mood.IDLE || pressing) return FPS
        return if (sinceActive < SETTLE_SECONDS) IDLE_FPS else REST_FPS
    }

    /** The slow up-and-down float. */
    fun floatOffset(t: Double, amplitude: Double = 0.035, period: Double = 3.0): Float =
        (amplitude * sin(2 * PI * t / period)).toFloat()

    /**
     * The slow turn of a head in the buddy picker, from side to side (radians of yaw): it shows that the buddy is 3D,
     * as the Mac's turntable previews did, while its face stays in view.
     */
    fun turn(t: Double, amplitude: Double = 0.5, period: Double = 8.0): Float =
        (amplitude * sin(2 * PI * t / period)).toFloat()

    /**
     * How shut the eyes are, 0 (open) to 1 (shut): fully shut when the pose closes them, else
     * the blinker's value, except while smiling. The blink and the smile both reshape the same
     * eye, and on top of each other they tear it, so the happy "∩" eyes never blink.
     */
    fun blinkWeight(pose: Pose, blink: Float): Float {
        if (pose.eyesClosed) return 1f
        return if (pose.smile > 0f) 0f else blink
    }

    private fun clamp(v: Double, lo: Double, hi: Double) = min(hi, max(lo, v))

    /** The pose for a mood, `since` seconds after it started. `done` means: go back to idle. */
    fun pose(mood: Mood, since: Double): Pose = when (mood) {
        Mood.THINKING -> {
            val sweep = 2 * PI * SWEEP_HZ * since
            Pose(
                headTilt = (0.18 + 0.04 * sin(since * 2)).toFloat(), eyesClosed = true,
                eyeL = sin(sweep).toFloat(), eyeR = sin(sweep - SWEEP_LAG).toFloat(),
            )
        }
        Mood.HAPPY -> {
            val length = 1.2
            val fade = 1 - min(since / length, 1.0)
            val bounce = abs(sin(since * PI * 2.5)) * fade
            Pose(
                lift = (0.08 * bounce).toFloat(), scaleY = (1 + 0.05 * bounce).toFloat(),
                scaleX = (1 - 0.03 * bounce).toFloat(), smile = 1f, done = since >= length,
            )
        }
        Mood.WAVE -> {
            val length = 1.8
            val raised = clamp(min(since / 0.25, (length - since) / 0.25), 0.0, 1.0)
            Pose(smile = 0.8f, yaw = (raised * 0.25 * sin(since * 14)).toFloat(), done = since >= length)
        }
        Mood.SLEEPY -> Pose(eyesClosed = true, scaleY = (1 + 0.02 * sin(since * 1.6)).toFloat(), headTilt = 0.12f)
        Mood.WOBBLE -> Pose(headTilt = (0.15 * sin(since * 18)).toFloat(), mouthO = 0.5f)
        Mood.IDLE -> Pose()
    }
}

private const val BLINK_LENGTH = 0.16 // shut over 70 ms, open over 90 ms

/**
 * Blinks every 3-6 s: shut over 70 ms, open over 90 ms. value(t) is 0 (open) to 1 (shut), and
 * is the only thing that schedules the next blink. soon(t, within) says whether a blink is
 * under way at t or starts within `within` seconds, so the view can draw it at full rate;
 * asking never changes when the next blink is.
 */
class Blinker(private val random: () -> Double = Math::random) {
    private var next = 2 + random() * 3

    fun value(t: Double): Float {
        if (t < next) return 0f
        val k = t - next
        if (k >= BLINK_LENGTH) {
            next = t + 3 + random() * 3
            return 0f
        }
        return (if (k < 0.07) k / 0.07 else 1 - (k - 0.07) / 0.09).toFloat()
    }

    fun soon(t: Double, within: Double): Boolean = t >= next - within && t < next + BLINK_LENGTH
}
