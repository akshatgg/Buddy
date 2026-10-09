package com.akshatgg.buddy.bubble

import android.content.Context
import android.util.Log
import android.view.Choreographer
import android.view.TextureView
import android.widget.FrameLayout
import androidx.annotation.MainThread
import kotlin.math.max

// A blink is drawn at the full rate from its first frame. At rest frames are 1 / REST_FPS
// apart, so look that far ahead: the frame before a blink starts always sees it coming
// (see Blinker.soon).
private const val BLINK_LOOKAHEAD = 1.0 / Moods.REST_FPS

// Choreographer runs a delayed frame at the first vsync after the delay, so a frame due exactly
// on a vsync is asked for this much early; else 30 fps on a 60 Hz screen would slip to 20.
private const val EARLY_SECONDS = 0.004

/**
 * The buddy's head on screen: a see-through TextureView, the HeadRenderer that draws on it and
 * the frame loop that animates it. It needs nothing from an Activity, so it works the same in an
 * Activity and in the bubble's overlay window: the loop runs while the view is attached and
 * visible, and release() frees the GPU side when its host is done with it.
 *
 * Like every view, it is used on the main thread only: the setters and release() say so with
 * @MainThread, and the head is drawn there too.
 */
class HeadView(context: Context) : FrameLayout(context) {
    /**
     * Which buddy: the name of its .glb in the assets. Changing it loads the new model on the same
     * TextureView, so the old head stays on screen until the new one draws over it, as on the
     * Mac. A model that fails to load leaves the old buddy in place, as the Mac keeps its old model.
     */
    var characterId: String = "boy-1"
        @MainThread set(value) {
            if (field == value) return
            val previous = field
            field = value
            // Before the first attach there is nothing to replace: onAttachedToWindow loads it.
            if (released || (renderer == null && !isAttachedToWindow)) return
            if (!build()) {
                field = previous
                build()
            }
        }

    /** What the head is doing. A short mood plays once and goes back to IDLE when its pose says done. */
    var mood: Mood
        get() = currentMood
        @MainThread set(value) {
            currentMood = value
            moodSince = now()
            wake()
        }

    /**
     * True in the buddy picker: the head turns slowly from side to side, at no less than the settling rate, so that
     * the turn looks smooth. Set back to false, it finishes the swing it is in and stops facing front.
     */
    var turning: Boolean = false
        @MainThread set(value) {
            if (field == value) return
            field = value
            turnUntil = if (value) Double.POSITIVE_INFINITY else Moods.turnEnd(now())
            wake()
        }

    /**
     * Turn the head toward where the person types (`turn` from Look.turn), or back to the front with Turn.FRONT. It
     * eases there over a quarter of a second (LookEase), drawing at the full rate on the way (Moods.drawFps); once there,
     * the rates are what they would be anyway.
     */
    @MainThread
    fun look(turn: Turn) {
        lookEase.to(turn, now())
        wake()
    }

    /**
     * Claude Code on the person's computer (ClaudeWatch): Clawd walks with the head while a session works or needs them,
     * and shows a moment for done or failed (Clawd.pose); the head watches it. The same lasting kind again goes on as it
     * was.
     */
    var claude: ClawdKind? = null
        @MainThread set(value) {
            if (field == value && (value == ClawdKind.WORKING || value == ClawdKind.NEEDS_YOU)) return
            field = value
            claudeSince = now()
            wake()
        }

    /** Where Clawd walks: the admin's choice (Clawd.lookOf), from Buddy's server. */
    var clawdLook: ClawdLook = Clawd.lookOf(null)
        @MainThread set(value) {
            if (field == value) return
            field = value
            wake()
        }

    /** True while the head is touched: it draws at the full rate. */
    var pressing: Boolean = false
        @MainThread set(value) {
            if (field == value) return
            field = value
            if (value) wake()
        }

    private val start = System.nanoTime()
    private val blinker = Blinker()
    private var textureView: TextureView? = TextureView(context).also {
        addView(it, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }
    private var renderer: HeadRenderer? = null
    private val clawdView = ClawdView(context).also {
        addView(it, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)) // over the head
    }
    private val clawdPlace = FloatArray(5)
    private var claudeSince = 0.0
    private var watch = ClawdWatch() // how the head watches Clawd, eased (Clawd.watch)
    private var watchAt = 0.0
    private var released = false
    private var currentMood = Mood.IDLE
    private var moodSince = 0.0
    private var lastActive = 0.0 // the last time a mood or a press was on, in now() seconds
    private var lastTick = Double.NEGATIVE_INFINITY // when the last frame was drawn, in now() seconds
    private var scheduled = false // the one pending frame; false while the loop is stopped
    private var visible = false
    private var turnUntil = 0.0 // the head turns until then, in now() seconds
    private val lookEase = LookEase() // the turn toward where the person types

    private val frame = Choreographer.FrameCallback { tick(it) }

    init {
        // A view with a click listener becomes focusable on its own, and the head would then take focus when the
        // screen leaves touch mode (a keyboard is typed on) or the head shows again, and draw Android's focus
        // highlight: a grey square over its whole window. The head is only ever touched, so it never takes focus. A
        // view set not focusable stays so when a click listener is added later.
        isFocusable = false
        defaultFocusHighlightEnabled = false
    }

    private fun now(): Double = seconds(System.nanoTime())

