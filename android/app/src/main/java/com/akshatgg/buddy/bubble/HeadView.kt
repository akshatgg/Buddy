package com.akshatgg.buddy.bubble

import android.content.Context
import android.view.Choreographer
import android.view.TextureView
import android.widget.FrameLayout
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
 */
class HeadView(context: Context) : FrameLayout(context) {
    /** Which buddy: the name of its .glb in the assets. Changing it loads the new model. */
    var characterId: String = "boy-1"
        set(value) {
            if (field == value) return
            field = value
            if (renderer != null) build()
        }

    /** What the head is doing. A short mood plays once and goes back to IDLE when its pose says done. */
    var mood: Mood
        get() = currentMood
        set(value) {
            currentMood = value
            moodSince = now()
            wake()
        }

    /** True while the head is touched: it draws at the full rate. */
    var pressing: Boolean = false
        set(value) {
            if (field == value) return
            field = value
            if (value) wake()
        }

    private val start = System.nanoTime()
    private val blinker = Blinker()
    private var textureView: TextureView? = null
    private var renderer: HeadRenderer? = null
    private var released = false
    private var currentMood = Mood.IDLE
    private var moodSince = 0.0
    private var lastActive = 0.0 // the last time a mood or a press was on, in now() seconds
    private var lastTick = Double.NEGATIVE_INFINITY // when the last frame was drawn, in now() seconds
    private var scheduled = false // the one pending frame; false while the loop is stopped
    private var visible = false

    private val frame = Choreographer.FrameCallback { tick(it) }

    private fun now(): Double = seconds(System.nanoTime())

    private fun seconds(nanos: Long): Double = (nanos - start) / 1e9

    /** Make the renderer for the current character, on a fresh TextureView, replacing any old one. */
    private fun build() {
        renderer?.destroy()
        textureView?.let { removeView(it) }
        val surface = TextureView(context)
        addView(surface, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        textureView = surface
        renderer = HeadRenderer(context, surface, characterId)
        moodSince = now() // a mood set while the model was loading starts now
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
        val fps = Moods.fpsFor(currentMood, pressing, blinker.soon(t, BLINK_LOOKAHEAD), t - lastActive)
        schedule(1.0 / fps - (now() - t))

        val renderer = renderer ?: return
        val pose = Moods.pose(currentMood, t - moodSince)
        if (pose.done) {
            currentMood = Mood.IDLE
            moodSince = t
        }
        renderer.setPose(pose, blinker.value(t), Moods.floatOffset(t))
        renderer.render(frameTimeNanos)
    }

    private fun schedule(delaySeconds: Double) {
        val delayMillis = ((delaySeconds - EARLY_SECONDS) * 1000).toLong()
        Choreographer.getInstance().postFrameCallbackDelayed(frame, max(0L, delayMillis))
        scheduled = true
    }

    /**
     * Something has just happened (a mood, a press): do not wait out a slow frame that is already
     * asked for. Replace it with one at the soonest the full rate allows, so there is still a
     * single pending frame. Does nothing while the loop is stopped.
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
    fun release() {
        if (released) return
        released = true
        stopLoop()
        renderer?.destroy()
        renderer = null
        textureView?.let { removeView(it) }
        textureView = null
    }
}
