package com.akshatgg.buddy.ui.panel

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
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
        } else if (items.isNotEmpty()) {
            // A list of its own for each session, so that the next one opens at its bottom.
            key(session.id) { ClaudeItems(items, Modifier.weight(1f, fill = false)) }
        }
        state.problem?.let { Text(it, color = colors.error, style = MaterialTheme.typography.bodySmall) }
        if (!session.canTalk) {
            Text(CLAUDE_NO_TALK, Modifier.fillMaxWidth(), color = colors.muted, fontSize = 11.sp, textAlign = TextAlign.Center)
        }
    }
}

/**
 * The session's items. The list follows the newest one while the person is at the bottom, and stays where they read
 * when they have scrolled up: "at the bottom" is the last newest item still being on screen.
 */
@Composable
private fun ClaudeItems(items: List<RemoteItem>, modifier: Modifier) {
    val list = rememberLazyListState()
    val seen = remember { object { var newest: Int? = null } } // the newest item the list has followed, none yet
    val newest = items.last().id
    LaunchedEffect(newest) {
        val before = seen.newest
        val atBottom = before == null || list.layoutInfo.visibleItemsInfo.any { it.key == before }
        seen.newest = newest
        if (atBottom) {
            list.scrollToItem(items.lastIndex)
            list.scrollBy(100_000f) // to the end of an item taller than the list; a scroll stops where the list ends
        }
    }
    LazyColumn(modifier, state = list, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items(items, key = { it.id }) { ClaudeItem(it) }
    }
}

private val MONO = 11.sp
private val MONO_LINE = 15.sp

/** One item as the terminal shows it, in the Mac panel's looks. Plain text, selectable to copy a part of it. */
@Composable
private fun ClaudeItem(item: RemoteItem) {
    val colors = Buddy.colors
    when (item.kind) {
        "you", "claude" -> {
            val you = item.kind == "you"
            Box(Modifier.fillMaxWidth(), contentAlignment = if (you) Alignment.CenterEnd else Alignment.CenterStart) {
                val shape = if (you) {
                    RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp, bottomEnd = 5.dp, bottomStart = 14.dp)
                } else {
                    RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp, bottomEnd = 14.dp, bottomStart = 5.dp)
                }
                SelectionContainer {
                    Text(
                        item.text,
                        Modifier.widthIn(max = if (you) 300.dp else 360.dp)
                            .background(if (you) colors.accentSoft else colors.track, shape)
                            .padding(horizontal = 11.dp, vertical = 7.dp),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
            }
        }
        "tool" -> SelectionContainer {
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = colors.accent)) { append("⏺ ") }
                    append(item.text)
                },
                Modifier.fillMaxWidth(),
                color = colors.fg,
                fontFamily = FontFamily.Monospace,
                fontSize = MONO,
                lineHeight = MONO_LINE,
            )
        }
        "result" -> {
            val edge = if (item.error) colors.error else colors.line
            SelectionContainer {
                Text(
                    item.text,
                    Modifier.fillMaxWidth()
                        .drawBehind { drawRect(edge, size = Size(2.dp.toPx(), size.height)) }
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    color = if (item.error) colors.error else colors.muted,
                    fontFamily = FontFamily.Monospace,
                    fontSize = MONO,
                    lineHeight = MONO_LINE,
                )
            }
        }
        else -> Text(
            item.text,
            Modifier.fillMaxWidth(),
            color = colors.muted,
            fontSize = 12.sp,
            textAlign = TextAlign.Center,
        )
    }
}
