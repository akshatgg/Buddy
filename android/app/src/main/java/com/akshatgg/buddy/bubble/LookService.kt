package com.akshatgg.buddy.bubble

import android.accessibilityservice.AccessibilityService
import android.content.Context
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

/**
 * Look where I type: tells the floating head where the text box the person types in is, in any app, so that it turns
 * toward it (Look.kt, BubbleService). Optional: the person turns it on in Android's Accessibility settings, after
 * Settings' disclosure.
 *
 * It reads only where things are: whether a view is a text box and a password box, the box's place on the screen, and
 * the place of the one character before the cursor. Never the text: it does not call getText, and it keeps and logs
 * nothing. Its events go to the head in this process, and nowhere else.
 */
class LookService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (!BubbleBus.listening) return // no buddy on screen: nobody to turn
        val from = event.packageName?.toString()
        val fromBuddy = from == packageName
        val fromKeyboard = from != null && from == keyboardPackage()
        if (fromBuddy || fromKeyboard) return // LookFilter says NONE: not worth asking for the view
        val type = event.eventType
        val node = if (type == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) null else event.source
        try {
            val editable = node?.isEditable == true
            val password = node?.isPassword == true
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
        BubbleBus.lookAway()
        super.onDestroy()
    }

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

    private fun recycle(node: AccessibilityNodeInfo) {
        // Android asks for it before 13, and does it by itself from 13.
        @Suppress("DEPRECATION")
        if (Build.VERSION.SDK_INT < 33) node.recycle()
    }

    companion object {
        /** Whether the person has turned the service on in Android's Accessibility settings. */
        fun isEnabled(context: Context): Boolean = LookSetting.enabled(
            Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES),
            context.packageName,
            LookService::class.java.name,
        )
    }
}
