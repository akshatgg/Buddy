package com.akshatgg.buddy.ai

import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.core.Shared
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

enum class Action(val id: String) { WRITE("write"), FIX("fix"), CHECK("check") }

data class AskInput(val instruction: String? = null, val tone: String? = null, val text: String? = null, val image: String? = null)

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
            Action.CHECK -> {
                val image = input.image.orEmpty()
                if (image.isEmpty()) throw BuddyError("bad_request", m.getValue("checkEmpty"))
                if (image.length > shared.limitImageChars) throw BuddyError("bad_request", m.getValue("checkTooBig"))
                val question = input.instruction?.trim()?.take(shared.limitInstruction).orEmpty()
                Prompt(shared.checkSystem, if (question.isNotEmpty()) shared.checkQuestionPrefix + question else shared.checkDefaultQuestion, image)
            }
        }
    }

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
