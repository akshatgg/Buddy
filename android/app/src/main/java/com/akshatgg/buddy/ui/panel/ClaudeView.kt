package com.akshatgg.buddy.ui.panel

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.animateValue
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.akshatgg.buddy.cloud.RemoteItem
import com.akshatgg.buddy.cloud.RemoteSession
import com.akshatgg.buddy.ui.theme.Buddy

/** What Claude mode's buttons and box do. ClaudeActivity wires them to ClaudeModel; a test leaves them be. */
class ClaudeCallbacks(
    /** A session picked from the list. */
    val open: (String) -> Unit = {},
    /** "Look again", and "‹ Sessions". */
    val list: () -> Unit = {},
    val setDraft: (String) -> Unit = {},
    val send: () -> Unit = {},
)

/** The panel header's Claude button: Claude Code on its own screen, as the Mac's opens Claude mode. */
@Composable
internal fun ClaudeButton(onClick: () -> Unit) {
    OutlinedButton(
        onClick,
        Modifier.height(32.dp),
        shape = ROUNDED,
        contentPadding = PaddingValues(horizontal = 10.dp),
        border = BorderStroke(1.dp, Buddy.colors.line),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Buddy.colors.fg),
    ) { Text("Claude", fontSize = 13.sp) }
}

/**
 * Claude mode: the sessions to pick from, or the one picked. `modifier` is for the room it has (the screen's, under its
 * bar): the session's items fill it, and the box under it stays at the bottom.
 */
@Composable
internal fun ClaudeView(state: ClaudeState, on: ClaudeCallbacks, modifier: Modifier) {
    val session = state.session
    if (session == null) ClaudePick(state, on, modifier) else ClaudeSession(state, session, on, modifier)
}

