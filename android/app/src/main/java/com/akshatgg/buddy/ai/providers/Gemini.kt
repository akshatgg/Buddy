package com.akshatgg.buddy.ai.providers

import com.akshatgg.buddy.ai.Prompt
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.net.Http
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.net.URLEncoder

class Gemini(override val facts: ProviderFacts, private val http: Http) : Provider {
    override val shortLabel = "Gemini"

    private fun headers(apiKey: String) = mapOf("x-goog-api-key" to apiKey)

    override fun isVisionModel(model: String) = Regex("^gemini").containsMatchIn(model)

    private fun JsonObject.str(name: String): String? = (this[name] as? JsonPrimitive)?.contentOrNull
    private fun JsonObject.arr(name: String): JsonArray = (this[name] as? JsonArray) ?: JsonArray(emptyList())

    override suspend fun complete(apiKey: String, model: String, prompt: Prompt, maxTokens: Int): Completion {
        val parts = buildJsonArray {
            add(buildJsonObject { put("text", prompt.user) })
            if (prompt.image != null) {
                add(buildJsonObject {
                    put("inline_data", buildJsonObject { put("mime_type", "image/jpeg"); put("data", prompt.image) })
                })
            }
        }
        val j = ProviderHttp.requestJson(
            http, shortLabel, "$BASE/models/${URLEncoder.encode(model, "UTF-8").replace("+", "%20")}:generateContent", "POST", headers(apiKey),
            buildJsonObject {
                put("systemInstruction", buildJsonObject { put("parts", buildJsonArray { add(buildJsonObject { put("text", prompt.system) }) }) })
                put("contents", buildJsonArray { add(buildJsonObject { put("role", "user"); put("parts", parts) }) })
                put("generationConfig", buildJsonObject { put("maxOutputTokens", maxTokens * THINKING_ROOM) })
            },
        )
        if (!(j["promptFeedback"] as? JsonObject)?.str("blockReason").isNullOrEmpty()) {
            throw BuddyError("empty", "$shortLabel blocked this request.")
        }
        val candidate = j.arr("candidates").firstOrNull() as? JsonObject
        val text = ((candidate?.get("content") as? JsonObject)?.arr("parts") ?: JsonArray(emptyList()))
            .mapNotNull { it as? JsonObject }
            .filter { (it["thought"] as? JsonPrimitive)?.booleanOrNull != true }
            .joinToString("") { it.str("text") ?: "" }
            .trim()
        if (text.isEmpty()) throw BuddyError("empty", "$shortLabel returned no text. Try again, or pick another model in Settings.")
        return Completion(text, j.str("modelVersion")?.takeIf { it.isNotEmpty() } ?: model)
    }

    override suspend fun listModels(apiKey: String): List<String> {
        val j = ProviderHttp.requestJson(http, shortLabel, "$BASE/models?pageSize=1000", headers = headers(apiKey))
        return j.arr("models")
            .mapNotNull { it as? JsonObject }
            .filter { m -> m.arr("supportedGenerationMethods").any { (it as? JsonPrimitive)?.contentOrNull == "generateContent" } }
            .map { (it.str("name") ?: "null").replace(Regex("^models/"), "") }
            .filter { Regex("^gemini").containsMatchIn(it) && !SKIPPED.containsMatchIn(it) }
            .sortedWith(NaturalOrder.reversed())
    }

    private companion object {
        const val BASE = "https://generativelanguage.googleapis.com/v1beta"

        // Thinking models spend part of maxOutputTokens on thoughts before the answer;
        // without this room a short cap can come back with no answer at all.
        const val THINKING_ROOM = 4
        val SKIPPED = Regex("(embedding|aqa|image|tts|live|audio|robotics|computer-use)")
    }
}
