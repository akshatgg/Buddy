package com.akshatgg.buddy.ui.panel

import android.Manifest

/** The line the chat shows just before Android asks for a permission, saying why; null for none. */
internal fun whyLine(permission: String): String? = when (permission) {
    Manifest.permission.CALL_PHONE -> "I need your OK to make calls."
    Manifest.permission.READ_PHONE_STATE -> "I need your OK to see who is calling."
    Manifest.permission.READ_CALL_LOG -> "I need your OK to see your calls."
    else -> null
}
