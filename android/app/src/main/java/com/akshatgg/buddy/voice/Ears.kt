package com.akshatgg.buddy.voice

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext

/** What the end of an answer hands on: the words to judge, or the recording for the server to write down. */
sealed interface Decision {
    data class Words(val text: String) : Decision
    data object Recording : Decision
}

/**
 * One spoken answer: decided on a final result with a yes or no word, else at the deadline. At the deadline the words
 * Vosk had are used if decisive; else, when the server must hear it (no model, or a word the model lacks) and a voice
 * was heard, the recording; else it is nothing, which is a no.
 */
class AnswerTurn(private val verb: String, private val needsServer: Boolean) {
    private var voice = false

    fun level(level: Float) { if (!level.isNaN() && level >= SpeechEnd.SPEECH_LEVEL) voice = true }

    fun result(text: String): Decision? = VoiceWords.words(text, verb)?.let { Decision.Words(text) }

    fun timeUp(finalText: String): Decision =
        result(finalText) ?: if (needsServer && voice) Decision.Recording else Decision.Words("")
}

/** Buddy's ears: a short answer (yes or no) and a longer request, from the microphone, time counted in samples. */
class Ears(
    private val mic: () -> PcmSource,
    private val spotters: () -> Spotters?, // null until the model is ready
    private val known: () -> Set<String>?,
    private val transcribe: suspend (ByteArray, String) -> String,
) {
    private companion object { const val CHUNK = 1_600 /* 100 ms */ }

    /** Anything unclear, an error included, is a no. */
    suspend fun hear(verb: String): Heard = withContext(Dispatchers.IO) {
        val maker = spotters()
        val grammar = VoiceWords.grammar(verb, if (maker != null) known() else null)
        val turn = AnswerTurn(verb, needsServer = maker == null || grammar.missing.isNotEmpty())
        var spotter: Spotter? = null
        var source: PcmSource? = null
        try {
            spotter = maker?.make(grammar.phrases)
            val mic = mic().also { source = it }
            if (!mic.start()) return@withContext Heard.NO
            val chunk = ShortArray(CHUNK)
            val kept = PcmKeeper(10 * Wav.RATE) // what was said, for the server when it must hear it (at most 10 s)
            val end = SpeechEnd(quietMs = 1_500, nothingMs = VoiceWords.ANSWER_MS, maxMs = 10_000)
            var samples = 0L
            var decision: Decision? = null
            while (decision == null && isActive) {
                val n = mic.read(chunk)
                if (n <= 0) break
                samples += n
                kept.add(chunk, n)
                val level = levelOf(chunk, n)
                turn.level(level)
                decision = spotter?.accept(chunk, n)?.let { turn.result(parseVosk(it).text) }
                if (decision == null && samples >= VoiceWords.ANSWER_MS * 16) {
                    decision = turn.timeUp(spotter?.let { parseVosk(it.finish()).text } ?: "")
                }
                // Without the model a quick "haan" does not wait the 8 s out.
                if (decision == null && spotter == null && end.feed(level, samples / 16) != End.LISTEN) decision = turn.timeUp("")
            }
            ensureActive() // after a stop nothing is written down and nothing goes to the server
            when (val d = decision ?: turn.timeUp("")) {
                is Decision.Words -> VoiceWords.heard(d.text, verb)
                Decision.Recording -> VoiceWords.heard(transcribe(Wav.of(kept.all()), "audio/wav"), verb)
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Heard.NO
        } finally {
            runCatching { source?.stop() }
            runCatching { spotter?.close() }
        }
    }

    /** Record until quiet after speech; a WAV of it, or null when nothing was said. */
    suspend fun request(quietMs: Long = 1_500, nothingMs: Long = 8_000, maxMs: Long = 20_000): ByteArray? =
        withContext(Dispatchers.IO) {
            val source = mic()
            if (!source.start()) return@withContext null
            val chunk = ShortArray(CHUNK)
            val kept = PcmKeeper((maxMs * 16).toInt())
            val end = SpeechEnd(quietMs, nothingMs, maxMs)
            var samples = 0L
            try {
                while (isActive) {
                    val n = source.read(chunk)
                    if (n <= 0) break
                    samples += n
                    kept.add(chunk, n)
                    if (end.feed(levelOf(chunk, n), samples / 16) != End.LISTEN) break
                }
                if (end.heardVoice) Wav.of(kept.all()) else null
            } finally {
                source.stop()
            }
        }
}
