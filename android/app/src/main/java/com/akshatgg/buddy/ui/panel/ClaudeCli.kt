package com.akshatgg.buddy.ui.panel

import com.akshatgg.buddy.cloud.RemoteItem
import kotlin.math.abs
import kotlin.math.max

/**
 * Claude mode drawn as the Claude Code terminal draws a session, as the Mac panel's (src/renderer/panel/claude-cli.js).
 * The session's items come as the computer sends them ({ id, kind: you | claude | tool | result | event, text }), a
 * tool's text being the computer's short line ("$ npm test", "Edit src/main.js", …). This turns them into the
 * terminal's rows, and Claude's markdown into the terminal's blocks: tables drawn with box lines, lists, headings,
 * code. Plain Kotlin, tested on the JVM; ClaudeView draws what it says.
 */
sealed interface CliRow {
    val id: Int

    /** ❯ what the person typed, on a grey bar. */
    data class You(override val id: Int, val text: String) : CliRow

    /** ● Claude's reply, its markdown as blocks. */
    data class Reply(override val id: Int, val text: String) : CliRow

    /** ● Update(src/main.js), and its results under ⎿. */
    data class Tool(override val id: Int, val name: String, val arg: String, val results: List<Result>, val error: Boolean) : CliRow

    /** "Ran 3 shell commands, read 2 files": the quiet tools in a row, folded until tapped. */
    data class Summary(override val id: Int, val text: String, val tools: List<Tool>, val error: Boolean) : CliRow

    /** ⎿ Interrupted by user, and anything else. */
    data class Event(override val id: Int, val text: String, val error: Boolean) : CliRow

    data class Result(val text: String, val error: Boolean)
}

/** One block of Claude's markdown, as the terminal shows it. */
sealed interface CliBlock {
    data class Line(val text: String) : CliBlock
    data class Heading(val text: String) : CliBlock
    data class Bullet(val depth: Int, val marker: String, val text: String) : CliBlock
    data class Code(val lines: List<String>) : CliBlock
    data class Table(val header: List<String>, val rows: List<List<String>>) : CliBlock
    data object Blank : CliBlock
}

/** A piece of a line: plain, **bold** or `code`. */
data class CliSpan(val text: String, val bold: Boolean = false, val code: Boolean = false)

data class CliTool(val name: String, val arg: String, val group: String?)

object ClaudeCli {
    private val QUIET = linkedMapOf<String, (Int) -> String>(
        "bash" to { n -> "ran $n shell command${if (n == 1) "" else "s"}" },
        "read" to { n -> "read $n file${if (n == 1) "" else "s"}" },
        "search" to { n -> "searched for $n pattern${if (n == 1) "" else "s"}" },
        "web" to { n -> "fetched $n page${if (n == 1) "" else "s"}" },
    )

    /** What the terminal says while Claude works, one verb a turn: "✻ Pondering…". */
    val VERBS = listOf("Thinking", "Pondering", "Cogitating", "Brewing", "Noodling", "Mulling", "Working", "Crafting")

    /** The spinner's star, frame by frame, as the terminal turns it. */
    val SPINNER = listOf("·", "✢", "✳", "✶", "✻", "✽")

    /** The working line's verb for a turn, the same for as long as that turn lasts (`seed`: the person's last item). */
    fun workingVerb(seed: Int): String = "${VERBS[abs(seed) % VERBS.size]}…"

    /** A tool's line as the terminal shows it: its name, what it was given, and the quiet group it folds into, if any. */
    fun toolCall(text: String): CliTool {
        fun after(prefix: String) = text.substring(prefix.length).trim()
        if (text.startsWith("$ ")) return CliTool("Bash", after("$ "), "bash")
        for ((prefix, name, group) in listOf(
            Triple("Read ", "Read", "read"), Triple("Write ", "Write", null), Triple("Edit ", "Update", null),
            Triple("MultiEdit ", "Update", null), Triple("NotebookEdit ", "Update", null), Triple("Fetch ", "Fetch", "web"),
            Triple("Search ", "Web Search", "web"), Triple("Agent: ", "Agent", null),
        )) {
            if (text.startsWith(prefix)) return CliTool(name, after(prefix), group)
        }
        if (text.startsWith("Grep ") || text.startsWith("Glob ")) return CliTool("Search", "pattern: \"${text.substring(5).trim()}\"", "search")
        if (text == "Updated the to-do list") return CliTool("Update Todos", "", null)
        return CliTool(text.ifEmpty { "Tool" }, "", null)
    }

