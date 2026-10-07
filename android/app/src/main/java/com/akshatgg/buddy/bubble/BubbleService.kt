package com.akshatgg.buddy.bubble

import android.animation.ValueAnimator
import android.app.KeyguardManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.PointF
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.View.MeasureSpec
import android.view.ViewConfiguration
import android.view.WindowInsets
import android.view.WindowManager
import android.view.WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
import android.view.WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
import android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
import android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
import android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.R
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.ui.MainActivity
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private const val TAG = "Buddy"
private const val CHANNEL = "buddy"
private const val NOTIFICATION_ID = 1

private const val MARGIN_DP = 8 // between the head's window and the screen's edges, as the Mac's MARGIN
private const val ROOM = 1.6f // the head's window is this much bigger than the head: room for the float and the bounce
private const val GLIDE_MS = 220L

private const val TARGET_DP = 64 // the ✕ circle
private const val TARGET_LIFT_DP = 48 // from the bottom of the screen to the bottom of the circle
private const val TARGET_RADIUS_DP = 72 // a head whose centre is this close to the circle's turns Buddy off when let go
private const val TARGET_GROW = 1.2f // how much the circle grows while the head is over it
private const val TARGET_ROOM = 1.25f // the circle's window leaves room for it to grow

private const val SPEECH_MAX_DP = 240
private const val SAY_MS = 3500L
private const val SLEEPY_MS = 5000L // as the Mac's actions.js: a sleepy buddy wakes up on its own after a few seconds

/**
 * The buddy over every app. A foreground service, so that Android keeps it running while Buddy is on, as the Mac's
 * buddy window stays up until the person turns Buddy off; the notification a foreground service must show says so
 * and offers "Turn off". It owns three overlay windows: the head, the ✕ that the head is dropped on to turn Buddy off,
 * and the speech bubble beside the head. Everything here runs on the main thread, as the head must.
 *
 * Every window is laid out in the screen's own pixels, from its top-left corner, status bar included, so that the
 * head, the ✕ and the speech bubble share one set of coordinates; area() is the part of it the head keeps to.
 */
class BubbleService : LifecycleService() {
    private val settings: AppSettings get() = AppGraph.instance.settings
    private lateinit var windows: WindowManager

    private var head: HeadView? = null // null until the windows are made, and in a service that stopped at once
    private lateinit var headPlace: WindowManager.LayoutParams
    private var drag: Drag? = null
    private var glide: ValueAnimator? = null

    private var target: View? = null // the ✕ circle's window, hidden but while a drag shows it
    private var targetCircle: View? = null
    private lateinit var targetPlace: WindowManager.LayoutParams
    private val targetCentre = PointF()

    private var speech: TextView? = null // the speech bubble, while it is on screen
    private var sayTimer: Job? = null
    private var sleepyTimer: Job? = null
    private var hideTimer: Job? = null // while it runs the head is hidden for a picture of the screen

    // The head draws only while it is visible, and an overlay stays "visible" with the screen off or locked, so it is
    // hidden then: the Mac's buddy:pause on lock-screen.
    private var screenOff = false
    private var screenReceiver: BroadcastReceiver? = null

