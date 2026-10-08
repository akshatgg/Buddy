package com.akshatgg.buddy.ai.providers

import com.akshatgg.buddy.ai.Prompt

/** What is the same for a provider on every platform (from shared.json): its name, where to get a key, how a key starts. */
data class ProviderFacts(
    val id: String,
    val label: String,
    val keyUrl: String,
    val keyPrefixes: List<String>,
    val fallbackModels: List<String>,
)

data class Completion(val text: String, val model: String)

/** One AI service. `shortLabel` is the name used in messages ("Claude"); `facts.label` is the long one for Settings. */
interface Provider {
    val facts: ProviderFacts
    val shortLabel: String
    fun isVisionModel(model: String): Boolean
    suspend fun complete(apiKey: String, model: String, prompt: Prompt, maxTokens: Int): Completion
    suspend fun listModels(apiKey: String): List<String>
}