/** "Which Claude Code session?": the computer's sessions, or why there are none, and Look again. */
@Composable
private fun ClaudePick(state: ClaudeState, on: ClaudeCallbacks, modifier: Modifier) {
    val colors = Buddy.colors
    Column(
        modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(vertical = 6.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Which Claude Code session?", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        if (state.online == true) {
            for (s in state.sessions) SessionRow(s) { on.open(s.id) }
        }
        val why = when {
            state.online == false -> CLAUDE_OFFLINE
            state.online == true && state.sessions.isEmpty() -> CLAUDE_NONE
            else -> null
        }
        why?.let { Text(it, color = colors.muted, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center) }
        state.listError?.let {
            Text(
                it,
                Modifier.fillMaxWidth().background(colors.errorSoft, RoundedCornerShape(7.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
                color = colors.error,
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        if (state.looking) LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp), color = colors.accent, trackColor = colors.track)
        Secondary("Look again", onClick = on.list)
    }
}

@Composable
private fun SessionRow(session: RemoteSession, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(ROUNDED)
            .border(1.dp, Buddy.colors.line, ROUNDED)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Column(Modifier.weight(1f)) {
            // Its title, as its terminal tab shows it; under it, its short name and which computer it runs on (several
            // can share at once).
            Text(session.shown, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val under = listOfNotNull(session.title?.let { session.name }, session.device?.let { "on $it" }).joinToString(" · ")
            if (under.isNotEmpty()) Text(under, color = Buddy.colors.muted, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        StatusChip(session.status)
    }
}

/** How a session stands: a small chip, tinted while Claude works and red while it waits for the person. */
@Composable
private fun StatusChip(status: String) {
    val colors = Buddy.colors
    val (back, fore) = when (status) {
        "working" -> colors.accentSoft to colors.fg
        "waiting" -> colors.errorSoft to colors.error
        else -> colors.track to colors.muted
    }
    Text(
        CLAUDE_STATUS[status] ?: status,
        Modifier.background(back, RoundedCornerShape(10.dp)).padding(horizontal = 8.dp, vertical = 1.dp),
        color = fore,
        fontSize = 11.sp,
        maxLines = 1,
    )
}

/** One session: a bar with "‹ Sessions", its name and its status, then everything in it, newest at the bottom. */
@Composable
private fun ClaudeSession(state: ClaudeState, session: RemoteSession, on: ClaudeCallbacks, modifier: Modifier) {
    val colors = Buddy.colors
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            TextButton(on.list, shape = ROUNDED, contentPadding = PaddingValues(horizontal = 8.dp)) { Text("‹ Sessions") }
            // The name first; the computer's after it, cut short when there is no room for both.
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(session.shown) }
                    session.device?.let { withStyle(SpanStyle(color = colors.muted)) { append(" · on $it") } }
                },
                Modifier.weight(1f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            StatusChip(session.status)
        }
        HorizontalDivider(color = colors.lineSoft)
        val items = state.items
        if (items == null) {
            Text("Waiting for your computer…", Modifier.padding(vertical = 8.dp), color = colors.muted, style = MaterialTheme.typography.bodyMedium)
        } else if (items.isNotEmpty() || state.working) {
            // A list of its own for each session, so that the next one opens at its bottom.
            key(session.id) { ClaudeItems(items, state.working, Modifier.weight(1f, fill = false)) }
        }
        state.problem?.let { Text(it, color = colors.error, style = MaterialTheme.typography.bodySmall) }
        if (!session.canTalk) {
            Text(CLAUDE_NO_TALK, Modifier.fillMaxWidth(), color = colors.muted, fontSize = 11.sp, textAlign = TextAlign.Center)
        }
    }
}

/**
 * The session as Claude Code's terminal draws it (ClaudeCli): ❯ what the person typed, ● Claude's replies with their
 * markdown (tables in box lines), ● its tools with ⎿ what they gave back, the quiet ones folded, and "✻ Pondering…"
 * while Claude works. The list follows the newest line while the person is at the bottom, and stays where they read
 * when they have scrolled up: "at the bottom" is the last newest row still being on screen.
 */
@Composable
private fun ClaudeItems(items: List<RemoteItem>, working: Boolean, modifier: Modifier) {
    val rows = remember(items) { ClaudeCli.rows(items) }
    val open = remember { mutableStateMapOf<Int, Boolean>() } // the folded rows the person opened
    val list = rememberLazyListState()
    val seen = remember { object { var newest: Int? = null } } // the newest item the list has followed, none yet
    val newest = (items.lastOrNull()?.id ?: 0) * 2 + if (working) 1 else 0
    LaunchedEffect(newest) {
        val before = seen.newest
        val atBottom = before == null || list.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let { it >= list.layoutInfo.totalItemsCount - 2 } ?: true
        seen.newest = newest
        if (atBottom && list.layoutInfo.totalItemsCount > 0) {
            list.scrollToItem(list.layoutInfo.totalItemsCount - 1)
            list.scrollBy(100_000f) // to the end of a row taller than the list; a scroll stops where the list ends
        }
    }
    val seed = items.lastOrNull { it.kind == "you" }?.id ?: 0
    LazyColumn(modifier, state = list, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(rows, key = { "${it::class.simpleName}:${it.id}" }) { row ->
            CliRowView(row, open[row.id] == true) { open[row.id] = open[row.id] != true }
        }
        if (working) item(key = "working") { WorkingLine(seed) }
    }
}

private val MONO = 13.sp
private val MONO_LINE = 19.sp

@Composable
private fun mono(color: Color = Buddy.colors.fg) = TextStyle(fontFamily = FontFamily.Monospace, fontSize = MONO, lineHeight = MONO_LINE, color = color)

/** A line's **bold** and `code`, as the terminal shows them. */
@Composable
private fun cliString(text: String): AnnotatedString {
    val code = Color(0xFFB1B9F9)
    return buildAnnotatedString {
        for (span in ClaudeCli.spans(text)) {
            when {
                span.bold -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(span.text) }
                span.code -> withStyle(SpanStyle(color = code)) { append(span.text) }
                else -> append(span.text)
            }
        }
    }
}

/** A mark and what follows it, the words hanging beside it: "● reply", "❯ what you typed", "⎿ output". */
@Composable
private fun Marked(mark: String, markColor: Color, modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Row(modifier.fillMaxWidth()) {
        Text(mark, Modifier.width(22.dp), style = mono(markColor))
        Box(Modifier.weight(1f)) { content() }
    }
}

@Composable
private fun CliRowView(row: CliRow, isOpen: Boolean, toggle: () -> Unit) {
    val colors = Buddy.colors
    when (row) {
        is CliRow.You -> Marked("❯", colors.muted, Modifier.background(colors.track).padding(horizontal = 4.dp, vertical = 2.dp)) {
            SelectionContainer { Text(cliString(row.text), style = mono()) }
        }
        is CliRow.Reply -> Marked("●", colors.fg) { SelectionContainer { CliBlocks(row.text) } }
        is CliRow.Tool -> CliToolView(row)
        is CliRow.Summary -> Column(Modifier.fillMaxWidth()) {
            Text(
                row.text,
                Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = toggle).padding(start = 22.dp, top = 2.dp, bottom = 2.dp),
                style = mono(if (row.error) colors.error else colors.muted),
            )
            if (isOpen) {
                Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { row.tools.forEach { CliToolView(it) } }
            }
        }
        is CliRow.Event -> Marked("⎿", colors.muted, Modifier.padding(start = 10.dp)) { Text(row.text, style = mono(if (row.error) colors.error else colors.muted)) }
    }
}

