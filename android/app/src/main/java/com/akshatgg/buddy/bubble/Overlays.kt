package com.akshatgg.buddy.bubble

import android.content.Context
import android.graphics.PixelFormat
import android.os.Build
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
import android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
import android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
import android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
import kotlin.math.roundToInt

// What the floating buddy's windows (the head, the ✕ and the speech bubble) share.

internal const val MARGIN_DP = 8 // between a window and the edges of the screen or the head, as the Mac's MARGIN

// Android lets touches through another app's window only when it is at most this opaque, and lowers a window that
// touches go through to it, with a warning in the log.
private const val MOST_OPAQUE_PASS_THROUGH = 0.8f

internal fun Context.px(dp: Number): Int = (dp.toFloat() * resources.displayMetrics.density).roundToInt()

/**
 * A see-through window over every app that never takes the keyboard. Every one is laid out in the screen's own
 * pixels, from its top-left corner, status bar included, so that the head, the ✕ and the speech bubble share one set
 * of coordinates.
 */
internal fun overlay(width: Int, height: Int, flags: Int) = WindowManager.LayoutParams(
    width, height, TYPE_APPLICATION_OVERLAY, flags or FLAG_NOT_FOCUSABLE or FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT,
).apply {
    gravity = Gravity.TOP or Gravity.START
    // Not moved down below the status bar or up above the navigation bar: the service keeps the head clear of them.
    if (Build.VERSION.SDK_INT >= 30) fitInsetsTypes = 0
    if (flags and FLAG_NOT_TOUCHABLE != 0) alpha = MOST_OPAQUE_PASS_THROUGH
}

/**
 * Add a window, or answer false: the person can take "Display over other apps" away while Buddy runs, and Android
 * then refuses new windows.
 */
internal fun WindowManager.tryAdd(view: View, place: WindowManager.LayoutParams): Boolean = try {
    addView(view, place)
    true
} catch (e: WindowManager.BadTokenException) {
    Log.w("Buddy", "bubble: window refused (${e.javaClass.simpleName})")
    false
}
