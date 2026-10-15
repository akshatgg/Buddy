package com.akshatgg.buddy.ui.panel

import android.Manifest

/** The line the chat shows just before Android asks for a permission, saying why; null for none. */
internal fun whyLine(permission: String): String? = when (permission) {
    Manifest.permission.CALL_PHONE -> "I need your OK to make calls."
    Manifest.permission.READ_PHONE_STATE -> "I need your OK to see who is calling."
    Manifest.permission.READ_CALL_LOG -> "I need your OK to see your calls."
    else -> null
}

/**
 * Whether Buddy holds `permission`, asking the person when it does not (the chat says why first). `held` is Android's
 * own say (checkSelfPermission), read again once the question ends: the answer that came back is not trusted, since a
 * late answer to another question (the contacts one, or another permission) may be what ended the wait. `launch` null:
 * there is nobody to ask (no activity).
 */
internal suspend fun allowedAfterAsking(
    permission: String,
    held: (String) -> Boolean,
    answer: PendingAnswer<Boolean>,
    launch: ((String) -> Unit)?,
    note: (String) -> Unit,
): Boolean {
    if (held(permission)) return true
    val ask = launch ?: return false
    whyLine(permission)?.let(note)
    answer.ask { ask(permission) }
    return held(permission)
}
