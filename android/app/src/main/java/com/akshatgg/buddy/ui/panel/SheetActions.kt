package com.akshatgg.buddy.ui.panel

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import com.akshatgg.buddy.bubble.BubbleBus
import com.akshatgg.buddy.ui.MainActivity

private const val COPIED = "Copied — long-press the box and tap Paste"

// MainActivity scrolls Settings to this section: where a key, a model or free mode is set; the account; Buddy on.
private const val SECTION = "section"
private val AI_ERRORS = setOf("no_key", "bad_key", "no_credit", "bad_model", "no_vision", "need_key", "free_off")

private fun sectionFor(code: String?) = when (code) {
    in AI_ERRORS -> "ai"
    "signed_out", "not_set_up" -> "account"
    "buddy_off" -> "buddy"
    else -> null
}

/** An answer's Copy, in the panel and the Fix sheet; Android 13 and later show their own "Copied" too. */
internal fun Context.copyAnswer(text: String) {
    getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Buddy", text))
    BubbleBus.say(COPIED) // the buddy says how to paste it
}

/**
 * Settings, at the part that fixes the error `code` (or at the top), in the app's own task: the panel's is apart and
 * out of Recents, and the Fix sheet's is another app's.
 */
internal fun Context.openSettingsFor(code: String?) {
    val intent = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    sectionFor(code)?.let { intent.putExtra(SECTION, it) }
    startActivity(intent)
}