    /** "Ran 3 shell commands, read 2 files": the counts of a folded run, first letter up. */
    fun summaryText(counts: Map<String, Int>): String {
        val words = QUIET.filterKeys { (counts[it] ?: 0) > 0 }.map { (group, say) -> say(counts.getValue(group)) }.joinToString(", ")
        return words.replaceFirstChar { it.uppercase() }
    }

    /** The session's items as the terminal's rows: results under their tool, quiet tools in a row folded into one. */
    fun rows(items: List<RemoteItem>): List<CliRow> {
        val out = mutableListOf<CliRow>()
        var run: Pair<Int, MutableList<CliRow.Tool>>? = null // the folded run: its first id and its tools
        val counts = mutableMapOf<String, Int>()
        fun endRun() {
            val r = run ?: return
            out += CliRow.Summary(r.first, summaryText(counts), r.second.toList(), r.second.any { it.error })
            run = null
            counts.clear()
        }
        for (item in items) {
            when (item.kind) {
                "result" -> {
                    val r = run
                    val result = CliRow.Result(item.text, item.error)
                    if (r != null) {
                        val last = r.second.removeAt(r.second.lastIndex)
                        r.second += last.copy(results = last.results + result, error = last.error || item.error)
                    } else if (out.lastOrNull() is CliRow.Tool) {
                        val last = out.removeAt(out.lastIndex) as CliRow.Tool
                        out += last.copy(results = last.results + result, error = last.error || item.error)
                    } else {
                        out += CliRow.Event(item.id, item.text, item.error)
                    }
                }
                "tool" -> {
                    val call = toolCall(item.text)
                    val tool = CliRow.Tool(item.id, call.name, call.arg, emptyList(), false)
                    if (call.group != null) {
                        val r = run ?: (item.id to mutableListOf<CliRow.Tool>()).also { run = it }
                        r.second += tool
                        counts[call.group] = (counts[call.group] ?: 0) + 1
                    } else {
                        endRun()
                        out += tool
                    }
                }
                "you" -> { endRun(); out += CliRow.You(item.id, item.text) }
                "claude" -> { endRun(); out += CliRow.Reply(item.id, item.text) }
                else -> { endRun(); out += CliRow.Event(item.id, if (item.text == "Stopped") "Interrupted by user" else item.text, item.error) }
            }
        }
        endRun()
        return out
    }

    private val FENCE = Regex("^\\s*```")
    private val HEADING = Regex("^#{1,6}\\s+(.*)$")
    private val BULLET = Regex("^(\\s*)([-*+]|\\d+[.)])\\s+(.*)$")
    private val TABLE_RULE = Regex("^\\s*\\|?\\s*:?-{3,}:?\\s*(\\|\\s*:?-{3,}:?\\s*)*\\|?\\s*$")

    /** Claude's markdown, block by block, as the terminal shows it. */
    fun blocks(text: String): List<CliBlock> {
        val lines = text.replace("\r\n", "\n").split('\n')
        val out = mutableListOf<CliBlock>()
        var i = 0
        while (i < lines.size) {
            val line = lines[i]
            when {
                FENCE.containsMatchIn(line) -> {
                    val code = mutableListOf<String>()
                    i += 1
                    while (i < lines.size && !FENCE.containsMatchIn(lines[i])) code += lines[i++]
                    out += CliBlock.Code(code)
                }
                line.trimStart().startsWith("|") && i + 1 < lines.size && TABLE_RULE.matches(lines[i + 1]) -> {
                    val header = cells(line)
                    i += 2
                    val rows = mutableListOf<List<String>>()
                    while (i < lines.size && lines[i].trimStart().startsWith("|")) rows += cells(lines[i++])
                    out += CliBlock.Table(header, rows)
                    continue
                }
                line.isBlank() -> out += CliBlock.Blank
                else -> {
                    val heading = HEADING.find(line)
                    val bullet = BULLET.find(line)
                    out += when {
                        heading != null -> CliBlock.Heading(heading.groupValues[1])
                        bullet != null -> CliBlock.Bullet(
                            bullet.groupValues[1].length / 2,
                            bullet.groupValues[2].let { if (it.first().isDigit()) it else "•" },
                            bullet.groupValues[3],
                        )
                        else -> CliBlock.Line(line)
                    }
                }
            }
            i += 1
        }
        return out
    }

    /** A table row's cells: between the pipes, trimmed, with their **bold** and `code` marks taken off. */
    private fun cells(line: String): List<String> =
        line.trim().removePrefix("|").removeSuffix("|").split('|').map { plain(it.trim()) }

