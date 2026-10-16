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

/**
 * The phone's TextToSpeech, made on first use. Each say waits for onDone/onError, 20 s at most. It speaks with the voice
 * `voiceName` names, or the most natural English one (VoiceRank) when that is null or no longer on the phone.
 */
class TtsSpeaker(context: Context, private val voiceName: () -> String? = { null }) : Speaker {
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
            if (status != TextToSpeech.SUCCESS) {
                // Start failed: forget the engine so the next say() tries again.
                synchronized(this) {
                    if (ready === done) { ready = null; runCatching { tts?.shutdown() }; tts = null }
                }
            }
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

    /** The English voices on the phone, best first; empty when the engine did not start. */
    suspend fun voices(): List<VoiceInfo> {
        if (withTimeoutOrNull(5_000) { engine().await() } != true) return emptyList()
        return VoiceRank.ranked(infos(tts ?: return emptyList()))
    }

    private fun infos(t: TextToSpeech): List<VoiceInfo> = runCatching {
        t.voices.orEmpty().map { VoiceInfo(it.name, it.locale.toLanguageTag(), it.quality, it.isNetworkConnectionRequired, it.features.orEmpty()) }
    }.getOrDefault(emptyList())

    private fun pickVoice(t: TextToSpeech) {
        val name = VoiceRank.resolve(voiceName(), infos(t)) ?: return
        runCatching { t.voices.firstOrNull { it.name == name }?.let { t.voice = it } }
    }

    override suspend fun say(text: String) {
        if (text.isBlank()) return
        if (withTimeoutOrNull(5_000) { engine().await() } != true) return
        val id = UUID.randomUUID().toString()
        val done = CompletableDeferred<Unit>()
        synchronized(waiting) { waiting[id] = done }
        val t = tts
        if (t != null) pickVoice(t)
        if (t == null || t.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) {
            finish(id); return
        }
        try {
            if (withTimeoutOrNull(20_000) { done.await() } == null) runCatching { t.stop() } // never play on while listening
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
