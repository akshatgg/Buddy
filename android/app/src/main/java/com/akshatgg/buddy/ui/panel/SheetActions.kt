package com.akshatgg.buddy.ui.panel

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log
import androidx.core.net.toUri
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
 * Where the fix for the error `code` is: the microphone in Buddy's own page of Android's settings; anything else in
 * Settings, at the part that fixes it (or at the top), in the app's own task: the panel's is apart and out of Recents,
 * and a Fix with Buddy's is another app's.
 */
internal fun Context.openSettingsFor(code: String?) {
    if (code == "no_microphone") {
        val details = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:$packageName".toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            startActivity(details)
        } catch (e: ActivityNotFoundException) {
            Log.w("Buddy", "settings: no page for the app") // a phone without it: nothing to open
        }
        return
    }
    val intent = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    sectionFor(code)?.let { intent.putExtra(SECTION, it) }
    startActivity(intent)
}