    /** The words of a line without its **bold** and `code` marks. */
    fun plain(text: String): String = spans(text).joinToString("") { it.text }

    private val SPAN = Regex("\\*\\*([^*]+)\\*\\*|`([^`]+)`")

    /** A line's pieces: plain, **bold** and `code`. A heading is all bold. */
    fun spans(text: String): List<CliSpan> {
        val out = mutableListOf<CliSpan>()
        var at = 0
        for (m in SPAN.findAll(text)) {
            if (m.range.first > at) out += CliSpan(text.substring(at, m.range.first))
            out += if (m.groupValues[1].isNotEmpty()) CliSpan(m.groupValues[1], bold = true) else CliSpan(m.groupValues[2], code = true)
            at = m.range.last + 1
        }
        if (at < text.length || out.isEmpty()) out += CliSpan(text.substring(at))
        return out
    }

    /**
     * A table drawn with box lines, as the terminal draws it, no wider than `maxWidth` characters: the widest columns
     * give way first (down to MIN_COLUMN), and a cell's words wrap within its column. A line between every row.
     */
    fun tableLines(header: List<String>, rows: List<List<String>>, maxWidth: Int): List<String> {
        val columns = max(header.size, rows.maxOfOrNull { it.size } ?: 0)
        if (columns == 0) return emptyList()
        val all = listOf(header) + rows
        val widths = IntArray(columns) { c -> all.maxOf { (it.getOrNull(c) ?: "").length }.coerceAtLeast(1) }
        val frame = 3 * columns + 1 // "│ " before each column, " " after, and the last "│"
        while (widths.sum() + frame > maxWidth) {
            val widest = widths.indices.maxBy { widths[it] }
            if (widths[widest] <= MIN_COLUMN) break
            widths[widest] -= 1
        }
        fun rule(left: String, mid: String, right: String) = widths.joinToString(mid, left, right) { "─".repeat(it + 2) }
        fun row(cells: List<String>): List<String> {
            val wrapped = (0 until columns).map { c -> wrap(cells.getOrNull(c) ?: "", widths[c]) }
            val height = wrapped.maxOf { it.size }
            return (0 until height).map { line ->
                wrapped.indices.joinToString("", "│", "") { c -> " " + (wrapped[c].getOrNull(line) ?: "").padEnd(widths[c]) + " │" }
            }
        }
        val out = mutableListOf(rule("┌", "┬", "┐"))
        all.forEachIndexed { i, cells ->
            if (i > 0) out += rule("├", "┼", "┤")
            out += row(cells)
        }
        out += rule("└", "┴", "┘")
        return out
    }

    private const val MIN_COLUMN = 6

    /**
     * A table fitted to `maxWidth` characters, for drawing with real lines (the phone's monospace font has no box
     * characters of its own width): each column's width in characters, and every row's cells as their wrapped lines,
     * the header first. The same fitting as tableLines.
     */
    fun tableCells(header: List<String>, rows: List<List<String>>, maxWidth: Int): Pair<List<Int>, List<List<List<String>>>> {
        val columns = max(header.size, rows.maxOfOrNull { it.size } ?: 0)
        if (columns == 0) return emptyList<Int>() to emptyList()
        val all = listOf(header) + rows
        val widths = IntArray(columns) { c -> all.maxOf { (it.getOrNull(c) ?: "").length }.coerceAtLeast(1) }
        while (widths.sum() + 3 * columns + 1 > maxWidth) {
            val widest = widths.indices.maxBy { widths[it] }
            if (widths[widest] <= MIN_COLUMN) break
            widths[widest] -= 1
        }
        return widths.toList() to all.map { cells -> (0 until columns).map { c -> wrap(cells.getOrNull(c) ?: "", widths[c]) } }
    }

    /** `text` in lines of at most `width` characters, broken between words (inside a word only when it is longer). */
    fun wrap(text: String, width: Int): List<String> {
        if (text.length <= width) return listOf(text)
        val out = mutableListOf<String>()
        var line = ""
        for (word in text.split(' ').filter { it.isNotEmpty() }) {
            var w = word
            while (w.length > width) {
                if (line.isNotEmpty()) { out += line; line = "" }
                out += w.substring(0, width)
                w = w.substring(width)
            }
            line = when {
                line.isEmpty() -> w
                line.length + 1 + w.length <= width -> "$line $w"
                else -> { out += line; w }
            }
        }
        if (line.isNotEmpty()) out += line
        return out.ifEmpty { listOf("") }
    }
}
