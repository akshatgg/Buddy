package com.akshatgg.buddy.ai.providers

import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.core.Shared
import com.akshatgg.buddy.net.Http

/** The four AIs, by id. */
class Providers(private val shared: Shared, http: Http) {
    private fun facts(id: String) = shared.providers.first { it.id == id }

    private val all: Map<String, Provider> = linkedMapOf(
        "anthropic" to Anthropic(facts("anthropic"), http),
        "openai" to OpenAICompatible(
            facts("openai"), "OpenAI", http, "https://api.openai.com/v1",
            vision = { Regex("^(gpt-4o|gpt-4\\.1|gpt-5|o1(?!-mini)|o3(?!-mini)|o4|chatgpt-4o)").containsMatchIn(it) },
            isChatModel = {
                Regex("^(gpt-|o\\d|chatgpt-)").containsMatchIn(it) &&
                    !Regex("(embedding|tts|whisper|transcribe|audio|realtime|image|dall-e|moderation|search|instruct|codex)").containsMatchIn(it)
            },
            // Reasoning models spend max_completion_tokens on thinking first; keep that short.
            reasoningEffort = { if (Regex("^(gpt-5|o\\d)").containsMatchIn(it)) "low" else null },
        ),
        "gemini" to Gemini(facts("gemini"), http),
        "groq" to OpenAICompatible(
            facts("groq"), "Groq", http, "https://api.groq.com/openai/v1",
            vision = { Regex("llama-4|vision", RegexOption.IGNORE_CASE).containsMatchIn(it) },
            isChatModel = { !Regex("(whisper|tts|guard|playai|orpheus|compound|distil)", RegexOption.IGNORE_CASE).containsMatchIn(it) },
            reasoningEffort = { null },
        ),
    )

    val ids: List<String> = all.keys.toList()

    fun get(id: String): Provider = all[id] ?: throw BuddyError("bad_request", "Unknown provider: $id")

    /**
     * The id of the provider a key belongs to, going by how the key starts; null when it starts like none of
     * them, or is not text. The longest matching start wins, so "sk-ant-..." is Claude's and any other
     * "sk-..." is OpenAI's, whichever of the two is listed first.
     */
    fun forKey(key: String?): String? {
        if (key == null) return null
        var owner: String? = null
        var longest = 0
        for (id in ids) {
            for (prefix in all.getValue(id).facts.keyPrefixes) {
                if (prefix.length > longest && key.startsWith(prefix)) {
                    owner = id
                    longest = prefix.length
                }
            }
        }
        return owner
    }
}
