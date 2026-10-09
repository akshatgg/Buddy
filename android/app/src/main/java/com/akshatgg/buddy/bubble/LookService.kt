package com.akshatgg.buddy.bubble

import android.accessibilityservice.AccessibilityService
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Rect
import android.graphics.RectF
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_LENGTH
import android.view.accessibility.AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_ARG_START_INDEX
import android.view.accessibility.AccessibilityNodeInfo.EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY
import androidx.core.os.BundleCompat
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.typing.BoxText
import com.akshatgg.buddy.typing.Tag
import com.akshatgg.buddy.typing.TagFlow
import com.akshatgg.buddy.typing.TagShow
import com.akshatgg.buddy.typing.TagTrace
import com.akshatgg.buddy.typing.TypingTarget
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

/**
 * Buddy can type for you: Android's Accessibility, turned on by the person in Android's settings after Settings'
 * disclosure (optional). It does four things, and nothing else:
 *
 *  - Look where I type: tells the floating head where the text box the person types in is, so that it turns toward it
 *    (Look.kt, BubbleService). For that it reads only where things are, never the text.
 *  - It remembers the last text box the person typed in (a reference to it, TypingTarget, not its text) and the app
 *    they are in, so that the chat can name the app and find the box after the panel opened over it.
 *  - When the chat asks, and only then, it reads that box's text (`read`: the chat's "box" step, and the text it has
 *    before Buddy puts words in, for Undo) or sets it (`write`).
 *  - Fix where I type (TagFlow, while Buddy and that setting are on): it looks at the text of a box as the person
 *    types in it, only to see whether it has "@buddy" (or the buddy's name) in it. When it does and they pause, it
 *    reads that box, sends the AI only the paragraph the tag ends (and what they wrote after the tag), and sets the box
 *    to the AI's text in its place; a tap on "Fixed ✅" puts the old text back.
 *
 * A password box is never kept, read, looked at or written. It logs nothing and keeps no text: what it reads goes to
 * the chat or to TagFlow in this process, and from there only with the person's question, or the tagged paragraph, to
 * the AI.
 */
