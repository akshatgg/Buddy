package com.akshatgg.buddy.voice

import android.content.Context
import android.media.AudioAttributes
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import java.util.UUID

/** Buddy's voice. `say` returns when the words have been spoken (or could not be). */
interface Speaker { suspend fun say(text: String); fun stop() }

/** The phone's TextToSpeech, made on first use. Each say waits for onDone/onError, 20 s at most. */
class TtsSpeaker(context: Context) : Speaker {
    private val app = context.applicationContext
    private var tts: TextToSpeech? = null
    private var ready: CompletableDeferred<Boolean>? = null
    private val waiting = HashMap<String, CompletableDeferred<Unit>>()

    @Synchronized
    private fun engine(): CompletableDeferred<Boolean> {
        ready?.let { return it }
        val done = CompletableDeferred<Boolean>()
        ready = done
        tts = TextToSpeech(app) { status ->
            val t = tts
            if (status == TextToSpeech.SUCCESS && t != null) {
                t.setAudioAttributes(
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build(),
                )
                t.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(id: String?) {}
                    override fun onDone(id: String?) { finish(id) }
                    @Deprecated("Deprecated in Java")
                    override fun onError(id: String?) { finish(id) }
                    override fun onError(id: String?, code: Int) { finish(id) }
                    override fun onStop(id: String?, interrupted: Boolean) { finish(id) }
                })
                done.complete(true)
            } else done.complete(false)
        }
        return done
    }

    private fun finish(id: String?) { synchronized(waiting) { waiting.remove(id) }?.complete(Unit) }

    override suspend fun say(text: String) {
        if (text.isBlank()) return
        if (withTimeoutOrNull(5_000) { engine().await() } != true) return
        val id = UUID.randomUUID().toString()
        val done = CompletableDeferred<Unit>()
        synchronized(waiting) { waiting[id] = done }
        val t = tts
        if (t == null || t.speak(text, TextToSpeech.QUEUE_ADD, null, id) != TextToSpeech.SUCCESS) {
            finish(id); return
        }
        try {
            withTimeoutOrNull(20_000) { done.await() }
        } finally {
            synchronized(waiting) { waiting.remove(id) }
        }
    }

    override fun stop() {
        runCatching { tts?.stop() }
        val all = synchronized(waiting) { waiting.values.toList().also { waiting.clear() } }
        all.forEach { it.complete(Unit) }
    }
}
