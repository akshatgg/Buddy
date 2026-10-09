package com.akshatgg.buddy.ui.panel

import com.akshatgg.buddy.cloud.RemoteItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ClaudeCliTest {
    @Test fun aToolsLineIsWrittenAsTheTerminalWritesIt() {
        assertEquals(CliTool("Bash", "npm test", "bash"), ClaudeCli.toolCall("$ npm test"))
        assertEquals(CliTool("Update", "src/a.js", null), ClaudeCli.toolCall("Edit src/a.js"))
        assertEquals(CliTool("Search", "pattern: \"TODO\"", "search"), ClaudeCli.toolCall("Grep TODO"))
        assertEquals(CliTool("Web Search", "electron tray", "web"), ClaudeCli.toolCall("Search electron tray"))
        assertEquals(CliTool("Update Todos", "", null), ClaudeCli.toolCall("Updated the to-do list"))
        assertEquals(CliTool("Tool", "", null), ClaudeCli.toolCall(""))
        assertEquals("Ran 1 shell command, read 2 files", ClaudeCli.summaryText(mapOf("bash" to 1, "read" to 2)))
    }

    @Test fun rowsPutResultsUnderTheirToolAndFoldQuietToolsInARow() {
        val rows = ClaudeCli.rows(listOf(
            RemoteItem(1, "you", "fix it"),
            RemoteItem(2, "claude", "Looking."),
            RemoteItem(3, "tool", "$ npm test"),
            RemoteItem(4, "result", "3 failing", error = true),
            RemoteItem(5, "tool", "Read src/a.js"),
            RemoteItem(6, "tool", "Edit src/a.js"),
            RemoteItem(7, "result", "Updated"),
            RemoteItem(8, "event", "Stopped"),
        ))
        assertEquals(listOf("You", "Reply", "Summary", "Tool", "Event"), rows.map { it::class.simpleName })
        val folded = rows[2] as CliRow.Summary
        assertEquals("Ran 1 shell command, read 1 file", folded.text)
        assertTrue(folded.error)
        assertEquals(listOf("3 failing"), folded.tools[0].results.map { it.text })
        assertEquals(listOf("Updated"), (rows[3] as CliRow.Tool).results.map { it.text })
        assertEquals("Interrupted by user", (rows[4] as CliRow.Event).text)
    }

    @Test fun markdownBecomesTheTerminalsBlocks() {
        val blocks = ClaudeCli.blocks("## Plan\nFix **two** things:\n- the `cart`\n  - and tax\n1. first\n\n```\nnpm test\n```\n| A | B |\n|---|---|\n| **x** | `y` |\nafter")
        assertEquals(CliBlock.Heading("Plan"), blocks[0])
        assertEquals(CliBlock.Line("Fix **two** things:"), blocks[1])
        assertEquals(CliBlock.Bullet(0, "•", "the `cart`"), blocks[2])
        assertEquals(CliBlock.Bullet(1, "•", "and tax"), blocks[3])
        assertEquals(CliBlock.Bullet(0, "1.", "first"), blocks[4])
        assertEquals(CliBlock.Blank, blocks[5])
        assertEquals(CliBlock.Code(listOf("npm test")), blocks[6])
        assertEquals(CliBlock.Table(listOf("A", "B"), listOf(listOf("x", "y"))), blocks[7])
        assertEquals(CliBlock.Line("after"), blocks[8])
        assertEquals(listOf(CliSpan("Fix "), CliSpan("two", bold = true), CliSpan(" things:")), ClaudeCli.spans("Fix **two** things:"))
        assertEquals(listOf(CliSpan("a ** b")), ClaudeCli.spans("a ** b"))
    }

    @Test fun aTableIsDrawnWithBoxLinesAndWrapsToFit() {
        val lines = ClaudeCli.tableLines(listOf("Idea", "How"), listOf(listOf("Reply", "Gives three ready replies to pick")), maxWidth = 30)
        assertEquals("┌───────┬────────────────────┐", lines.first())
        assertEquals("│ Idea  │ How                │", lines[1])
        assertEquals("├───────┼────────────────────┤", lines[2])
        assertEquals("│ Reply │ Gives three ready  │", lines[3])
        assertEquals("│       │ replies to pick    │", lines[4])
        assertEquals("└───────┴────────────────────┘", lines.last())
        assertTrue(lines.all { it.length <= 30 })
        val wide = ClaudeCli.tableLines(listOf("A"), listOf(listOf("x".repeat(50))), maxWidth = 200)
        assertEquals("wide enough: no wrapping", 54, wide.first().length)
        assertEquals(listOf("abcde", "fg"), ClaudeCli.wrap("abcdefg", 5))
    }

    @Test fun tableCellsFitTheWidthAsTheBoxLinesDo() {
        val (widths, rows) = ClaudeCli.tableCells(listOf("Idea", "How"), listOf(listOf("Reply", "Gives three ready replies to pick")), maxWidth = 30)
        assertEquals(listOf(5, 18), widths)
        assertEquals(listOf(listOf("Idea"), listOf("How")), rows[0])
        assertEquals(listOf(listOf("Reply"), listOf("Gives three ready", "replies to pick")), rows[1])
    }

    @Test fun theWorkingLineKeepsOneVerbATurn() {
        assertEquals(ClaudeCli.workingVerb(7), ClaudeCli.workingVerb(7))
        assertTrue(ClaudeCli.workingVerb(-3).endsWith("…"))
    }
}
