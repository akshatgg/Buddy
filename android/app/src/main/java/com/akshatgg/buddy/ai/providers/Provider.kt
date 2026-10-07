package com.akshatgg.buddy.ai.providers

/** What is the same for a provider on every platform (from shared.json): its name, where to get a key, how a key starts. */
data class ProviderFacts(
    val id: String,
    val label: String,
    val keyUrl: String,
    val keyPrefixes: List<String>,
    val fallbackModels: List<String>,
)
