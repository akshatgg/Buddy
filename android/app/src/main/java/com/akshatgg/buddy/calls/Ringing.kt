package com.akshatgg.buddy.calls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat

/** The phone's own call, as Buddy last heard of it: ringing or not, and the number ringing (null when not known). */
data class Ring(val ringing: Boolean = false, val number: String? = null)

/**
 * The ring after one of Android's phone-state broadcasts (`state` is TelephonyManager's EXTRA_STATE: "RINGING",
 * "OFFHOOK" or "IDLE"). Android 10 and later send a ringing twice, once with the number (to apps that may read the call
 * log) and once without: the number heard for this ring is kept. Answered or over, it is forgotten.
 */
fun Ring.after(state: String?, number: String?): Ring = when (state) {
    "RINGING" -> Ring(true, number?.trim()?.takeIf { it.isNotEmpty() } ?: this.number.takeIf { ringing })
    "OFFHOOK", "IDLE" -> Ring()
    else -> this
}

/**
 * Listens for the phone's ringing while Buddy's bubble runs (BubbleService starts and stops it), to know who is calling
 * when the person asks. Android 12 and later give the number to no listener (TelephonyCallback has none); this
 * broadcast still carries it on 8 to 16, to an app holding READ_PHONE_STATE and READ_CALL_LOG. Without them nothing
 * arrives. Only the ringing number is kept, and only while it rings.
 */
class RingWatch(private val context: Context) {
    @Volatile
    var now: Ring = Ring()
        private set
    private var receiver: BroadcastReceiver? = null

    fun start() {
        if (receiver != null) return
        val heard = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                @Suppress("DEPRECATION") // EXTRA_INCOMING_NUMBER: the only way left to the ringing number
                val number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
                now = now.after(intent.getStringExtra(TelephonyManager.EXTRA_STATE), number)
            }
        }
        // A protected broadcast: only the system sends it, and it still arrives at a receiver that is not exported.
        ContextCompat.registerReceiver(context, heard, IntentFilter(TelephonyManager.ACTION_PHONE_STATE_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
        receiver = heard
    }

    fun stop() {
        receiver?.let { context.unregisterReceiver(it) }
        receiver = null
        now = Ring()
    }
}
