package com.akshatgg.buddy.ai.providers

import com.akshatgg.buddy.ai.Prompt
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.net.Http
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

class Anthropic(override val facts: ProviderFacts, private val http: Http) : Provider {
    override val shortLabel = "Claude"

    private fun headers(apiKey: String) = mapOf("x-api-key" to apiKey, "anthropic-version" to "2023-06-01")

    override fun isVisionModel(model: String) = true

    override suspend fun complete(apiKey: String, model: String, prompt: Prompt, maxTokens: Int): Completion {
        val content = if (prompt.image != null) {
            buildJsonArray {
                add(buildJsonObject {
                    put("type", "image")
                    put("source", buildJsonObject {
                        put("type", "base64")
                        put("media_type", "image/jpeg")
                        put("data", prompt.image)
                    })
                })
                add(buildJsonObject { put("type", "text"); put("text", prompt.user) })
            }
        } else {
            JsonPrimitive(prompt.user)
        }
        val j = ProviderHttp.requestJson(
            http, shortLabel, "$BASE/messages", "POST", headers(apiKey),
            buildJsonObject {
                put("model", model)
                put("max_tokens", maxTokens)
                put("system", prompt.system)
                put("messages", buildJsonArray { add(buildJsonObject { put("role", "user"); put("content", content) }) })
            },
        )
        val text = ((j["content"] as? JsonArray) ?: JsonArray(emptyList()))
            .mapNotNull { it as? JsonObject }
            .filter { (it["type"] as? JsonPrimitive)?.contentOrNull == "text" }
            .joinToString("") { (it["text"] as? JsonPrimitive)?.contentOrNull ?: "" }
            .trim()
        if (text.isEmpty()) throw BuddyError("empty", "$shortLabel returned no text. Try again.")
        return Completion(text, (j["model"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() } ?: model)
    }

    override suspend fun listModels(apiKey: String): List<String> {
        val j = ProviderHttp.requestJson(http, shortLabel, "$BASE/models?limit=100", headers = headers(apiKey))
        return ((j["data"] as? JsonArray) ?: JsonArray(emptyList()))
            .mapNotNull { ((it as? JsonObject)?.get("id") as? JsonPrimitive)?.contentOrNull }
            .filter { it.isNotEmpty() }
    }

    private companion object {
        const val BASE = "https://api.anthropic.com/v1"
    }
}
