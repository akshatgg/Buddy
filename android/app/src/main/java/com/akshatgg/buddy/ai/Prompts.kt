package com.akshatgg.buddy.ai

import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.core.Shared
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

enum class Action(val id: String) { WRITE("write"), FIX("fix"), CHECK("check"), CHAT("chat") }

/** One message of the chat so far: `from` is "you" or "buddy". */
data class ChatTurn(val from: String, val text: String)

/**
 * What an action is asked with. write, fix and check use the first four; a chat (shared/prompts.js chatPrompt) uses
 * `message` and the rest, and `image` on its second step. Android never sends the desktop's `projects`.
 */
data class AskInput(
    val instruction: String? = null,
    val tone: String? = null,
    val text: String? = null,
    val image: String? = null,
    val message: String? = null,
    val selection: String? = null,
    val box: String? = null,
    val history: List<ChatTurn>? = null,
    val facts: List<String>? = null,
    val appName: String? = null,
    val userName: String? = null,
    val step: Int? = null,
)

/** A chat answer as parseChat reads it (shared/prompts.js): never null, whatever the AI wrote. */
data class ChatReply(
    val kind: String,
    val say: String,
    val text: String,
    val notes: List<String>,
    val doIt: Boolean,
    val send: Boolean,
    val remember: List<String>,
    val again: Boolean,
)

data class Prompt(val system: String, val user: String, val image: String?)

sealed interface CheckResult {
    data class Verdict(val good: Boolean, val problems: List<String>, val corrected: String?) : CheckResult
    data class Raw(val text: String) : CheckResult
}

/**
 * The prompts behind Buddy's three actions, from shared.json (made from shared/prompts.js), so the phone asks exactly
 * what the Mac and the server ask.
 */
class Prompts(private val shared: Shared) {
    /** The longest answer asked of an AI, in tokens (MAX_TOKENS in shared/prompts.js). */
    val maxTokens: Int get() = shared.maxTokens

    private fun requireText(value: String?, max: Int, emptyMessage: String, tooLong: String): String {
        val text = value?.trim().orEmpty()
        if (text.isEmpty()) throw BuddyError("bad_request", emptyMessage)
        if (text.length > max) throw BuddyError("bad_request", tooLong)
        return text
    }

    fun build(action: Action, input: AskInput): Prompt {
        val m = shared.messages
        return when (action) {
            Action.WRITE -> {
                val instruction = requireText(input.instruction, shared.limitInstruction, m.getValue("writeEmpty"), m.getValue("tooLongInstruction"))
                val tone = if (input.tone in shared.tones) input.tone!! else shared.defaultTone
                Prompt(shared.writeSystem.getValue(tone), instruction, null)
            }
            Action.FIX -> Prompt(shared.fixSystem, requireText(input.text, shared.limitText, m.getValue("fixEmpty"), m.getValue("tooLongText")), null)
            Action.CHAT -> chatPrompt(shared, input)
            Action.CHECK -> {
                val image = input.image.orEmpty()
                if (image.isEmpty()) throw BuddyError("bad_request", m.getValue("checkEmpty"))
                if (image.length > shared.limitImageChars) throw BuddyError("bad_request", m.getValue("checkTooBig"))
                val question = input.instruction?.trim()?.take(shared.limitInstruction).orEmpty()
                Prompt(shared.checkSystem, if (question.isNotEmpty()) shared.checkQuestionPrefix + question else shared.checkDefaultQuestion, image)
            }
        }
    }

    /** Read a chat answer as shared/prompts.js parseChat does. */
    fun parseChat(text: String?): ChatReply = readChat(shared, text)

    companion object {
        private val FENCE_START = Regex("^```(?:json)?\\s*", RegexOption.IGNORE_CASE)
        private val FENCE_END = Regex("\\s*```$")

        /** Read the Check-screen answer: its verdict, or the model's own text when it did not answer in the JSON shape. */
        fun parseCheck(text: String?): CheckResult {
            val raw = text.orEmpty().trim()
            val cleaned = raw.replace(FENCE_START, "").replace(FENCE_END, "")
            val j = runCatching { Json.parseToJsonElement(cleaned) as? JsonObject }.getOrNull() ?: return CheckResult.Raw(raw)
            val verdict = (j["verdict"] as? JsonPrimitive)?.takeIf { it.isString }?.content
            val problems = runCatching { j["problems"]?.jsonArray }.getOrNull()
            if ((verdict != "good" && verdict != "problems") || problems == null) return CheckResult.Raw(raw)
            val corrected = (j["corrected"] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull?.takeIf { it.isNotBlank() }
            return CheckResult.Verdict(
                good = verdict == "good",
                problems = problems.mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content }.take(5),
                corrected = corrected,
            )
        }
    }
}
