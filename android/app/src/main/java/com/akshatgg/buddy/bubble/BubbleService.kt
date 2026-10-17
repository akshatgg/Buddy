package com.akshatgg.buddy.bubble

import android.animation.ValueAnimator
import android.Manifest
import android.content.pm.PackageManager
import android.app.AppOpsManager
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
import android.graphics.Point
import android.graphics.Rect
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.util.DisplayMetrics
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowInsets
import android.view.WindowManager
import android.view.WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
import android.view.animation.DecelerateInterpolator
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import androidx.lifecycle.lifecycleScope
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.R
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.ui.MainActivity
import com.akshatgg.buddy.ui.panel.HandsFreeChatActivity
import com.akshatgg.buddy.ui.panel.PanelActivity
import com.akshatgg.buddy.voice.MyVoiceRules
import com.akshatgg.buddy.voice.VoiceWords
import com.akshatgg.buddy.voice.WakeRules
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.hypot
import kotlin.math.roundToInt

private const val TAG = "Buddy"
private const val CHANNEL = "buddy"
private const val NOTIFICATION_ID = 1

private const val ROOM = 1.6f // the head's window is this much bigger than the head: room for the float and the bounce
private const val GLIDE_MS = 220L
private const val SLEEPY_MS = 5000L // as the Mac's actions.js: a sleepy buddy wakes up on its own after a few seconds
private const val HELD_MS = 5000L // words held while a sheet was open are said when it goes only if they are this new

/**
 * The buddy over every app. A foreground service, so that Android keeps it running while Buddy is on, as the Mac's
 * buddy window stays up until the person turns Buddy off; the notification a foreground service must show says so
 * and offers "Turn off". It owns three overlay windows: the head, the ✕ that the head is dropped on to turn Buddy off
 * (CloseTarget), and the speech bubble beside the head (SpeechBubble). Everything here runs on the main thread, as
 * the head must.
 */
class BubbleService : LifecycleService() {
    private val settings: AppSettings get() = AppGraph.instance.settings
    private lateinit var windows: WindowManager

    private var head: HeadView? = null // null until the windows are made, and in a service that stopped at once
    private lateinit var headPlace: WindowManager.LayoutParams
    private var drag: Drag? = null
    private var glide: ValueAnimator? = null
    private var target: CloseTarget? = null
    private var speech: SpeechBubble? = null

    private var sleepyTimer: Job? = null
    private var hideTimer: Job? = null // while it runs the head is hidden for a picture of the screen
    private var heldWords: String? = null // said while the head was out of a sheet's way: said when the last one goes
    private var heldAt = 0L // when they were said (elapsedRealtime)

    // Look where I type (LookService): where the head looks, and the timer that turns it back to the front 3 s after.
    private val lookHold = LookHold { SystemClock.elapsedRealtime() }
    private var lookTimer: Job? = null

    // The head draws only while it is visible, and an overlay stays "visible" with the screen off or locked, so it is
    // hidden then: the Mac's buddy:pause on lock-screen.
    private var screenOff = false

    // Claude Code on the person's computer, for Clawd in the head's eye: the sessions they share through Buddy's server.
    private val claudeWatch = ClaudeWatch(
        scope = lifecycleScope,
        look = {
            val graph = AppGraph.instance
            if (!graph.account.isSignedIn()) null
            else graph.cloud.remoteLook().takeIf { it.online }?.sessions?.map { it.status }
        },
        paused = { screenOff },
        onKind = { head?.claude = it },
    )
    private var screenReceiver: BroadcastReceiver? = null

    // "Hey <name>": the microphone is only ever started from an app screen (ACTION_LISTEN); see WakeControl.
    private var listening = false // this service is a microphone one now
    private val wakeControl by lazy {
        WakeControl(this, AppGraph.instance, lifecycleScope, chatBusy = { AppGraph.instance.handsFree.busy },
            canAsk = { AppGraph.instance.handsFree.canAsk() }, ask = { AppGraph.instance.handsFree.askYes() }) { wav -> AppGraph.instance.handsFree.request(wav) }
    }

