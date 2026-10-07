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

/**
 * OpenAI's Chat Completions shape, which Groq speaks too. One class, two
 * providers: they differ in base URL, labels, how their keys begin, which
 * models can see images, and whether "thinking" models need to be told to keep
 * it short.
 */
class OpenAICompatible(
    override val facts: ProviderFacts,
    override val shortLabel: String,
    private val http: Http,
    private val baseUrl: String,
    private val vision: (String) -> Boolean,
    private val isChatModel: (String) -> Boolean,
    private val reasoningEffort: (String) -> String?,
) : Provider {
    override fun isVisionModel(model: String) = vision(model)

    override suspend fun complete(apiKey: String, model: String, prompt: Prompt, maxTokens: Int): Completion {
        val content = if (prompt.image != null) {
            buildJsonArray {
                add(buildJsonObject { put("type", "text"); put("text", prompt.user) })
                add(buildJsonObject {
                    put("type", "image_url")
                    put("image_url", buildJsonObject { put("url", "data:image/jpeg;base64,${prompt.image}") })
                })
            }
        } else {
            JsonPrimitive(prompt.user)
        }
        val effort = reasoningEffort(model)
        val j = ProviderHttp.requestJson(
            http, shortLabel, "$baseUrl/chat/completions", "POST", mapOf("Authorization" to "Bearer $apiKey"),
            buildJsonObject {
                put("model", model)
                put("max_completion_tokens", maxTokens)
                put("messages", buildJsonArray {
                    add(buildJsonObject { put("role", "system"); put("content", prompt.system) })
                    add(buildJsonObject { put("role", "user"); put("content", content) })
                })
                if (effort != null) put("reasoning_effort", effort)
            },
        )
        val message = ((j["choices"] as? JsonArray)?.firstOrNull() as? JsonObject)?.get("message") as? JsonObject
        val text = ((message?.get("content") as? JsonPrimitive)?.contentOrNull ?: "").trim()
        if (text.isEmpty()) {
            throw BuddyError("empty", "$shortLabel returned no text. If this is a \"thinking\" model, pick a simpler one in Settings.")
        }
        return Completion(text, (j["model"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() } ?: model)
    }

    override suspend fun listModels(apiKey: String): List<String> {
        val j = ProviderHttp.requestJson(http, shortLabel, "$baseUrl/models", headers = mapOf("Authorization" to "Bearer $apiKey"))
        return ((j["data"] as? JsonArray) ?: JsonArray(emptyList()))
            .mapNotNull { val id = (it as? JsonObject)?.get("id") as? JsonPrimitive; if (id?.isString == true) id.content else null }
            .filter(isChatModel)
            .sortedWith(NaturalOrder.reversed())
    }
}
