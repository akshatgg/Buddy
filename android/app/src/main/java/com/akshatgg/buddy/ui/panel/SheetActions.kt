package com.akshatgg.buddy.ui.panel

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.net.toUri
import com.akshatgg.buddy.notify.BuddyNotifications
import com.akshatgg.buddy.ui.MainActivity

// MainActivity scrolls Settings to this section: where a key, a model or free mode is set; the account; Buddy on and
// "Buddy can type for you".
private const val SECTION = "section"
private val AI_ERRORS = setOf("no_key", "bad_key", "no_credit", "bad_model", "no_vision", "need_key", "free_off")

private fun sectionFor(code: String?) = when (code) {
    in AI_ERRORS -> "ai"
    "signed_out", "not_set_up" -> "account"
    "buddy_off", "no_type" -> "buddy"
    else -> null
}

/** A chat text on the clipboard. Android 13 and later show their own "Copied"; the chat has the buddy say how to paste. */
internal fun Context.copyText(text: String) {
    getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Buddy", text))
}

/**
 * Where the fix for the error `code` is: the microphone, the contacts, calls and the call log in Buddy's own page of Android's settings;
 * Buddy in Android's Accessibility settings, to press WhatsApp's Send; Buddy in Android's Notification access settings
 * (its own switch on Android 11 and later, else the list); anything else in Settings, at the part that fixes
 * it (or at the top), in the app's own task: the panel's is apart and out of Recents, and a Fix with Buddy's is another
 * app's.
 */
internal fun Context.openSettingsFor(code: String?) {
    // Android's own pages, the first one the phone has: the panel's context is the app's, so they open in a task of
    // their own.
    val android = when (code) {
        "no_microphone", "no_contacts", "no_calls", "no_call_log" -> listOf(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:$packageName".toUri()))
        "no_accessibility" -> listOf(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) // as Settings' "Buddy can type for you"
        "no_notifs" -> notificationAccessPages()
        else -> emptyList()
    }
    if (android.isNotEmpty()) {
        for (page in android) {
            try {
                startActivity(page.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                return
            } catch (e: ActivityNotFoundException) {
                Log.w("Buddy", "settings: no page for ${page.action}") // a phone without it: the next one, or nothing
            }
        }
        return
    }
    val intent = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    sectionFor(code)?.let { intent.putExtra(SECTION, it) }
    startActivity(intent)
}

/** Buddy's own Notification access switch (Android 11 and later; not every phone has that page), then the whole list. */
private fun Context.notificationAccessPages(): List<Intent> {
    val list = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
    if (Build.VERSION.SDK_INT < 30) return listOf(list)
    val mine = ComponentName(this, BuddyNotifications::class.java).flattenToString()
    val detail = Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
        .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, mine)
    return listOf(detail, list)
}
