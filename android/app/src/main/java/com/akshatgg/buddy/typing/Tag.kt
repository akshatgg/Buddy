package com.akshatgg.buddy.typing

import com.akshatgg.buddy.ai.JS_SPACES
import com.akshatgg.buddy.ai.jsTrim
import com.akshatgg.buddy.ai.jsTrimEnd

/** The last tag in a text: from its "@" to the end of its line, and what came after it on that line ('' for none). */
data class TagAt(val start: Int, val end: Int, val instruction: String)

/** A text cut around its last tag, so that prefix + the new text + suffix is what goes back. */
data class TagSplit(val prefix: String, val target: String, val instruction: String, val suffix: String)

/**
 * Buddy where you type: the person writes in any app and ends with a tag, "@buddy" (or their buddy's own name, "@aarav")
 * and what to do: "@buddy fix", "@buddy formal", "@buddy translate to Hindi", or the tag alone (fix). These are the
 * plain rules of shared/tag.js in Kotlin, the same as on the Mac and on Windows; TagTest checks them case by case.
 * JavaScript's own ways are kept where Kotlin's differ: its trim, its `$` (the very end), and its ASCII `\b`.
 */
object Tag {
    const val INSTRUCTION_MAX = 200
    val DEFAULT_NAMES = listOf("buddy")

    private val NAME = Regex("[\\p{L}\\p{N}_]{2,24}")
    private val ALL = Regex("^all(?![A-Za-z0-9_])", RegexOption.IGNORE_CASE)
    private val ALL_WORD = Regex("^all(?![A-Za-z0-9_])[$JS_SPACES,:-]*", RegexOption.IGNORE_CASE)
    private val FENCED = Regex("^```[^\\n]*\\n([\\s\\S]*?)\\n```\\z")
    private const val OPEN_QUOTES = "\"“"
    private const val CLOSE_QUOTES = "\"”"
    private const val ANY_QUOTE = "\"“”"

    /** The tag's names, as the person may type them: "buddy", and their buddy's name if it is one word of letters. */
    fun tagNames(buddyName: String?): List<String> {
        val name = jsTrim(buddyName.orEmpty()).lowercase()
        return if (NAME.matches(name) && name != "buddy") listOf("buddy", name) else DEFAULT_NAMES
    }

    // The pattern for the last names asked about: the same ones on every keystroke, so it is made once.
    @Volatile
    private var lastPattern: Pair<List<String>, Regex>? = null

    private fun pattern(names: List<String>): Regex {
        lastPattern?.let { (n, p) -> if (n == names) return p }
        val p = Regex(
            "(^|[^\\p{L}\\p{N}_@])@(${names.joinToString("|") { Regex.escape(it) }})(?![\\p{L}\\p{N}_])[ \\t]*([^\\n]*)",
            RegexOption.IGNORE_CASE,
        )
        lastPattern = names.toList() to p
        return p
    }

    /** The last tag in `text`, where end is the end of its line; null when there is none. */
    fun findTag(text: CharSequence?, names: List<String> = DEFAULT_NAMES): TagAt? {
        if (text.isNullOrEmpty() || names.isEmpty()) return null
        val found = pattern(names).findAll(text).lastOrNull() ?: return null
        val start = found.range.first + found.groupValues[1].length
        return TagAt(start, found.range.last + 1, jsTrim(found.groupValues[3]).take(INSTRUCTION_MAX))
    }

    /**
     * The text cut around its last tag: `target` is what gets rewritten (the paragraph the tag ends, or with "all"
     * everything before it), `prefix` and `suffix` stay as they are. Null when there is no tag, or nothing before it to
     * rewrite.
     */
    fun splitAtTag(text: String?, names: List<String> = DEFAULT_NAMES): TagSplit? {
        val tag = findTag(text, names) ?: return null
        val whole = text!!
        val before = whole.substring(0, tag.start)
        val all = ALL.containsMatchIn(tag.instruction)
        val from = if (all) 0 else before.lastIndexOf('\n') + 1
        val target = jsTrimEnd(before.substring(from))
        if (jsTrim(target).isEmpty()) return null
        val instruction = if (all) tag.instruction.replaceFirst(ALL_WORD, "") else tag.instruction
        // What came after the tag's line stays; the space the tag left at the end of the paragraph goes.
        return TagSplit(whole.substring(0, from), target, instruction, whole.substring(tag.end))
    }

    /** The AI's answer as the text that goes back: trimmed, without a code fence or quotes around the whole of it. */
    fun cleanAnswer(answer: String?): String {
        var text = jsTrim(answer.orEmpty())
        FENCED.find(text)?.let { text = jsTrim(it.groupValues[1]) }
        if (text.length > 1 && text.first() in OPEN_QUOTES && text.last() in CLOSE_QUOTES &&
            text.substring(1, text.length - 1).none { it in ANY_QUOTE }
        ) {
            text = jsTrim(text.substring(1, text.length - 1))
        }
        return text
    }
}
