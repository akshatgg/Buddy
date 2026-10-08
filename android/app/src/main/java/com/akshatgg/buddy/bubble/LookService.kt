package com.akshatgg.buddy.bubble

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Rect
import android.graphics.RectF
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_LENGTH
import android.view.accessibility.AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_START_INDEX
import android.view.accessibility.AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY
import androidx.core.os.BundleCompat
import com.akshatgg.buddy.typing.BoxText
import com.akshatgg.buddy.typing.TypingTarget

/**
 * Buddy can type for you: Android's Accessibility, turned on by the person in Android's settings after Settings'
 * disclosure (optional). It does three things, and nothing else:
 *
 *  - Look where I type: tells the floating head where the text box the person types in is, so that it turns toward it
 *    (Look.kt, BubbleService). For that it reads only where things are, never the text.
 *  - It remembers the last text box the person typed in (a reference to it, TypingTarget, not its text) and the app
 *    they are in, so that the chat can name the app and find the box after the panel opened over it.
 *  - When the chat asks, and only then, it reads that box's text (`read`: the chat's "box" step, and the text it has
 *    before Buddy puts words in, for Undo) or sets it (`write`).
 *
 * A password box is never kept, read or written. It logs nothing and keeps no text: what it reads goes to the chat in
 * this process, and from there only with the person's question to the AI.
 */
class LookService : AccessibilityService() {
    private val target by lazy { TypingTarget(packageName, ::recycle, ::copy) }

    override fun onServiceConnected() {
        super.onServiceConnected()
        running = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        val from = event.packageName?.toString()
        val fromBuddy = from == packageName
        val fromKeyboard = from != null && from == keyboardPackage()
        val type = event.eventType
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) target.onWindow(from, fromKeyboard)
        if (fromBuddy || fromKeyboard) return // LookFilter says NONE, and TypingTarget keeps nothing of theirs
        val node = if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) null else event.source
        try {
            val editable = node?.isEditable == true
            val password = node?.isPassword == true
            if (node != null && editable && type in BOX_EVENTS) {
                // A copy is kept, which only TypingTarget touches (under its lock): this one is used below for the
                // look, on this thread, while the chat may be using the kept one on another.
                if (password) target.onPassword(from) else target.onBox(from, copy(node))
            }
            if (!BubbleBus.listening) return // no buddy on screen: nobody to turn
            when (LookFilter.action(type, fromBuddy, fromKeyboard, editable, password)) {
                LookAction.LOOK -> node?.let(::where)?.let { BubbleBus.lookAt(it.x, it.y) }
                LookAction.AWAY -> BubbleBus.lookAway()
                LookAction.NONE -> Unit
            }
        } finally {
            node?.let(::recycle)
        }
    }

    override fun onInterrupt() = Unit

    override fun onDestroy() {
        if (running === this) running = null
        BubbleBus.lookAway()
        super.onDestroy()
    }

    /** The label of the app the person was last in, or null. */
    fun appName(): String? {
        val pkg = target.app ?: return null
        return try {
            packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString().trim().ifEmpty { null }
        } catch (e: PackageManager.NameNotFoundException) {
            null
        }
    }

    /**
     * The kept box as it is now, read because the chat asked: its text (empty when it only shows its hint) and its
     * selection. Null when there is none, it has gone, it cannot be read, or it has become a password box.
     */
    fun read(): BoxText? = target.withBox { node ->
        val box = fresh(node) ?: return@withBox null
        val text = if (box.isShowingHintText) "" else box.text?.toString().orEmpty()
        BoxText(text, box.textSelectionStart, box.textSelectionEnd)
    }

    /** Set the kept box's whole text and put the cursor at `cursor`: false when it could not be set. */
    fun write(text: String, cursor: Int): Boolean = target.withBox { node ->
        val box = fresh(node) ?: return@withBox false
        val words = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
        if (!box.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, words)) return@withBox false
        val at = Bundle().apply {
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, cursor)
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, cursor)
        }
        box.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, at) // the cursor after the words: nice, not needed
        true
    } == true

    /**
     * The chat's copy of the kept box (TypingTarget.withBox), brought up to date; null when it is gone or is not a box
     * Buddy may touch. A node Android has let go of throws IllegalStateException, which withBox takes as gone.
     */
    private fun fresh(box: AccessibilityNodeInfo): AccessibilityNodeInfo? =
        box.takeIf { it.refresh() && it.isEditable && !it.isPassword }

    /** The keyboard's package, from the default input method ("pkg/.Cls"), or null. */
    private fun keyboardPackage(): String? =
        Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)?.substringBefore('/')

    /** Where to look for this box: its cursor when Android can say where that is, else its middle. */
    private fun where(box: AccessibilityNodeInfo): LookPoint? {
        val r = Rect()
        box.getBoundsInScreen(r)
        if (r.isEmpty) return null
        return Look.point(ScreenRect(r.left.toFloat(), r.top.toFloat(), r.right.toFloat(), r.bottom.toFloat()), cursor(box))
    }

    /**
     * The cursor, as a line on the screen: the right edge of the character before it (the left edge of the first one
     * when it is at the start). Null when the box does not say where its characters are, or the character is not on
     * screen.
     */
    private fun cursor(box: AccessibilityNodeInfo): ScreenRect? {
        if (EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY !in box.availableExtraData) return null
        val end = box.textSelectionEnd
        if (end < 0) return null
        val before = end > 0
        val args = Bundle().apply {
            putInt(EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_START_INDEX, if (before) end - 1 else 0)
            putInt(EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_LENGTH, 1)
        }
        if (!box.refreshWithExtraData(EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY, args)) return null
        val places = BundleCompat.getParcelableArray(box.extras, EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY, RectF::class.java)
        val c = places?.firstOrNull() as? RectF ?: return null
        val x = if (before) c.right else c.left
        return ScreenRect(x, c.top, x, c.bottom)
    }

    /** A node of one's own, for the same box: it reaches the app as the original does (refresh, actions). */
    private fun copy(node: AccessibilityNodeInfo): AccessibilityNodeInfo =
        if (Build.VERSION.SDK_INT >= 33) AccessibilityNodeInfo(node) else @Suppress("DEPRECATION") AccessibilityNodeInfo.obtain(node)

    private fun recycle(node: AccessibilityNodeInfo) {
        // Android asks for it before 13, and does it by itself from 13.
        @Suppress("DEPRECATION")
        if (Build.VERSION.SDK_INT < 33) node.recycle()
    }

    companion object {
        private val BOX_EVENTS = setOf(
            AccessibilityEvent.TYPE_VIEW_FOCUSED,
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED,
            AccessibilityEvent.TYPE_VIEW_TEXT_SELECTION_CHANGED,
        )

        /** The service while Android has it running; null when it is off. */
        @Volatile
        var running: LookService? = null
            private set

        /** Whether the person has turned the service on in Android's Accessibility settings. */
        fun isEnabled(context: Context): Boolean = LookSetting.enabled(
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES),
            context.packageName,
            LookService::class.java.name,
        )
    }
}
