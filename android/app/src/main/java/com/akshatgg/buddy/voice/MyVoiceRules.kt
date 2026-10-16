package com.akshatgg.buddy.voice

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** The voice-check model: its name, the file, where to get it, its SHA-256, its size and the size of a voice (shared/my-voice.js). */
data class SpeakerModelSpec(val name: String, val file: String, val url: String, val sha256: String, val bytes: Long, val dim: Int)

/** One step of the setup: "more" | "again" | "odd" | "done" | "failed", the takes kept so far, and the profile when done. */
data class SetupStep(val step: String, val count: Int, val profile: FloatArray? = null)

/** Where the wake phrase is in the audio kept, in samples: from (included) to (not included). */
data class Span(val from: Int, val to: Int)

/**
 * "Only my voice": the rules both apps decide with, a port of shared/my-voice.js (checked against my-voice-cases.json).
 * The sums are done in Double, as JavaScript does them, and only the answer is made a Float: so a score of exactly the
 * threshold is the same yes or no here as on the Mac.
 */
object MyVoiceRules {
    const val MATCH = 0.5f
    const val AGREE = 0.45f
    const val TAKES = 5
    const val EXTRA_TAKES = 3
    const val MIN_PHRASE_MS = 350
    const val MAX_PHRASE_MS = 3000
    const val PAD_MS = 100
    const val SETUP_MS = 90_000L
    const val CHECK_MS = 3_000L

    private const val RATE = 16_000

    // 0.45f is not 0.45: the shortest text of the float is the number the JavaScript writes.
    private fun Float.asDouble(): Double = toString().toDouble()

    private fun unitD(v: DoubleArray?): DoubleArray? {
        if (v == null || v.isEmpty()) return null
        var sum = 0.0
        for (x in v) { if (!x.isFinite()) return null; sum += x * x }
        val n = sqrt(sum)
        return if (n > 1e-6) DoubleArray(v.size) { v[it] / n } else null
    }

    private fun FloatArray.toD() = DoubleArray(size) { this[it].toDouble() }

    private fun cosineD(a: DoubleArray?, b: DoubleArray?): Double {
        val ua = unitD(a); val ub = unitD(b)
        if (ua == null || ub == null || ua.size != ub.size) return -1.0
        var dot = 0.0
        for (i in ua.indices) dot += ua[i] * ub[i]
        return dot
    }

    private fun meanUnitD(list: List<DoubleArray>): DoubleArray? {
        val us = list.map { unitD(it) }
        if (us.isEmpty() || us.any { it == null || it.size != us[0]!!.size }) return null
        val first = us[0]!!
        return unitD(DoubleArray(first.size) { k -> us.sumOf { it!![k] } / us.size })
    }

    private fun oddD(takes: List<DoubleArray>, agree: Double): List<Int> {
        if (takes.size < 2) return emptyList()
        return takes.indices.filter { i -> cosineD(takes[i], meanUnitD(takes.filterIndexed { j, _ -> j != i })) < agree }
    }

    /** The voice scaled to length 1, or null when it is empty, not a number, or silent. */
    fun unit(v: FloatArray?): FloatArray? = unitD(v?.toD())?.let { u -> FloatArray(u.size) { u[it].toFloat() } }

    /** How alike two voices are, -1 to 1; -1 when either can't be used. */
    fun cosine(a: FloatArray?, b: FloatArray?): Float = cosineD(a?.toD(), b?.toD()).toFloat()

    fun meanUnit(list: List<FloatArray>): FloatArray? = meanUnitD(list.map { it.toD() })?.let { u -> FloatArray(u.size) { u[it].toFloat() } }

    /** The takes that do not agree with the rest (indexes). */
    fun oddTakes(takes: List<FloatArray>, agree: Float = AGREE): List<Int> = oddD(takes.map { it.toD() }, agree.asDouble())

    fun isMe(profile: FloatArray?, embedding: FloatArray?, match: Float = MATCH): Boolean =
        cosineD(profile?.toD(), embedding?.toD()) >= match.asDouble()

    /** Where the phrase is in the audio since the recognizer began, padded; null when it is too short to check. */
    fun phraseSpan(startSec: Float, endSec: Float, rate: Int = RATE): Span? {
        val start = startSec.asDouble(); val end = endSec.asDouble()
        if (!start.isFinite() || !end.isFinite() || end <= start) return null
        if ((end - start) * 1000 < MIN_PHRASE_MS) return null
        val pad = PAD_MS / 1000.0
        val from = max(0, jsRound((start - pad) * rate))
        val to = min(jsRound((end + pad) * rate), from + jsRound(MAX_PHRASE_MS / 1000.0 * rate))
        return Span(from, to)
    }