    // The person can take "Display over other apps" away in the phone's settings while Buddy runs. Android then hides
    // the windows and refuses new ones, so the service stops, and the app says why the buddy is gone.
    private var overlayWatcher: AppOpsManager.OnOpChangedListener? = null

    override fun onCreate() {
        super.onCreate()
        windows = getSystemService(WindowManager::class.java)
        val channel = NotificationChannel(CHANNEL, getString(R.string.bubble_channel), NotificationManager.IMPORTANCE_LOW)
        channel.setShowBadge(false)
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        // In the foreground first, even to stop at once: Android treats a service started for the foreground that
        // stops before it gets there as a crash.
        if (!foreground(capturing = false)) {
            stopSelf()
            return
        }
        // Turned off meanwhile: a late start (the end of a screen picture, a restart by Android) must not bring the
        // head back.
        if (!settings.buddyOn) {
            stopSelf()
            return
        }
        // Without "Display over other apps" there is nowhere to float: the app says why, and asks for it.
        if (!Settings.canDrawOverlays(this) || !showWindows()) {
            stopSelf()
            return
        }
        watchOverlayPermission()
        listenToScreen()
        // Listening was on, and this is a restart (the phone's, or Android's): a microphone service cannot be started
        // from the background, so the person is asked to tap, and listening begins from the app screen they open.
        if (settings.wakeOn) needsTap()
        AppGraph.instance.ringWatch.start() // who is calling, when asked (calls/Ringing.kt)
        claudeWatch.start()
        // Where Clawd walks with the head: the admin's choice, from Buddy's server (on the head for someone signed out).
        lifecycleScope.launch {
            AppGraph.instance.cloud.free.collect { head?.clawdLook = Clawd.lookOf(it?.clawdLook) }
        }
        lifecycleScope.launch {
            BubbleBus.events.collect { event ->
                when (event) {
                    is BubbleEvent.SetMood -> mood(event.mood)
                    is BubbleEvent.Say -> say(event.text, event.onTap)
                    is BubbleEvent.HideFor -> hideFor(event.ms)
                    is BubbleEvent.LookAt -> lookAt(LookPoint(event.x, event.y))
                    BubbleEvent.LookAway -> lookAway()
                    is BubbleEvent.Speech -> speak(event.text)
                    BubbleEvent.SpeechDone -> speech?.release(VoiceWords.BUBBLE_HIDE_MS)
                }
            }
        }
        lifecycleScope.launch {
            BubbleBus.sheetOpen.collect { open ->
                if (open) speech?.hide() // it would sit over the card
                showOrHide()
                if (!open) heldWords?.let {
                    heldWords = null
                    // A Copy in a Fix sheet over the panel is held until the panel goes too, which can be much later:
                    // by then "Copied — …" is about nothing the person just did.
                    if (SystemClock.elapsedRealtime() - heldAt < HELD_MS) say(it)
                }
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        super.onStartCommand(intent, flags, startId)
        if (head == null) return START_NOT_STICKY // it stopped at once in onCreate
        if (intent?.action == ACTION_TURN_OFF) {
            turnOff()
            return START_NOT_STICKY
        }
        if (!settings.buddyOn) { // turned off in the app meanwhile: as in onCreate
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_CAPTURE) foreground(capturing = !intent.getBooleanExtra(EXTRA_DONE, false))
        if (intent?.action == ACTION_LOOK) showLook()
        if (intent?.action == ACTION_LISTEN) startListening()
        if (intent?.action == ACTION_WAKE) wakeChanged()
        if (intent?.action == ACTION_TEST && listening) wakeControl.refresh(testMs = intent.getLongExtra(EXTRA_MS, 10_000L))
        if (intent?.action == ACTION_ENROLL && listening) {
            // "Only my voice" setup: for the time given, only this phrase is listened for, with no voice check; each
            // phrase's audio goes to BubbleBus.clips
            val phrase = intent.getStringExtra(EXTRA_PHRASE).orEmpty()
            if (phrase.isNotEmpty()) wakeControl.refresh(testMs = intent.getLongExtra(EXTRA_MS, MyVoiceRules.SETUP_MS), only = listOf(phrase), clips = true)
        }
        if (intent?.action == ACTION_ENROLL_STOP && listening) wakeControl.refresh()
        return START_STICKY
    }

    /** Another buddy, or another size, chosen in Settings: shown at once, as the Mac reloads its model and resizes. */
    private fun showLook() {
        val view = head ?: return
        view.characterId = settings.characterId
        if (drag?.dragging == true) return // where it is let go is snapped at the new size
        glide?.cancel()
        speech?.hide()
        placeHead()
        windows.updateViewLayout(view, headPlace)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        val view = head ?: return
        if (drag?.dragging == true) return // where it is let go is snapped to the new screen
        // The phone turned (or the screen changed size): back to the head's side and height, on the new screen.
        glide?.cancel()
        speech?.hide()
        placeHead()
        windows.updateViewLayout(view, headPlace)
    }

    override fun onDestroy() {
        if (listening) wakeControl.stop()
        claudeWatch.stop()
        glide?.cancel()
        overlayWatcher?.let { getSystemService(AppOpsManager::class.java).stopWatchingMode(it) }
        overlayWatcher = null
        AppGraph.instance.ringWatch.stop()
        screenReceiver?.let { unregisterReceiver(it) }
        screenReceiver = null
        speech?.hide()
        target?.remove()
        target = null
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
    private fun foreground(capturing: Boolean, microphone: Boolean = listening): Boolean {
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        if (capturing) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        if (microphone) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        return try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(microphone), types)
            true
        } catch (e: IllegalStateException) {
            Log.w(TAG, "bubble: not in the foreground (${e.javaClass.simpleName})") // started from the background
            false
        } catch (e: SecurityException) {
            Log.w(TAG, "bubble: not in the foreground (${e.javaClass.simpleName})") // a capture not agreed to
            false
        }
    }

    private fun notification(microphone: Boolean = listening): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val off = Intent(this, BubbleService::class.java).setAction(ACTION_TURN_OFF)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.bubble_on))
            .setContentText(if (microphone) VoiceWords.WakeLines.listening(settings.buddyName, nameHeard()) else getString(R.string.bubble_on_text))
            .setContentIntent(open)
            .addAction(0, getString(R.string.bubble_turn_off), PendingIntent.getService(this, 0, off, PendingIntent.FLAG_IMMUTABLE))
            .setOngoing(true)
            .setShowWhen(false)
            .build()
    }

    /**
     * Sent from an app screen that is open: becomes a microphone service and starts listening. Android refuses the
     * microphone type unless an activity is on screen (and after a restart), and then the person is asked to tap.
     */
    private fun startListening() {
        if (!settings.wakeOn || listening) return
        if (!micAllowed()) return needsTap() // taken away in Android's settings: the line says to allow it
        if (foreground(capturing = false, microphone = true)) {
            listening = true
            settings.wakeNeedsTap = false
            wakeControl.start()
        } else {
            foreground(capturing = false, microphone = false) // stays the bubble it was
            needsTap()
        }
    }

    /** The switch or the name changed in Settings: listen for the new phrases, or stop (and stop being a microphone service). */
    private fun wakeChanged() {
        if (!settings.wakeOn) {
            settings.wakeNeedsTap = false
            if (listening) {
                listening = false
                wakeControl.stop()
                foreground(capturing = false, microphone = false)
            }
            return
        }
        if (listening) {
            foreground(capturing = false) // the notification names the buddy
            wakeControl.refresh()
        }
    }

    /** Whether "Hey <name>" wakes it too, besides "Hey Buddy" (the notification's words). */
    private fun nameHeard() = WakeRules.nameHeard(settings.buddyName, AppGraph.instance.shared.voiceModelMissing)

    private fun micAllowed() = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun needsTap() {
        settings.wakeNeedsTap = true
        tapLine()
    }

    /** "Tap me to listen again", or, when the microphone was taken away, to allow it. */
    private fun tapLine() {
        say(if (micAllowed()) VoiceWords.WakeLines.TAP_TO_LISTEN else VoiceWords.WakeLines.MIC_NEEDED, ::openPanel)
    }

    /** Buddy off, as "Turn off" in the Mac's menu: it stays off, after a restart too, until the person turns it on. */
    private fun turnOff() {
        settings.buddyOn = false
        stopSelf()
    }

    private fun watchOverlayPermission() {
        // Told on a binder thread: the check and the stop go over to the main one.
        val watcher = AppOpsManager.OnOpChangedListener { _, _ ->
            lifecycleScope.launch { if (!Settings.canDrawOverlays(this@BubbleService)) stopSelf() }
        }
        getSystemService(AppOpsManager::class.java).startWatchingMode(AppOpsManager.OPSTR_SYSTEM_ALERT_WINDOW, packageName, watcher)
        overlayWatcher = watcher
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

    /** The ✕ (hidden) and then the head, so that the head is drawn over the ✕. False when Android refuses either. */
    private fun showWindows(): Boolean {
        val close = CloseTarget(this, windows)
        if (!close.add()) return false
        target = close
        speech = SpeechBubble(this, windows, lifecycleScope)
        headPlace = overlay(0, 0, FLAG_LAYOUT_NO_LIMITS)
        placeHead()
        val view = HeadView(this)
        view.characterId = settings.characterId
        drag = Drag(view).also { view.setOnTouchListener(it) }
        view.setOnClickListener { if (speech?.spoken == true) { speech?.hide(); openHandsFreeChat() } else openPanel() }
        // What TalkBack says for the head. Only the floating head is named: a head in the app is a picture beside words
        // that say what it is.
        view.contentDescription = "Buddy"
        if (!windows.tryAdd(view, headPlace)) {
            view.release()
            return false
        }
        head = view
        view.mood = Mood.WAVE
        return true
    }

    /** Where the head is kept: its saved side and height, on the screen as it is now. */
    private fun savedSpot(area: Rect, size: Int): Point {
        val margin = px(MARGIN_DP)
        return Point(
            area.left + if (settings.bubbleRight) area.width() - size - margin else margin,
            area.top + Snap.yFromFraction(settings.bubbleY, size, area.height(), margin),
        )
    }

    private fun placeHead() {
        val size = (settings.size.dp * ROOM * resources.displayMetrics.density).roundToInt()
        val spot = savedSpot(area(), size)
        headPlace.width = size
        headPlace.height = size
        headPlace.x = spot.x
        headPlace.y = spot.y
    }

    private fun moveHead(x: Int, y: Int) {
        val view = head ?: return
        headPlace.x = x
        headPlace.y = y
        windows.updateViewLayout(view, headPlace)
    }

    private fun headBounds() = Rect(headPlace.x, headPlace.y, headPlace.x + headPlace.width, headPlace.y + headPlace.height)

    private fun openPanel() {
        startActivity(Intent(this, PanelActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** The hands-free chat on screen: a tap on its speech bubble, or on the head while that bubble is up. */
    private fun openHandsFreeChat() {
        startActivity(Intent(this, HandsFreeChatActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
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
        private var glideCut = false // the press stopped the head on its way to the side
        var dragging = false
            private set

        override fun onTouch(v: View, event: MotionEvent): Boolean {
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    // Stopped where it is, so that a drag starts from under the finger.
                    glideCut = glide?.isRunning == true
                    glide?.cancel()
                    view.pressing = true
                    downX = event.rawX
                    downY = event.rawY
                    startX = headPlace.x
                    startY = headPlace.y
                    dragging = false
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downX
                    val dy = event.rawY - downY
                    if (!dragging && hypot(dx, dy) > slop) {
                        dragging = true
                        mood(Mood.WOBBLE)
                        speech?.hide()
                        target?.show(area())
                    }
                    if (dragging) {
                        moveHead(startX + dx.roundToInt(), startY + dy.roundToInt())
                        target?.follow(headPlace.x + headPlace.width / 2f, headPlace.y + headPlace.height / 2f)
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    view.pressing = false
                    val up = event.actionMasked == MotionEvent.ACTION_UP
                    if (dragging) {
                        dragging = false
                        val overTarget = up && target?.over == true
                        target?.hide()
                        if (overTarget) turnOff() else drop()
                    } else {
                        // A tap while it glided: it goes on to its side, rather than staying mid-screen.
                        if (glideCut) savedSpot(area(), headPlace.width).let { glideTo(it.x, it.y) }
                        if (up) v.performClick()
                    }
                }
            }
            return true
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
     * Turn the head toward where the person types, from the middle of its window, and back to the front 3 s after the
     * last time. Only the turn changes: a head hidden for a sheet or a picture of the screen stays hidden.
     */
    private fun lookAt(point: LookPoint) {
        val view = head ?: return
        lookHold.lookAt(point)
        val centreX = headPlace.x + headPlace.width / 2f
        val centreY = headPlace.y + headPlace.height / 2f
        view.look(Look.turn(point, centreX, centreY, resources.displayMetrics.density))
        lookTimer?.cancel()
        lookTimer = lifecycleScope.launch {
            while (lookHold.msLeft() > 0) delay(lookHold.msLeft())
            lookTimer = null
            head?.look(Turn.FRONT)
        }
    }

    private fun lookAway() {
        lookHold.away()
        lookTimer?.cancel()
        lookTimer = null
        head?.look(Turn.FRONT)
    }

    private fun say(text: String, onTap: (() -> Unit)? = null) {
        val view = head ?: return
        if (view.visibility != View.VISIBLE) {
            // Out of a sheet's way, and nothing else: kept until the last sheet goes, since Copy says "Copied — …"
            // just before it closes its sheet. Otherwise nobody would see it, or it would be in a picture of the screen.
            // A tap is not kept: the words alone are said then.
            if (!screenOff && hideTimer?.isActive != true && BubbleBus.sheetOpen.value) {
                heldWords = text
                heldAt = SystemClock.elapsedRealtime()
            }
            return
        }
        if (!Settings.canDrawOverlays(this)) return // taken away a moment ago: the watcher is about to stop the service
        speech?.say(text, headBounds(), area(), onTap)
    }

    /** A hands-free answer in the speech bubble, held until SpeechDone; null holds what is up. A tap opens that chat. */
    private fun speak(text: String?) {
        val bubble = speech ?: return
        if (text == null) return bubble.keep()
        val view = head ?: return
        // Out of a sheet's way, or no overlay any more: the chat has the words, and nobody would see them now.
        if (view.visibility != View.VISIBLE || !Settings.canDrawOverlays(this)) return
        bubble.say(text, headBounds(), area(), ::openHandsFreeChat, stay = true)
    }

    private fun hideFor(ms: Long) {
        speech?.hide()
        hideTimer?.cancel()
        hideTimer = lifecycleScope.launch {
            delay(ms)
            hideTimer = null
            showOrHide()
        }
        showOrHide()
    }

    /**
     * The head shows unless the screen is off or locked, a sheet (the panel or a Fix sheet) is open, or a picture of the
     * screen is being taken. Hidden, it does not draw; its mood still changes, and shows when it comes back.
     */
    private fun showOrHide() {
        val hidden = screenOff || BubbleBus.sheetOpen.value || hideTimer?.isActive == true
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
                if (intent.action == Intent.ACTION_USER_PRESENT && settings.wakeOn && settings.wakeNeedsTap) {
                    tapLine()
                }
            }
        }
        val filter = IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        }
        // EXPORTED on purpose: on Android 16 a not-exported receiver never hears USER_PRESENT (all three are system-only broadcasts).
        ContextCompat.registerReceiver(this, receiver, filter, ContextCompat.RECEIVER_EXPORTED)
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

        private const val ACTION_LOOK = "com.akshatgg.buddy.LOOK"
        private const val ACTION_LISTEN = "com.akshatgg.buddy.LISTEN"
        private const val ACTION_WAKE = "com.akshatgg.buddy.WAKE"
        private const val ACTION_TEST = "com.akshatgg.buddy.WAKE_TEST"
        private const val EXTRA_MS = "ms"
        private const val ACTION_ENROLL = "com.akshatgg.buddy.MY_VOICE_ENROLL"
        private const val ACTION_ENROLL_STOP = "com.akshatgg.buddy.MY_VOICE_ENROLL_STOP"
        private const val EXTRA_PHRASE = "phrase"

        /** Setting up "Only my voice": for `ms` the listener hears only `phrase` and gives each one's audio to BubbleBus.clips. */
        fun enroll(context: Context, phrase: String, ms: Long) = sendEnroll(context) {
            it.setAction(ACTION_ENROLL).putExtra(EXTRA_PHRASE, phrase).putExtra(EXTRA_MS, ms)
        }

        /** Setup is over (or the switch changed): the listener goes back to the normal phrases, with the voice check as now set. */
        fun stopEnroll(context: Context) = sendEnroll(context) { it.setAction(ACTION_ENROLL_STOP) }

        private fun sendEnroll(context: Context, build: (Intent) -> Intent) {
            val graph = AppGraph.instance
            if (!graph.settings.buddyOn || !graph.settings.wakeOn) return
            try {
                ContextCompat.startForegroundService(context, build(Intent(context, BubbleService::class.java)))
            } catch (e: IllegalStateException) {
                Log.w(TAG, "bubble: not told (${e.javaClass.simpleName})")
            }
        }

        /** Settings' Test it: for `ms` the listener only counts wakes (BubbleBus.wakes), and takes no request. */
        fun test(context: Context, ms: Long) {
            val graph = AppGraph.instance
            if (!graph.settings.buddyOn || !graph.settings.wakeOn) return
            try {
                ContextCompat.startForegroundService(context, Intent(context, BubbleService::class.java).setAction(ACTION_TEST).putExtra(EXTRA_MS, ms))
            } catch (e: IllegalStateException) {
                Log.w(TAG, "bubble: not told (${e.javaClass.simpleName})")
            }
        }

        /**
         * Start listening for "Hey <name>". Only from an activity that is on screen (Android 14 allows a microphone
         * service to begin only then): the panel's and the app's start. Nothing happens unless the switch is on.
         */
        fun listen(context: Context) = send(context, ACTION_LISTEN) { it.settings.wakeOn }

        /** Called when an app screen starts: listens if the switch is on and the service is not yet a microphone one. */
        fun listenIfNeeded(context: Context) = listen(context)

        /** The switch or the buddy's name changed in Settings. */
        fun wakeChanged(context: Context) = send(context, ACTION_WAKE) { true }

        private fun send(context: Context, action: String, wanted: (AppGraph) -> Boolean) {
            val graph = AppGraph.instance
            if (!graph.settings.buddyOn || !wanted(graph)) return
            try {
                ContextCompat.startForegroundService(context, Intent(context, BubbleService::class.java).setAction(action))
            } catch (e: IllegalStateException) {
                Log.w(TAG, "bubble: not told (${e.javaClass.simpleName})")
            }
        }

        /** Show the buddy, and keep it on screen until stop() or the person turns it off. */
        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, BubbleService::class.java))
            } catch (e: IllegalStateException) {
                // Android allows it from the app on screen, at boot and after an update, but not from the background.
                Log.w(TAG, "bubble: not started (${e.javaClass.simpleName})")
            }
        }

        /** The buddy or its size changed in Settings: the floating one shows it. Nothing happens while Buddy is off. */
        fun lookChanged(context: Context) {
            if (!AppGraph.instance.settings.buddyOn) return
            try {
                ContextCompat.startForegroundService(context, Intent(context, BubbleService::class.java).setAction(ACTION_LOOK))
            } catch (e: IllegalStateException) {
                Log.w(TAG, "bubble: not told (${e.javaClass.simpleName})")
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, BubbleService::class.java))
        }
    }
}
