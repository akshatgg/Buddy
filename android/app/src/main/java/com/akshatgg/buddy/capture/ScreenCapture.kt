package com.akshatgg.buddy.capture

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.graphics.Point
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import androidx.core.graphics.createBitmap
import androidx.core.graphics.scale
import com.akshatgg.buddy.bubble.BubbleService
import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.ByteArrayOutputStream
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.max
import kotlin.math.roundToInt

private const val LONG_EDGE = 1568 // as the Mac's helper: the most a vision model takes in without scaling it down
private const val THUMB_EDGE = 480
private const val JPEG_QUALITY = 80
private const val SETTLE_MS = 400L // Android's dialog leaves the screen, and the buddy's service steps into the foreground
private const val READY_MS = 2000L // after this, the service is not coming: Buddy is off
private const val RETRY_MS = 100L
private const val FRAME_MS = 3000L

/**
 * One picture of the whole screen, for Check screen, with MediaProjection. The person has just agreed to it in
 * Android's own dialog; Android 14 then lets the app capture only from a foreground service of the screen-capture
 * kind, so the buddy's service is asked to become one first (BubbleService.ACTION_CAPTURE), and to stop being one
 * when the picture is taken. The context is the panel's, so that the screen's size is the one it is shown on.
 */
class ScreenCapture(private val context: Context) {
    private val projections = context.getSystemService(MediaProjectionManager::class.java)

    /** The picture as base64 JPEG (q80, long edge at most 1568 px), and a small copy of it to show in the panel. */
    suspend fun captureOnce(resultCode: Int, data: Intent): Pair<String, Bitmap> {
        tellBuddy(done = false)
        var projection: MediaProjection? = null
        try {
            delay(SETTLE_MS)
            projection = projection(resultCode, data)
            val screen = firstFrame(projection)
            return withContext(Dispatchers.Default) { encode(screen) }
        } finally {
            projection?.stop()
            tellBuddy(done = true)
        }
    }

    private fun tellBuddy(done: Boolean) {
        val intent = Intent(context, BubbleService::class.java).setAction(BubbleService.ACTION_CAPTURE).putExtra(BubbleService.EXTRA_DONE, done)
        try {
            context.startService(intent)
        } catch (e: IllegalStateException) {
            Log.w("Buddy", "capture: service not told (${e.javaClass.simpleName})") // the panel is in the background now
        }
    }

    /**
     * The projection, once the buddy's service is a screen-capture service: until then Android refuses it with a
     * SecurityException. It is asked again for a moment, as the service runs on this same thread and gets its turn
     * between the tries. A service that never gets there has stopped: Buddy was turned off.
     */
    private suspend fun projection(resultCode: Int, data: Intent): MediaProjection {
        val giveUp = SystemClock.uptimeMillis() + READY_MS
        while (true) {
            try {
                return projections.getMediaProjection(resultCode, data) ?: throw couldNotCapture()
            } catch (e: SecurityException) {
                if (SystemClock.uptimeMillis() >= giveUp) throw buddyOff()
            }
            delay(RETRY_MS)
        }
    }

    /** The screen as it is now, in the current orientation, in real pixels. */
    private fun screenSize(): Point {
        val windows = context.getSystemService(WindowManager::class.java)
        if (Build.VERSION.SDK_INT >= 30) {
            val bounds = windows.maximumWindowMetrics.bounds
            return Point(bounds.width(), bounds.height())
        }
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        windows.defaultDisplay.getRealMetrics(metrics)
        return Point(metrics.widthPixels, metrics.heightPixels)
    }

    private suspend fun firstFrame(projection: MediaProjection): Bitmap {
        val size = screenSize()
        val main = Handler(Looper.getMainLooper())
        val reader = ImageReader.newInstance(size.x, size.y, PixelFormat.RGBA_8888, 2)
        var display: VirtualDisplay? = null
        var stopped: MediaProjection.Callback? = null
        try {
            return withTimeoutOrNull(FRAME_MS) {
                suspendCancellableCoroutine { waiting ->
                    // Android 14 wants to hear how a projection ends before a display is made from it. Ended before the
                    // first frame (the person stopped it from the status bar): no picture.
                    stopped = object : MediaProjection.Callback() {
                        override fun onStop() {
                            if (waiting.isActive) waiting.resumeWithException(couldNotCapture())
                        }
                    }.also { projection.registerCallback(it, main) }
                    reader.setOnImageAvailableListener({ r ->
                        try {
                            val image = r.acquireLatestImage() ?: return@setOnImageAvailableListener
                            r.setOnImageAvailableListener(null, null)
                            val bitmap = try {
                                // A row in the buffer can be longer than the screen is wide: the copy is that wide, then cut.
                                val plane = image.planes[0]
                                val rowPixels = plane.rowStride / plane.pixelStride
                                val wide = createBitmap(rowPixels, image.height)
                                wide.copyPixelsFromBuffer(plane.buffer)
                                if (rowPixels == image.width) {
                                    wide
                                } else {
                                    Bitmap.createBitmap(wide, 0, 0, image.width, image.height).also { wide.recycle() }
                                }
                            } finally {
                                image.close()
                            }
                            if (waiting.isActive) waiting.resume(bitmap) else bitmap.recycle()
                        } catch (e: Exception) {
                            // This runs on the main thread outside any coroutine, where an exception would take Buddy
                            // down: a frame that cannot be read is no picture, and the panel says so.
                            Log.w("Buddy", "capture: unreadable frame (${e.javaClass.simpleName})")
                            if (waiting.isActive) waiting.resumeWithException(couldNotCapture())
                        }
                    }, main)
                    display = projection.createVirtualDisplay(
                        "buddy-check", size.x, size.y, context.resources.displayMetrics.densityDpi,
                        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, reader.surface, null, main,
                    )
                }
            } ?: throw couldNotCapture()
        } finally {
            reader.setOnImageAvailableListener(null, null)
            display?.release()
            reader.close()
            stopped?.let { projection.unregisterCallback(it) }
        }
    }

    private fun encode(screen: Bitmap): Pair<String, Bitmap> {
        val sent = scaled(screen, LONG_EDGE)
        val jpeg = ByteArrayOutputStream().use { out ->
            sent.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
            Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        }
        val thumb = scaled(sent, THUMB_EDGE)
        if (sent !== screen) screen.recycle()
        if (thumb !== sent) sent.recycle()
        return jpeg to thumb
    }

    /** The bitmap itself when it is small enough, else a copy with its long edge at `edge`. */
    private fun scaled(bitmap: Bitmap, edge: Int): Bitmap {
        val long = max(bitmap.width, bitmap.height)
        if (long <= edge) return bitmap
        val k = edge.toFloat() / long
        return bitmap.scale((bitmap.width * k).roundToInt(), (bitmap.height * k).roundToInt())
    }

    companion object {
        fun buddyOff() = BuddyError("buddy_off", "Check screen needs Buddy to be on. Turn it on in Settings.")

        // The Mac helper's words when a screenshot fails.
        fun couldNotCapture() = BuddyError("capture_failed", "Could not take the screenshot. Try again.")
    }
}
