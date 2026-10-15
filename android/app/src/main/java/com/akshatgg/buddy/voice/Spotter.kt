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

/** Vosk on the device: the model is loaded once, a recognizer is made for each question. */
class VoskSpotters(private val model: VoiceModel) : Spotters {
    private val vosk: Model by lazy { Model(model.folder().absolutePath) }

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
}