@Composable
private fun CliToolView(tool: CliRow.Tool) {
    val colors = Buddy.colors
    Column(Modifier.fillMaxWidth()) {
        Marked("●", if (tool.error) colors.error else colors.good) {
            SelectionContainer {
                Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(tool.name) }
                        if (tool.arg.isNotEmpty()) append("(${tool.arg})")
                    },
                    style = mono(),
                )
            }
        }
        for (result in tool.results) {
            Marked("⎿", colors.muted, Modifier.padding(start = 10.dp)) {
                SelectionContainer { Text(result.text, style = mono(if (result.error) colors.error else colors.muted)) }
            }
        }
    }
}

/** Claude's markdown, block by block: lines, headings, lists, code, and tables drawn with box lines that fit the screen. */
@Composable
private fun CliBlocks(text: String) {
    val blocks = remember(text) { ClaudeCli.blocks(text) }
    Column(Modifier.fillMaxWidth()) {
        for (block in blocks) {
            when (block) {
                is CliBlock.Line -> Text(cliString(block.text), style = mono())
                is CliBlock.Heading -> Text(block.text, style = mono().copy(fontWeight = FontWeight.Bold))
                is CliBlock.Bullet -> Row(Modifier.padding(start = (block.depth * 16).dp)) {
                    Text("${block.marker} ", style = mono(Buddy.colors.muted))
                    Text(cliString(block.text), style = mono())
                }
                is CliBlock.Code -> Text(
                    block.lines.joinToString("\n"),
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 2.dp),
                    style = mono(Color(0xFFB1B9F9)),
                    softWrap = false,
                )
                is CliBlock.Table -> CliTable(block)
                CliBlock.Blank -> Spacer(Modifier.height(8.dp))
            }
        }
    }
}

/**
 * A table as the terminal draws it: framed, a line between every row and column, the header bold, its columns made to
 * fit the width there is (their words wrap within). The lines are drawn, not typed: the phone's monospace font has no
 * box characters of its own width. Should it still be wider than the screen (many columns), it scrolls sideways.
 */
@Composable
private fun CliTable(table: CliBlock.Table) {
    val measurer = rememberTextMeasurer()
    val style = mono()
    val line = Buddy.colors.line
    BoxWithConstraints(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        val density = LocalDensity.current
        val charPx = remember(style) { measurer.measure("0000000000", style).size.width / 10f }
        val maxChars = with(density) { (maxWidth.toPx() / charPx).toInt() }.coerceAtLeast(20)
        val (widths, rows) = remember(table, maxChars) { ClaudeCli.tableCells(table.header, table.rows, maxChars) }
        val cellPad = 6.dp
        // As wide as its widest row, so that the lines between rows reach across (a sideways scroll gives no width).
        Column(Modifier.horizontalScroll(rememberScrollState()).width(IntrinsicSize.Max).border(1.dp, line)) {
            rows.forEachIndexed { r, cells ->
                if (r > 0) HorizontalDivider(color = line, thickness = 1.dp)
                Row(Modifier.height(IntrinsicSize.Min)) {
                    cells.forEachIndexed { c, lines ->
                        if (c > 0) VerticalDivider(color = line, thickness = 1.dp)
                        Text(
                            lines.joinToString("\n"),
                            Modifier.width(with(density) { (widths[c] * charPx).toDp() } + cellPad * 2).padding(horizontal = cellPad, vertical = 3.dp),
                            style = if (r == 0) style.copy(fontWeight = FontWeight.Bold) else style,
                            softWrap = false,
                        )
                    }
                }
            }
        }
    }
}

/** "✻ Pondering…": Claude at work, its star turning as the terminal's does, one verb a turn. */
@Composable
private fun WorkingLine(seed: Int) {
    val turn = rememberInfiniteTransition(label = "spinner")
    val frame by turn.animateValue(
        0, ClaudeCli.SPINNER.size, Int.VectorConverter,
        infiniteRepeatable(tween(durationMillis = 1200, easing = LinearEasing)),
        label = "frame",
    )
    val orange = Buddy.colors.accent
    Marked(ClaudeCli.SPINNER[frame.coerceIn(0, ClaudeCli.SPINNER.lastIndex)], orange) {
        Text(ClaudeCli.workingVerb(seed), style = mono(orange))
    }
}