    // JavaScript's Math.round: halves go up.
    private fun jsRound(x: Double): Int = Math.floor(x + 0.5).toInt()

    /** What setup asks for: "hey <name>" when the model can hear the name, else "hey buddy". */
    fun setupPhrase(name: String, missing: Set<String>): String = VoiceWords.wakePhrases(name, missing).first()

    /** The profile file's text. */
    fun profileJson(profile: FloatArray, modelSha: String, at: String): String =
        JsonObject(mapOf(
            "v" to JsonPrimitive(1), "model" to JsonPrimitive(modelSha), "dim" to JsonPrimitive(profile.size),
            "profile" to JsonArray(profile.map { JsonPrimitive(it) }), "at" to JsonPrimitive(at),
        )).toString()

    /** The saved profile, or null when it is not one this app can use (another model, another size, bad numbers). */
    fun readProfile(json: String?, model: SpeakerModelSpec): FloatArray? = runCatching {
        if (json.isNullOrBlank()) return null
        val o = Json.parseToJsonElement(json) as? JsonObject ?: return null
        if (o["v"]?.jsonPrimitive?.int != 1 || o["model"]?.jsonPrimitive?.content != model.sha256) return null
        if (o["dim"]?.jsonPrimitive?.int != model.dim) return null
        val list = o["profile"]?.jsonArray ?: return null
        if (list.size != model.dim) return null
        val numbers = list.map { (it as? JsonPrimitive)?.takeIf { p -> !p.isString }?.doubleOrNull ?: return null }
        if (numbers.any { !it.isFinite() } || unitD(numbers.toDoubleArray()) == null) return null
        FloatArray(numbers.size) { numbers[it].toFloat() }
    }.getOrNull()

    /** The words of the Only my voice setting (MY_VOICE_LINES in shared/my-voice.js). */
    object Lines {
        const val LABEL = "Only my voice"
        const val ABOUT = "Buddy answers only you. Your voice stays on this device."
        const val GETTING_MODEL = "Getting the voice check ready (28 MB)…"
        const val MODEL_FAILED = "Couldn't get the voice check ready. Check the internet and try again."
        const val DONE = "Done. Buddy now answers only your voice."
        const val FAILED = "I couldn't learn your voice. Try again somewhere quiet."
        const val TIMED_OUT = "I didn't hear you. Try again."
        const val ON = "On. Buddy answers only you."
        const val SET_UP_AGAIN = "Set up Only my voice again."
        const val NOT_YOU = "That didn't sound like you."
        const val REDO = "Set up again"
        fun start(name: String) = "Say \"Hey $name\" $TAKES times. Wait for the tick each time."
        fun got(count: Int) = "Got it ✓ $count of $TAKES"
        fun again(name: String) = "I didn't get that. Say \"Hey $name\" again."
        fun odd(name: String) = "That one sounded different. Say \"Hey $name\" again."
    }
}

/**
 * The setup's steps. `add(embedding)` for each take the wake loop heard (null for one that was too short or could not be
 * checked): "again" (refused, ask again; it does not count), "more" (kept), "odd" (after the fifth: some takes did not
 * agree with the rest; they are dropped and asked again), "done" (with the profile) or "failed". Once done or failed, it stays so.
 */
class Setup(private val takes: Int = MyVoiceRules.TAKES, private val extraTakes: Int = MyVoiceRules.EXTRA_TAKES, private val agree: Float = MyVoiceRules.AGREE) {
    private var good = mutableListOf<FloatArray>()
    private var extra = 0
    private var over: SetupStep? = null

    fun add(embedding: FloatArray?): SetupStep {
        over?.let { return it }
        val u = MyVoiceRules.unit(embedding) ?: return SetupStep("again", good.size)
        good.add(u)
        if (good.size < takes) return SetupStep("more", good.size)
        val odd = MyVoiceRules.oddTakes(good, agree)
        if (odd.isEmpty()) return SetupStep("done", takes, MyVoiceRules.meanUnit(good)).also { over = it }
        extra += odd.size
        good = good.filterIndexed { i, _ -> i !in odd }.toMutableList()
        if (extra > extraTakes) return SetupStep("failed", good.size).also { over = it }
        return SetupStep("odd", good.size)
    }
}