    private fun seconds(nanos: Long): Double = (nanos - start) / 1e9

    /**
     * Make the renderer for the current character, replacing any old one, on the same
     * TextureView: it keeps showing the old head's last frame until the new head draws. False
     * if the model failed to load; then there is no renderer, and nothing is left half made.
     */
    private fun build(): Boolean {
        val surface = textureView ?: return false
        val old = renderer
        renderer = null
        old?.destroy()
        renderer = try {
            HeadRenderer(context, surface, characterId)
        } catch (e: Exception) {
            Log.w("Buddy", "head: $characterId failed to load (${e.javaClass.simpleName})")
            return false
        } catch (e: LinkageError) {
            // Filament could not start on this phone (its graphics, or its native code): the first try fails with an
            // ExceptionInInitializerError or an UnsatisfiedLinkError, and every later one with a NoClassDefFoundError.
            // The buddy then has no head, rather than crashing each time Android starts it again.
            Log.w("Buddy", "head: no 3D engine (${e.javaClass.simpleName})")
            return false
        }
        moodSince = now() // a mood set while the model was loading starts now
        wake() // draw the new head at once, over the old one's last frame
        return true
    }

    /**
     * One frame. The next one is asked for before drawing this one, so drawing time does not
     * stretch the interval, and at the rate fpsFor allows: the head wakes only when a frame is
     * due, not at the screen's refresh rate.
     */
    private fun tick(frameTimeNanos: Long) {
        scheduled = false
        val t = seconds(frameTimeNanos)
        lastTick = t
        if (currentMood != Mood.IDLE || pressing) lastActive = t
        val clawd = Clawd.pose(claude, t - claudeSince, walk = t)
        val moodFps = Moods.fpsFor(currentMood, pressing, blinker.soon(t, BLINK_LOOKAHEAD), t - lastActive)
        val fps = if (clawd.visible) max(moodFps, Clawd.FPS) else moodFps // its steps need the frames
        schedule(1.0 / Moods.drawFps(fps, picker = t < turnUntil, looking = lookEase.moving(t)) - (now() - t))

        val renderer = renderer ?: return
        // While Clawd shows the head watches it rather than think: Claude Code at work sends thinking, whose eyes are a line.
        val shownMood = if (clawd.visible && currentMood == Mood.THINKING) Mood.IDLE else currentMood
        val pose = Moods.pose(shownMood, t - moodSince)
        if (pose.done) {
            currentMood = Mood.IDLE
            moodSince = t
        }
        val picker = if (t < turnUntil) pose.copy(yaw = pose.yaw + Moods.turn(t)) else pose
        val look = lookEase.value(t)
        val looking = if (look == Turn.FRONT) picker else picker.copy(yaw = picker.yaw + look.yaw, pitch = picker.pitch + look.pitch)
        watch = Clawd.watch(clawd, clawdLook, watch, t - watchAt)
        watchAt = t
        val shown = if (watch.amount == 0f) looking else looking.copy(
            yaw = looking.yaw + watch.yaw, pitch = looking.pitch + watch.pitch,
            eyeL = looking.eyeL + watch.look, eyeR = looking.eyeR + watch.look,
        )
        renderer.setPose(shown, blinker.value(t), Moods.floatOffset(t))
        val spot = clawdLook
        val placed = clawd.visible &&
            renderer.spotOnScreen(spot.walk * clawd.x, spot.y, spot.z, clawdPlace)
        if (placed) clawdView.show(clawd, spot.width, clawdPlace) else clawdView.hide()
        renderer.render(frameTimeNanos)
    }

    private fun schedule(delaySeconds: Double) {
        val delayMillis = ((delaySeconds - EARLY_SECONDS) * 1000).toLong()
        Choreographer.getInstance().postFrameCallbackDelayed(frame, max(0L, delayMillis))
        scheduled = true
    }

    /**
     * Something has just happened (a mood, a press, a new buddy): do not wait out a slow frame
     * that is already asked for. Replace it with one at the soonest the full rate allows, so
     * there is still a single pending frame. Does nothing while the loop is stopped.
     */
    private fun wake() {
        if (!scheduled) return
        Choreographer.getInstance().removeFrameCallback(frame)
        schedule(max(0.0, 1.0 / Moods.FPS - (now() - lastTick)))
    }

    private fun startLoop() {
        if (scheduled || released || !isAttachedToWindow || !visible) return
        schedule(0.0)
    }

    private fun stopLoop() {
        Choreographer.getInstance().removeFrameCallback(frame)
        scheduled = false
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (!released && renderer == null) build()
        startLoop()
    }

    override fun onDetachedFromWindow() {
        stopLoop()
        super.onDetachedFromWindow()
    }

    // Not drawing while hidden (a window in the background, a view set GONE) saves the battery.
    override fun onVisibilityAggregated(isVisible: Boolean) {
        super.onVisibilityAggregated(isVisible)
        visible = isVisible
        if (isVisible) startLoop() else stopLoop()
    }

    /**
     * Stop the loop and free this head's GPU side for good (the process's one engine stays, for
     * the next head). Call it when the host is done: onDestroy, or the service stopping.
     */
    @MainThread
    fun release() {
        if (released) return
        released = true
        stopLoop()
        val old = renderer
        renderer = null
        old?.destroy()
        textureView?.let { removeView(it) }
        textureView = null
    }
}
