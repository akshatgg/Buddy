package com.akshatgg.buddy.ai

import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.core.Shared
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

// The chat request, shared/prompts.js chatPrompt and parseChat in Kotlin. The system prompt, the kinds, the limits and
// the refusals come from shared.json; the user turn's labels are written here, and ChatPromptTest checks the whole
// turn against what the JavaScript builds (chat-cases.json, made by tools/sync-android-shared.js).

// JavaScript's \s and trim(): a few more spaces than Kotlin's own trim knows (U+FEFF), and none of its control ones.
private const val JS_SPACES = "\t\n\u000B\u000C\r                  　﻿"
private val JS_SPACE_RUN = Regex("[$JS_SPACES]+")

internal fun jsTrim(text: String): String = text.trim { it in JS_SPACES }

/** A name or a fact on one line (runs of spaces become one space), cut to `max` characters. */
internal fun oneLine(value: String?, max: Int): String = value?.let { jsTrim(jsTrim(it.replace(JS_SPACE_RUN, " ")).take(max)) }.orEmpty()

private fun quoted(text: String) = "\"\"\"\n$text\n\"\"\""

/** The chat's user turn: what is known about the person and the chat, what they gave, then their message last. */
internal fun chatPrompt(shared: Shared, input: AskInput): Prompt {
    val m = shared.chatMessages
    val limits = shared.chatLimits
    val message = jsTrim(input.message.orEmpty())
    if (message.isEmpty()) throw BuddyError("bad_request", m.getValue("empty"))
    if (message.length > shared.limitInstruction) throw BuddyError("bad_request", m.getValue("tooLongMessage"))
    fun optional(value: String?): String {
        val text = jsTrim(value.orEmpty())
        if (text.length > shared.limitText) throw BuddyError("bad_request", m.getValue("tooLongText"))
        return text
    }
    val selection = optional(input.selection)
    val box = optional(input.box)
    val image = input.image.orEmpty()
    if (image.length > shared.limitImageChars) throw BuddyError("bad_request", m.getValue("imageTooBig"))
    // A box or a screenshot comes only with a second step: a first step may be given back on Buddy's server.
    if ((box.isNotEmpty() || image.isNotEmpty()) && input.step != 2) throw BuddyError("bad_request", m.getValue("secondStepOnly"))
    val appName = oneLine(input.appName, limits.nameChars)
    val userName = oneLine(input.userName, limits.nameChars)
    val history = input.history.orEmpty()
        .filter { (it.from == "you" || it.from == "buddy") && jsTrim(it.text).isNotEmpty() }
        .takeLast(limits.history)
        .map { "${if (it.from == "you") "Them" else "Buddy"}: ${jsTrim(it.text).take(limits.historyChars)}" }
    val facts = input.facts.orEmpty().map { oneLine(it, limits.factChars) }.filter { it.isNotEmpty() }.takeLast(limits.facts)

    val parts = mutableListOf<String>()
    val who = listOfNotNull(appName.ifEmpty { null }?.let { "The app they are in: $it" }, userName.ifEmpty { null }?.let { "Their first name: $it" })
    if (who.isNotEmpty()) parts += who.joinToString("\n")
    if (facts.isNotEmpty()) parts += "What you know about them:\n" + facts.joinToString("\n") { "- $it" }
    if (history.isNotEmpty()) parts += "Chat so far (oldest first):\n" + history.joinToString("\n")
    if (selection.isNotEmpty()) parts += "Selected text:\n${quoted(selection)}"
    if (box.isNotEmpty()) parts += "Their text box:\n${quoted(box)}"
    if (image.isNotEmpty()) parts += "A screenshot of the app they are in comes with this message."
    if (input.step == 2) parts += "This is the second step: you already have what you asked for, so do not answer \"box\" or \"screen\"."
    parts += "Their message:\n${quoted(message)}"
    return Prompt(shared.chatSystem, parts.joinToString("\n\n"), image.ifEmpty { null })
}

private val FENCE_START = Regex("^```(?:json)?[$JS_SPACES]*", RegexOption.IGNORE_CASE)
private val FENCE_END = Regex("[$JS_SPACES]*```\\z")
private val RAW_BREAKS = mapOf('\n' to "\\n", '\r' to "\\r", '\t' to "\\t")

/** `json` with the line breaks inside its strings written the way JSON wants them. */
private fun escapeRawBreaks(json: String): String {
    val out = StringBuilder()
    var inString = false
    var escaped = false
    for (ch in json) {
        if (!inString) {
            inString = ch == '"'
        } else if (escaped) {
            escaped = false
        } else if (ch == '\\') {
            escaped = true
        } else if (ch == '"') {
            inString = false
        } else if (ch in RAW_BREAKS) {
            out.append(RAW_BREAKS.getValue(ch))
            continue
        }
        out.append(ch)
    }
    return out.toString()
}

private fun parse(text: String): JsonElement? = try {
    Json.parseToJsonElement(text)
} catch (e: Exception) {
    null
}

/** The JSON in a model's answer, or null: fences stripped, else the part from the first { to the last }, mended. */
private fun readJson(raw: String): JsonElement? {
    val cleaned = raw.replaceFirst(FENCE_START, "").replaceFirst(FENCE_END, "")
    parse(cleaned)?.let { return it }
    val start = cleaned.indexOf('{')
    val end = cleaned.lastIndexOf('}')
    if (start == -1 || end < start) return null
    return parse(escapeRawBreaks(cleaned.substring(start, end + 1)))
}

private fun JsonObject.string(name: String): String = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content?.let(::jsTrim).orEmpty()

private fun JsonObject.isTrue(name: String): Boolean = (this[name] as? JsonPrimitive)?.let { !it.isString && it.content == "true" } == true

private fun JsonObject.texts(name: String, max: Int, maxChars: Int = Int.MAX_VALUE): List<String> =
    ((this[name] as? JsonArray) ?: JsonArray(emptyList()))
        .map { (it as? JsonPrimitive)?.takeIf { p -> p.isString }?.content?.let(::jsTrim).orEmpty() }
        .filter { it.isNotEmpty() && it.length <= maxChars }
        .take(max)

/** parseChat: never throws. Not JSON, or a kind it does not know: a written answer with the model's whole text. */
internal fun readChat(shared: Shared, text: String?): ChatReply {
    val raw = jsTrim(text.orEmpty())
    val j = readJson(raw) as? JsonObject
    val kind = (j?.get("kind") as? JsonPrimitive)?.takeIf { it.isString }?.content
    if (j == null || kind == null || kind !in shared.chatKinds) return ChatReply("write", "", raw, emptyList(), false, false, emptyList(), false)
    val limits = shared.chatLimits
    val out = ChatReply(
        kind = kind,
        say = j.string("say"),
        text = j.string("text"),
        notes = j.texts("notes", limits.notes),
        doIt = j.isTrue("doIt"),
        send = j.isTrue("send"),
        remember = j.texts("remember", limits.remember, limits.rememberChars),
        again = (kind == "write" || kind == "fix") && j.isTrue("again"),
    )
    // A job for Claude Code (the desktop's): never put in an app, sent, or with notes.
    if (kind == "code") return out.copy(notes = emptyList(), doIt = false, send = false, again = false)
    // An answer given only as `say` is shown as the answer.
    if (kind == "answer" && out.text.isEmpty()) return out.copy(say = "", text = out.say)
    return out
}