class LookService : AccessibilityService() {
    private val target by lazy { TypingTarget(packageName, ::recycle, ::copy) }
    private var scope: CoroutineScope? = null
    private var tags: TagFlow? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        running = this
        val graph = AppGraph.instance
        val settings = graph.settings
        val mine = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        scope = mine
        tags = TagFlow(
            scope = mine,
            box = graph.typeIn,
            ask = graph.ask,
            wanted = { settings.buddyOn && settings.tagOn },
            names = { Tag.tagNames(settings.buddyName) },
            show = BusTagShow,
        )
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        val from = event.packageName?.toString()
        val fromBuddy = from == packageName
        val fromKeyboard = from != null && from == keyboardPackage()
        val type = event.eventType
        if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) target.onWindow(from, fromKeyboard)
        if (fromBuddy || fromKeyboard) return // LookFilter says NONE, and TypingTarget keeps nothing of theirs
        if (type == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED) {
            contentChanged(event, from)
            return
        }
        // The box: the event's own, or, from an app whose own box does not say it is one (a custom one), the box that
        // has the keyboard now.
        val source = if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) null else event.source
        val node = if (type == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED && (source == null || !isBox(source))) {
            source?.let(::recycle)
            focusedBox(from)
        } else {
            source
        }
        try {
            val editable = node?.let(::isBox) == true
            val password = node?.isPassword == true
            if (node != null && editable && type in BOX_EVENTS) {
                // A copy is kept, which only TypingTarget touches (under its lock): this one is used below for the
                // look, on this thread, while the chat may be using the kept one on another.
                if (password) target.onPassword(from) else target.onBox(from, copy(node))
            }
            if (type == AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED && node != null && editable) {
                // Fix where I type: only to look for the tag, and never in a password box.
                TagTrace.typedIn(labelOf(from))
                if (password || event.isPassword) tags?.stop() else tags?.onTyped(typed(event, node))
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
        tags?.stop()
        tags = null
        scope?.cancel()
        scope = null
        BubbleBus.lookAway()
        super.onDestroy()
    }

    private var lastContentLook = 0L // when a content change was last looked at for a box's text (contentChanged)

    /**
     * Some apps' own text boxes (drawn by the app, not Android's) say a change of text only as "the window's content
     * changed". With Fix where I type on, such a change from the app the person types in is looked at, at most every
     * CONTENT_LOOK_MS: the box with the keyboard, if it is one, is taken as typed in.
     */
    private fun contentChanged(event: AccessibilityEvent, from: String?) {
        if (from == null || tags == null || from == packageName) return
        if (event.contentChangeTypes and AccessibilityEvent.CONTENT_CHANGE_TYPE_TEXT == 0) return
        val settings = AppGraph.instance.settings
        if (!settings.buddyOn || !settings.tagOn) return
        val now = SystemClock.uptimeMillis()
        if (now - lastContentLook < CONTENT_LOOK_MS) return
        lastContentLook = now
        val box = focusedBox(from) ?: return
        try {
            if (box.isPassword) return
            target.onBox(from, copy(box))
            TagTrace.typedIn(labelOf(from))
            tags?.onTyped(if (box.isShowingHintText) "" else box.text ?: "")
        } finally {
            recycle(box)
        }
    }

    /** A node Buddy can type in: one that says it is editable, or that takes its text set (some apps' own boxes). */
    private fun isBox(node: AccessibilityNodeInfo): Boolean =
        node.isEditable || node.actionList.any { it.id == AccessibilityNodeInfo.ACTION_SET_TEXT }

    /** The box that has the keyboard now, in `from`'s window (not Buddy's, not a password's), or null. */
    private fun focusedBox(from: String?): AccessibilityNodeInfo? {
        val focused = try {
            findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
        } catch (e: RuntimeException) {
            null
        } ?: return null
        if (focused.packageName?.toString() != from || from == packageName || !isBox(focused)) {
            recycle(focused)
            return null
        }
        return focused
    }

    /** An app's label, for Settings' last step of Fix where I type, or its package when it has none. */
    private fun labelOf(pkg: String?): String? {
        if (pkg == null) return null
        return try {
            packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString().trim().ifEmpty { pkg }
        } catch (e: PackageManager.NameNotFoundException) {
            pkg
        }
    }

    /** The text a box changed to: the event's, else the box's own (empty while it only shows its hint). */
    private fun typed(event: AccessibilityEvent, box: AccessibilityNodeInfo): CharSequence {
        val said = event.text.joinToString("")
        if (said.isNotEmpty()) return said
        return if (box.isShowingHintText) "" else box.text ?: ""
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

    /**
     * Set the kept box's whole text and put the cursor at `cursor`: false when it could not be set. Some apps ignore a
     * text set from outside, or put their own back at once (a box they keep the text of themselves): then the text is
     * pasted over all of it instead, as the person would, and their clipboard is given back after.
     */
    fun write(text: String, cursor: Int): Boolean = target.withBox { node ->
        val box = fresh(node) ?: return@withBox false
        val words = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
        val set = box.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, words)
        if (!set || !holds(box, text)) {
            if (!paste(box, text)) return@withBox false
        }
        val at = Bundle().apply {
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, cursor)
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, cursor)
        }
        box.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, at) // the cursor after the words: nice, not needed
        true
    } == true

    /** Whether the box has `text` now (after a moment: some apps take one to show it). */
    private fun holds(box: AccessibilityNodeInfo, text: String): Boolean {
        repeat(3) {
            if (box.refresh() && box.text?.toString() == text) return true
            Thread.sleep(WRITE_SETTLE_MS)
        }
        return false
    }

    /** `text` pasted over all of the box, through the clipboard, whose own words are put back after. */
    private fun paste(box: AccessibilityNodeInfo, text: String): Boolean {
        if (!box.actionList.any { it.id == AccessibilityNodeInfo.ACTION_PASTE }) return false
        val clipboard = getSystemService(ClipboardManager::class.java) ?: return false
        val before = try {
            clipboard.primaryClip
        } catch (e: SecurityException) {
            null
        }
        clipboard.setPrimaryClip(ClipData.newPlainText("Buddy", text))
        val all = Bundle().apply {
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, 0)
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, box.text?.length ?: 0)
        }
        box.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, all)
        val pasted = box.performAction(AccessibilityNodeInfo.ACTION_PASTE) && holds(box, text)
        Thread.sleep(WRITE_SETTLE_MS) // the app reads the clipboard as it pastes: give it back after that
        // Their own clipboard back. When Android would not let Buddy read it, there is nothing to give back: the fixed
        // text stays on it (it is never cleared, which could lose theirs).
        if (before != null) clipboard.setPrimaryClip(before)
        return pasted
    }

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
        private const val CONTENT_LOOK_MS = 300L
        private const val WRITE_SETTLE_MS = 120L
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

/** Fix where I type shows itself on the floating buddy. */
private object BusTagShow : TagShow {
    override fun mood(mood: Mood) = BubbleBus.mood(mood)
    override fun say(text: String, onTap: (() -> Unit)?) = BubbleBus.say(text, onTap)
}
