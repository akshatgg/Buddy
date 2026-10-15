package com.akshatgg.buddy.voice

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.floatOrNull
import kotlinx.serialization.json.jsonObject
import org.vosk.Model
import org.vosk.Recognizer

data class VoskWord(val word: String, val conf: Float, val start: Float, val end: Float)
data class VoskSaid(val text: String, val words: List<VoskWord>)

/** Vosk's JSON: `{"text": …, "result": [{word, conf, start, end}]}` or `{"partial": …}`. Bad JSON is nothing said. */
fun parseVosk(json: String): VoskSaid = try {
    val o = Json.parseToJsonElement(json).jsonObject
    fun str(k: String) = (o[k] as? JsonPrimitive)?.contentOrNull
    val words = (o["result"] as? JsonArray)?.mapNotNull { e ->
        val w = e as? JsonObject ?: return@mapNotNull null
        fun num(k: String) = (w[k] as? JsonPrimitive)?.floatOrNull ?: 0f
        VoskWord((w["word"] as? JsonPrimitive)?.contentOrNull ?: "", num("conf"), num("start"), num("end"))
    } ?: emptyList()
    VoskSaid((str("text") ?: str("partial") ?: "").trim(), words)
} catch (_: Exception) {
    VoskSaid("", emptyList())
}

/** One recognizer over a short list of phrases. */
interface Spotter {
    /** Feed `n` samples; a final result's JSON when Vosk ended an utterance, else null. */
    fun accept(pcm: ShortArray, n: Int): String?
    fun finish(): String
    fun close()
}

fun interface Spotters { fun make(grammar: List<String>): Spotter }

/** A loaded model that makes a recognizer for each question, and is let go of when it is replaced. */
interface LoadedSpotters : Spotters {
    fun close()
}

/**
 * The model is loaded ONCE for the whole process and reused by every question (a Vosk model is tens of MB of native
 * memory; loading one for each question, never freed, runs the phone out of it). `ready()` says the model's folder is
 * there; `generation()` changes when that folder is replaced, which closes the old model and loads the new one on the next
 * use. `warm()` loads it ahead (when the question starts being spoken), so that the first "yes" is not lost to the load.
 */
class SharedSpotters(
    private val ready: () -> Boolean,
    private val generation: () -> Int,
    private val load: () -> LoadedSpotters,
) {
    private var loaded: LoadedSpotters? = null
    private var loadedGeneration = 0

    /** The model's spotters, loaded if they are not yet; null while the model is not ready. A failed load is tried again next time. */
    @Synchronized fun get(): Spotters? {
        if (!ready()) return null
        val now = generation()
        loaded?.let { if (loadedGeneration == now) return it }
        loaded?.let { runCatching { it.close() } }
        loaded = null
        return load().also { loaded = it; loadedGeneration = now }
    }

    /** Loads the model now if it is there; a failure is left for the question to find. */
    fun warm() { runCatching { get() } }
}

/** Vosk on the device: the model loaded from its folder, a recognizer made for each question. */
class VoskSpotters(folder: java.io.File) : LoadedSpotters {
    private val vosk = Model(folder.absolutePath)

    override fun make(grammar: List<String>): Spotter {
        val json = Json.encodeToString(kotlinx.serialization.builtins.ListSerializer(kotlinx.serialization.serializer<String>()), grammar)
        val recognizer = Recognizer(vosk, Wav.RATE.toFloat(), json).apply { setWords(true) }
        return object : Spotter {
            override fun accept(pcm: ShortArray, n: Int): String? =
                if (recognizer.acceptWaveForm(pcm, n)) recognizer.result else null
            override fun finish(): String = recognizer.finalResult
            override fun close() { recognizer.close() }
        }
    }

    override fun close() { vosk.close() }
}