    override fun onCreate() {
        super.onCreate()
        windows = getSystemService(WindowManager::class.java)
        val channel = NotificationChannel(CHANNEL, getString(R.string.bubble_channel), NotificationManager.IMPORTANCE_LOW)
        channel.setShowBadge(false)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        if (!foreground(capturing = false)) {
            stopSelf()
            return
        }
        // Without "Display over other apps" there is nowhere to float: the app says why, and asks for it.
        if (!Settings.canDrawOverlays(this)) {
            stopSelf()
            return
        }
        makeTarget() // first: a window made later is drawn over it, and the head goes over the ✕, not under
        showHead()
        listenToScreen()
        lifecycleScope.launch {
            BubbleBus.events.collect { event ->
                when (event) {
                    is BubbleEvent.SetMood -> mood(event.mood)
                    is BubbleEvent.Say -> say(event.text)
                    is BubbleEvent.HideFor -> hideFor(event.ms)
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (head == null) return START_NOT_STICKY // it stopped at once in onCreate
        when (intent?.action) {
            ACTION_TURN_OFF -> turnOff()
            ACTION_CAPTURE -> foreground(capturing = !intent.getBooleanExtra(EXTRA_DONE, false))
        }
        return START_STICKY
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val view = head ?: return
        if (drag?.dragging == true) return // where it is let go is snapped to the new screen
        // The phone turned (or the screen changed size): back to the head's side and height, on the new screen.
        glide?.cancel()
        hideSpeech()
        placeHead()
        windows.updateViewLayout(view, headPlace)
    }

    override fun onDestroy() {
        glide?.cancel()
        screenReceiver?.let { unregisterReceiver(it) }
        screenReceiver = null
        hideSpeech()
        target?.let { windows.removeViewImmediate(it) }
        target = null
        targetCircle = null
        head?.let {
            head = null
            windows.removeViewImmediate(it)
            it.release()
        }
        super.onDestroy()
    }

    /**
     * Be a foreground service of the special-use kind, and of the screen-capture kind too while the panel takes a
     * picture (Android 14 lets an app capture the screen only from such a service). False when Android refuses.
     */
    private fun foreground(capturing: Boolean): Boolean {
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        if (capturing) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        return try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), types)
            true
        } catch (e: IllegalStateException) {
            Log.w(TAG, "bubble: not in the foreground (${e.javaClass.simpleName})") // started from the background
            false
        } catch (e: SecurityException) {
            Log.w(TAG, "bubble: not in the foreground (${e.javaClass.simpleName})") // a capture not agreed to
            false
        }
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val off = Intent(this, BubbleService::class.java).setAction(ACTION_TURN_OFF)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.bubble_on))
            .setContentText(getString(R.string.bubble_on_text))
            .setContentIntent(open)
            .addAction(0, getString(R.string.bubble_turn_off), PendingIntent.getService(this, 0, off, PendingIntent.FLAG_IMMUTABLE))
            .setOngoing(true)
            .setShowWhen(false)
            .build()
    }

    /** Buddy off, as "Turn off" in the Mac's menu: it stays off, after a restart too, until the person turns it on. */
    private fun turnOff() {
        settings.buddyOn = false
        stopSelf()
    }

    private fun px(dp: Number): Int = (dp.toFloat() * resources.displayMetrics.density).roundToInt()

    /** A see-through window over every app that never takes the keyboard, in the screen's own pixels. */
    private fun overlay(width: Int, height: Int, flags: Int) = WindowManager.LayoutParams(
        width, height, TYPE_APPLICATION_OVERLAY, flags or FLAG_NOT_FOCUSABLE or FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        // Not moved down below the status bar or up above the navigation bar: area() keeps the head clear of them.
        if (Build.VERSION.SDK_INT >= 30) fitInsetsTypes = 0
    }

    /**
     * Where the head may go, as the Mac's work area: the screen less the status bar, the navigation bar and a camera
     * cutout, whether or not the app in front hides them, so that the head does not jump when it does. Before
     * Android 11 the screen's metrics do not say where the bars are, so there the head may go over them.
     */
    private fun area(): Rect {
        if (Build.VERSION.SDK_INT >= 30) {
            val metrics = windows.currentWindowMetrics
            val bars = metrics.windowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            val screen = metrics.bounds
            return Rect(screen.left + bars.left, screen.top + bars.top, screen.right - bars.right, screen.bottom - bars.bottom)
        }
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        windows.defaultDisplay.getRealMetrics(metrics)
        return Rect(0, 0, metrics.widthPixels, metrics.heightPixels)
    }

    private fun showHead() {
        headPlace = overlay(0, 0, FLAG_LAYOUT_NO_LIMITS)
        placeHead()
        val view = HeadView(this)
        view.characterId = settings.characterId
        drag = Drag(view).also { view.setOnTouchListener(it) }
        view.setOnClickListener { openPanel() }
        windows.addView(view, headPlace)
        head = view
        view.mood = Mood.WAVE
    }

    /** The head at its saved side and height, on the screen as it is now. */
    private fun placeHead() {
        val area = area()
        val size = (settings.size.dp * ROOM * resources.displayMetrics.density).roundToInt()
        val margin = px(MARGIN_DP)
        headPlace.width = size
        headPlace.height = size
        headPlace.x = area.left + if (settings.bubbleRight) area.width() - size - margin else margin
        headPlace.y = area.top + Snap.yFromFraction(settings.bubbleY, size, area.height(), margin)
    }

    private fun moveHead(x: Int, y: Int) {
        val view = head ?: return
        headPlace.x = x
        headPlace.y = y
        windows.updateViewLayout(view, headPlace)
    }

    private fun openPanel() {
        // The panel is not made yet: until it is, a tap opens the app.
        startActivity(Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /**
     * A press, a drag or a tap on the head. A press makes it draw at the full rate. Moving further than a tap can
     * starts a drag: the head wobbles and the ✕ appears. Let go over the ✕ and Buddy turns off; anywhere else and the
     * head glides to the nearer side, and stays there.
     */
    private inner class Drag(private val view: HeadView) : View.OnTouchListener {
        private val slop = ViewConfiguration.get(this@BubbleService).scaledTouchSlop
        private var downX = 0f
        private var downY = 0f
        private var startX = 0
        private var startY = 0
        private var overTarget = false
        var dragging = false
            private set

        override fun onTouch(v: View, event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    glide?.cancel()
                    view.pressing = true
                    downX = event.rawX
                    downY = event.rawY
                    startX = headPlace.x
                    startY = headPlace.y
                    dragging = false
                    overTarget = false
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    if (!dragging && hypot(dx, dy) > slop) {
                        dragging = true
                        mood(Mood.WOBBLE)
                        hideSpeech()
                        showTarget()
                    }
                    if (dragging) {
                        moveHead(startX + dx.roundToInt(), startY + dy.roundToInt())
                        val size = headPlace.width
                        setOverTarget(
                            Snap.nearTarget(
                                headPlace.x + size / 2f, headPlace.y + size / 2f, targetCentre.x, targetCentre.y, px(TARGET_RADIUS_DP).toFloat(),
                            ),
                        )
                    }
                }
                MotionEvent.ACTION_UP -> {
                    view.pressing = false
                    if (!dragging) {
                        v.performClick()
                    } else {
                        dragging = false
                        hideTarget()
                        if (overTarget) turnOff() else drop()
                    }
                }
                MotionEvent.ACTION_CANCEL -> {
                    view.pressing = false
                    if (dragging) {
                        dragging = false
                        hideTarget()
                        drop()
                    }
                }
            }
            return true
        }

        private fun setOverTarget(over: Boolean) {
            if (over == overTarget) return
            overTarget = over
            val scale = if (over) TARGET_GROW else 1f
            targetCircle?.animate()?.scaleX(scale)?.scaleY(scale)?.setDuration(120)?.start()
        }
    }

    /** Let go away from the ✕: glide to the nearer side, as the Mac's buddy does, and remember where. */
    private fun drop() {
        val area = area()
        val size = headPlace.width
        val spot = Snap.toEdge(headPlace.x - area.left, headPlace.y - area.top, size, area.width(), area.height(), px(MARGIN_DP))
        settings.bubbleRight = spot.x + size / 2 >= area.width() / 2
        settings.bubbleY = Snap.yFraction(spot.y, size, area.height())
        mood(Mood.IDLE)
        glideTo(area.left + spot.x, area.top + spot.y)
    }

    private fun glideTo(x: Int, y: Int) {
        glide?.cancel()
        val fromX = headPlace.x
        val fromY = headPlace.y
        glide = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = GLIDE_MS
            interpolator = DecelerateInterpolator()
            addUpdateListener {
                val k = it.animatedValue as Float
                moveHead(fromX + ((x - fromX) * k).roundToInt(), fromY + ((y - fromY) * k).roundToInt())
            }
            start()
        }
    }

    /**
     * The ✕ circle's window, hidden until a drag. Touches go through it: the head is still being dragged over it, and
     * a hidden window must not stop taps on the app underneath.
     */
    private fun makeTarget() {
        val circle = TextView(this).apply {
            text = "✕"
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(0xCC1D1D1F.toInt())
                setStroke(px(2), 0x99FFFFFF.toInt())
            }
        }
        val frame = FrameLayout(this)
        frame.addView(circle, FrameLayout.LayoutParams(px(TARGET_DP), px(TARGET_DP), Gravity.CENTER))
        frame.visibility = View.INVISIBLE
        val box = (px(TARGET_DP) * TARGET_ROOM).roundToInt() // placed by showTarget()
        targetPlace = overlay(box, box, FLAG_NOT_TOUCHABLE)
        windows.addView(frame, targetPlace)
        target = frame
        targetCircle = circle
    }

    /** The ✕ at the bottom centre of the screen as it is now. */
    private fun showTarget() {
        val frame = target ?: return
        val circle = targetCircle ?: return
        val area = area()
        val circleSize = px(TARGET_DP)
        val box = (circleSize * TARGET_ROOM).roundToInt()
        targetCentre.set(area.exactCenterX(), area.bottom - px(TARGET_LIFT_DP) - circleSize / 2f)
        circle.layoutParams = FrameLayout.LayoutParams(circleSize, circleSize, Gravity.CENTER)
        circle.scaleX = 1f
        circle.scaleY = 1f
        targetPlace.width = box
        targetPlace.height = box
        targetPlace.x = (targetCentre.x - box / 2f).roundToInt()
        targetPlace.y = (targetCentre.y - box / 2f).roundToInt()
        windows.updateViewLayout(frame, targetPlace)
        frame.visibility = View.VISIBLE
    }

    private fun hideTarget() {
        targetCircle?.animate()?.cancel()
        target?.visibility = View.INVISIBLE
    }

    private fun mood(mood: Mood) {
        val view = head ?: return
        sleepyTimer?.cancel() // it would wake a buddy that has since become busy or happy
        sleepyTimer = null
        view.mood = mood
        if (mood == Mood.SLEEPY) {
            sleepyTimer = lifecycleScope.launch {
                delay(SLEEPY_MS)
                view.mood = Mood.IDLE
            }
        }
    }

    /**
     * A speech bubble beside the head, on the side away from the edge it sits on, as the Mac's. Touches go through it
     * to the app underneath (Android draws such a window at most 80 % opaque, as it must be for them to go through).
     */
    private fun say(text: String) {
        val view = head ?: return
        if (view.visibility != View.VISIBLE) return // nobody would see it, or it would be in a picture of the screen
        val bubble = speech ?: TextView(this).apply {
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setTextColor(getColor(R.color.buddy_fg))
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            maxWidth = px(SPEECH_MAX_DP)
            setPadding(px(14), px(8), px(14), px(8))
            background = GradientDrawable().apply {
                cornerRadius = px(16).toFloat()
                setColor(getColor(R.color.buddy_card))
                setStroke(max(1, px(1)), getColor(R.color.buddy_line))
            }
        }
        bubble.text = text
        val area = area()
        val margin = px(MARGIN_DP)
        bubble.measure(
            MeasureSpec.makeMeasureSpec(area.width() - 2 * margin, MeasureSpec.AT_MOST),
            MeasureSpec.makeMeasureSpec(area.height(), MeasureSpec.AT_MOST),
        )
        val width = bubble.measuredWidth
        val height = bubble.measuredHeight
        val size = headPlace.width
        val onRight = headPlace.x + size / 2 > area.centerX()
        val x = if (onRight) headPlace.x - width - margin else headPlace.x + size + margin
        val y = headPlace.y + (size - height) / 2
        val place = overlay(width, height, FLAG_NOT_TOUCHABLE)
        place.x = clamp(x, area.left + margin, area.right - width - margin)
        place.y = clamp(y, area.top + margin, area.bottom - height - margin)
        if (speech == null) windows.addView(bubble, place) else windows.updateViewLayout(bubble, place)
        speech = bubble
        sayTimer?.cancel()
        sayTimer = lifecycleScope.launch {
            delay(SAY_MS)
            hideSpeech()
        }
    }

    private fun hideSpeech() {
        sayTimer?.cancel()
        sayTimer = null
        speech?.let { windows.removeView(it) }
        speech = null
    }

    // Like the Mac's clamp: when there is too little room the low bound wins.
    private fun clamp(v: Int, lo: Int, hi: Int) = min(max(v, lo), max(lo, hi))

    private fun hideFor(ms: Long) {
        hideSpeech()
        hideTimer?.cancel()
        hideTimer = lifecycleScope.launch {
            delay(ms)
            hideTimer = null
            showOrHide()
        }
        showOrHide()
    }

    /** The head shows unless the screen is off or locked, or a picture of the screen is being taken. Hidden, it does not draw. */
    private fun showOrHide() {
        val hidden = screenOff || hideTimer?.isActive == true
        head?.visibility = if (hidden) View.INVISIBLE else View.VISIBLE
    }

    private fun listenToScreen() {
        val keyguard = getSystemService(KeyguardManager::class.java)
        screenOff = !getSystemService(PowerManager::class.java).isInteractive || keyguard.isKeyguardLocked
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                screenOff = when (intent.action) {
                    Intent.ACTION_SCREEN_OFF -> true
                    Intent.ACTION_SCREEN_ON -> keyguard.isKeyguardLocked // on but locked: wait for the unlock
                    else -> false // ACTION_USER_PRESENT: unlocked
                }
                showOrHide()
            }
        }
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        ContextCompat.registerReceiver(this, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
        screenReceiver = receiver
        showOrHide()
    }

    companion object {
        const val ACTION_TURN_OFF = "com.akshatgg.buddy.TURN_OFF"

        /**
         * Sent by the panel once the person has agreed to a picture of the screen, before it takes it (Android 14
         * refuses the screen-capture kind of service until they have), and with EXTRA_DONE = true when it has.
         */
        const val ACTION_CAPTURE = "com.akshatgg.buddy.CAPTURE"
        const val EXTRA_DONE = "done"

        /** Show the buddy, and keep it on screen until stop() or the person turns it off. */
        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, BubbleService::class.java))
            } catch (e: IllegalStateException) {
                // Android allows it from the app on screen, at boot and after an update, but not from the background.
                Log.w(TAG, "bubble: not started (${e.javaClass.simpleName})")
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, BubbleService::class.java))
        }
    }
}
