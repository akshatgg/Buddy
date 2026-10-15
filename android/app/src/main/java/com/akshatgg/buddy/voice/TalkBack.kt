package com.akshatgg.buddy.voice

import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withTimeoutOrNull

/** Buddy talking and listening with the person. */
interface TalkBack {
    suspend fun say(text: String)
    /** Starts 300 ms after say() returned, so Buddy never hears itself. NO for anything unclear. */
    suspend fun hear(verb: String): Heard
    /** One more request ("Priya Sharma"), written down; null for nothing. */
    suspend fun listen(): String?
    /** Speaking and listening end at once; a hear() then answers NO (until the next say()). */
    fun stop()

    companion object {
        val SILENT: TalkBack = object : TalkBack {
            override suspend fun say(text: String) {}
            override suspend fun hear(verb: String): Heard = Heard.NO
            override suspend fun listen(): String? = null
            override fun stop() {}
        }
    }
}

/** Whether the phone is locked, and a wait for the person to unlock it. */
interface Lock {
    fun locked(): Boolean
    suspend fun unlocked(withinMs: Long): Boolean

    companion object {
        val OPEN: Lock = object : Lock {
            override fun locked() = false
            override suspend fun unlocked(withinMs: Long) = true
        }
    }
}

class PhoneTalkBack(
    private val speaker: Speaker,
    private val ears: Ears,
    private val model: VoiceModel,
    private val transcribe: suspend (ByteArray, String) -> String,
    private val warm: () -> Unit = {}, // loads the model ahead; must not block
) : TalkBack {
    @Volatile private var stopped = false
    private val inFlight = java.util.Collections.synchronizedSet(HashSet<Deferred<*>>())

    override suspend fun say(text: String) {
        stopped = false
        warm() // the ears load while the question is spoken, so that the first "yes" is not lost to the load
        MicBus.holding { speaker.say(text) } // the wake listener is not live while Buddy talks
    }

    /** Runs `block` as a job that stop() can cancel; `onStop` is the answer when it was. */
    private suspend fun <T> stoppable(onStop: T, block: suspend () -> T): T {
        if (stopped) return onStop
        return coroutineScope {
            val job = async { block() }
            inFlight.add(job)
            if (stopped) job.cancel() // stop() came between the check above and here
            try {
                job.await()
            } catch (e: CancellationException) {
                if (currentCoroutineContext().isActive && stopped) onStop else throw e
            } finally {
                inFlight.remove(job)
            }
        }
    }

    override suspend fun hear(verb: String): Heard = stoppable(Heard.NO) {
        MicBus.holding { // the wake listener steps aside while the answer is heard
            delay(300)
            if (!model.ready()) model.fetchInBackground()
            ears.hear(verb)
        }
    }

    override suspend fun listen(): String? = stoppable<String?>(null) {
        val wav = MicBus.holding {
            delay(300)
            ears.request()
        } ?: return@stoppable null
        try {
            transcribe(wav, "audio/wav").trim().ifEmpty { null }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            null
        }
    }

    override fun stop() {
        stopped = true
        synchronized(inFlight) { inFlight.toList() }.forEach { it.cancel() }
        speaker.stop()
    }
}

/** The phone's lock screen: waits for ACTION_USER_PRESENT (the person unlocked it). */
class KeyguardLock(private val context: Context) : Lock {
    private val keyguard get() = context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager

    override fun locked(): Boolean = keyguard.isKeyguardLocked

    override suspend fun unlocked(withinMs: Long): Boolean {
        val present = CompletableDeferred<Unit>()
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, i: Intent?) { present.complete(Unit) }
        }
        ContextCompat.registerReceiver(context, receiver, IntentFilter(Intent.ACTION_USER_PRESENT), ContextCompat.RECEIVER_NOT_EXPORTED)
        try {
            if (!locked()) return true
            return withTimeoutOrNull(withinMs) { present.await(); true } ?: false
        } finally {
            runCatching { context.unregisterReceiver(receiver) }
        }
    }
}
