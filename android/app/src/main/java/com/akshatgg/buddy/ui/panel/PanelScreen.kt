package com.akshatgg.buddy.ui.panel

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.akshatgg.buddy.ui.theme.Buddy
import com.akshatgg.buddy.ui.theme.BuddyRadius

/** What the panel's box and buttons do. PanelActivity and FixActivity wire them to PanelModel; a test leaves them be. */
class PanelCallbacks(
    val setDraft: (String) -> Unit = {},
    val send: () -> Unit = {},
    val dropSelection: () -> Unit = {},
    /** A button on a line of the chat. */
    val press: (Int, ChatButton) -> Unit = { _, _ -> },
    /** The ⚙ in the header. */
    val settings: () -> Unit = {},
    val close: () -> Unit = {},
    /** The Claude button in the header and Claude mode's own; null where there is none (the Fix sheet, signed out). */
    val claude: ClaudeCallbacks? = null,
)

/** What Claude mode's buttons and box do. PanelActivity wires them to ClaudeModel. */
class ClaudeCallbacks(
    /** The Claude button: into Claude mode, or back to the chat. */
    val toggle: () -> Unit = {},
    /** A session picked from the list. */
    val open: (String) -> Unit = {},
    /** "Look again", and "‹ Sessions". */
    val list: () -> Unit = {},
    val setDraft: (String) -> Unit = {},
    val send: () -> Unit = {},
)

private const val PLACEHOLDER = "Tell me what to do…"

/** The examples under the greeting of an empty chat, as on the Mac. */
const val EXAMPLES = "“boss ko mail, kal chutti chahiye” · “fix this” · “what does this mean?”"

private val LABELS = mapOf(
    ChatButton.INSERT to "Insert", ChatButton.REPLACE to "Replace", ChatButton.COPY to "Copy", ChatButton.SHARE to "Share",
    ChatButton.UNDO to "Undo", ChatButton.RETRY to "Try again", ChatButton.SETTINGS to "Open Settings",
)

// The Mac's gear (base.css's .glyph-gear), so that both have the same Settings button.
private val Gear = ImageVector.Builder("gear", 14.dp, 14.dp, 14f, 14f).addPath(
    pathData = addPathNodes(
        "M5.94 2.06L6.15 0.3A6.75 6.75 0 0 1 7.85 0.3L8.06 2.06A5.05 5.05 0 0 1 9.74 2.76L11.14 1.67A6.75 6.75 0 0 1 " +
            "12.33 2.86L11.24 4.26A5.05 5.05 0 0 1 11.94 5.94L13.7 6.15A6.75 6.75 0 0 1 13.7 7.85L11.94 8.06A5.05 5.05 0 " +
            "0 1 11.24 9.74L12.33 11.14A6.75 6.75 0 0 1 11.14 12.33L9.74 11.24A5.05 5.05 0 0 1 8.06 11.94L7.85 13.7A6.75 " +
            "6.75 0 0 1 6.15 13.7L5.94 11.94A5.05 5.05 0 0 1 4.26 11.24L2.86 12.33A6.75 6.75 0 0 1 1.67 11.14L2.76 " +
            "9.74A5.05 5.05 0 0 1 2.06 8.06L0.3 7.85A6.75 6.75 0 0 1 0.3 6.15L2.06 5.94A5.05 5.05 0 0 1 2.76 4.26L1.67 " +
            "2.86A6.75 6.75 0 0 1 2.86 1.67L4.26 2.76A5.05 5.05 0 0 1 5.94 2.06ZM7 4.8A2.2 2.2 0 1 0 7 9.2A2.2 2.2 0 1 0 7 4.8Z",
    ),
    pathFillType = PathFillType.EvenOdd,
    fill = SolidColor(Color.Black),
).build()

// An arrow up, for the send button.
private val SendArrow = ImageVector.Builder("send", 16.dp, 16.dp, 16f, 16f).addPath(
    pathData = addPathNodes("M8 13.5L8 2.5M8 2.5L3.5 7M8 2.5L12.5 7"),
    stroke = SolidColor(Color.Black),
    strokeLineWidth = 2f,
    strokeLineCap = StrokeCap.Round,
    strokeLineJoin = StrokeJoin.Round,
).build()

/** The first words of a selection, for its card. */
internal fun firstWords(selection: String, max: Int = 60): String {
    val line = selection.replace(Regex("\\s+"), " ").trim()
    return if (line.length <= max) line else line.take(max).trimEnd() + "…"
}

/** Whether the send button (and ↩) sends: not while the buddy answers; with words in the box, or a selection to fix. */
internal fun canSend(state: PanelState) = !state.busy && (state.draft.isNotBlank() || state.selection.isNotBlank())

/**
 * The panel: a card at the bottom of the screen with the buddy's name and the app, the chat, the selection the panel
 * was opened with, and the box, in the Mac panel's words. `micButton` is the voice button's place in the box. With
 * Claude mode on (`claude`, where the panel has a Claude button), a Claude Code session takes the chat's place, and the
 * box types into it.
 */
@Composable
fun PanelScreen(
    state: PanelState,
    buddyName: String,
    on: PanelCallbacks,
    claude: ClaudeState = ClaudeState(),
    micButton: @Composable () -> Unit = {},
) {
    val claudeOn = on.claude?.takeIf { claude.on }
    Sheet(on.close) {
        Header(buddyName, if (claudeOn != null) "Claude Code" else state.appName, on.settings, on.close, on.claude?.let { c -> { ClaudeButton(claude.on, c.toggle) } })
        if (claudeOn != null) {
            ClaudeView(claude, claudeOn, Modifier.weight(1f, fill = false))
            InputRow(claude.draft, claude.placeholder ?: PLACEHOLDER, claude.canSend, claudeOn.setDraft, claudeOn.send, micButton)
            claude.boxError?.let { Text(it, color = Buddy.colors.error, style = MaterialTheme.typography.bodySmall) }
        } else {
            Messages(state, Modifier.weight(1f, fill = false), on.press)
            if (state.busy) Busy(buddyName)
            if (state.selection.isNotBlank()) SelectionCard(state.selection, on.dropSelection)
            InputRow(state.draft, PLACEHOLDER, canSend(state), on.setDraft, on.send, micButton)
            state.boxError?.let { Text(it, color = Buddy.colors.error, style = MaterialTheme.typography.bodySmall) }
        }
    }
}

/**
 * Buddy's card over whatever app is on screen, at the bottom, at most most of the screen high, with a handle bar. A
 * tap outside the card closes it, as a click anywhere else hides the Mac's panel.
 */
@Composable
internal fun Sheet(onClose: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val colors = Buddy.colors
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val tallest = maxHeight * 0.85f
        Spacer(
            Modifier.fillMaxSize().clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClickLabel = "Close",
                onClick = onClose,
            ),
        )
        // A Surface takes every touch that lands on it, so a tap on the card never reaches the space behind it.
        Surface(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .imePadding()
                .padding(16.dp)
                .widthIn(max = 420.dp)
                .heightIn(max = tallest)
                .fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            color = colors.card,
            contentColor = colors.fg,
            border = BorderStroke(1.dp, colors.line),
            shadowElevation = 6.dp,
        ) {
            Column(
                Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    Modifier.align(Alignment.CenterHorizontally).size(width = 36.dp, height = 4.dp)
                        .background(colors.line, RoundedCornerShape(2.dp)),
                )
                content()
            }
        }
    }
}

@Composable
private fun Header(buddyName: String, appName: String, onSettings: () -> Unit, onClose: () -> Unit, claudeButton: (@Composable () -> Unit)? = null) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(buddyName, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium, maxLines = 1)
        Text(
            if (appName.isEmpty()) "" else " · $appName",
            Modifier.weight(1f),
            color = Buddy.colors.muted,
            style = MaterialTheme.typography.titleMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        claudeButton?.invoke()
        IconButton(onClick = onSettings) {
            Icon(Gear, contentDescription = "Settings", Modifier.size(18.dp), tint = Buddy.colors.muted)
        }
        IconButton(onClick = onClose) {
            Text("✕", color = Buddy.colors.muted, fontSize = 16.sp)
        }
    }
}

/** The chat, newest at the bottom; an empty one greets the person and shows what they can ask. */
@Composable
private fun Messages(state: PanelState, modifier: Modifier, press: (Int, ChatButton) -> Unit) {
    if (state.items.isEmpty()) {
        Column(modifier.padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(state.greeting, style = MaterialTheme.typography.titleMedium)
            Text(EXAMPLES, color = Buddy.colors.muted, style = MaterialTheme.typography.bodySmall)
        }
        return
    }
    val list = rememberLazyListState()
    LaunchedEffect(state.items.size, state.items.lastOrNull()) { list.animateScrollToItem(state.items.size - 1) }
    LazyColumn(modifier, state = list, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(state.items, key = { it.id }) { item ->
            when (item) {
                is YouSaid -> You(item)
                is BuddySaid -> BuddyLine(item, press)
                is ChatEvent -> EventLine(item, press)
                is ChatError -> ErrorLine(item, press)
            }
        }
    }
}

@Composable
private fun You(item: YouSaid) {
    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
        Text(
            item.text,
            Modifier.widthIn(max = 300.dp).background(Buddy.colors.accentSoft, RoundedCornerShape(12.dp)).padding(horizontal = 12.dp, vertical = 8.dp),
            style = MaterialTheme.typography.bodyLarge,
        )
    }
}

@Composable
private fun BuddyLine(item: BuddySaid, press: (Int, ChatButton) -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (item.say.isNotEmpty()) Text(item.say, style = MaterialTheme.typography.bodyLarge)
        if (item.text.isNotEmpty()) AnswerText(item.text)
        for (note in item.notes) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("•", color = Buddy.colors.muted)
                Text(note, color = Buddy.colors.muted, style = MaterialTheme.typography.bodyMedium)
            }
        }
        Buttons(item.id, item.buttons, press)
    }
}

@Composable
private fun EventLine(item: ChatEvent, press: (Int, ChatButton) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(item.text, Modifier.weight(1f), color = Buddy.colors.muted, style = MaterialTheme.typography.bodySmall)
        for (button in item.buttons) {
            TextButton({ press(item.id, button) }, shape = ROUNDED) { Text(LABELS.getValue(button)) }
        }
    }
}

/** What went wrong, in the error colour on its soft tint, with Try again and the way to Settings when they help. */
@Composable
private fun ErrorLine(item: ChatError, press: (Int, ChatButton) -> Unit) {
    val colors = Buddy.colors
    Column(
        Modifier.fillMaxWidth().background(colors.errorSoft, RoundedCornerShape(7.dp)).padding(start = 12.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(item.text, color = colors.error, style = MaterialTheme.typography.bodyMedium)
        if (item.buttons.isNotEmpty()) Buttons(item.id, item.buttons, press)
    }
}

/** A line's buttons: the first one filled (Insert, Replace, Undo, Copy…), the others outlined. */
@Composable
private fun Buttons(id: Int, buttons: List<ChatButton>, press: (Int, ChatButton) -> Unit) {
    if (buttons.isEmpty()) return
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        buttons.forEachIndexed { i, button ->
            val label = LABELS.getValue(button)
            when {
                button == ChatButton.RETRY -> TextButton({ press(id, button) }, shape = ROUNDED) { Text(label) }
                i == 0 && button != ChatButton.SETTINGS -> Primary(label) { press(id, button) }
                else -> Secondary(label) { press(id, button) }
            }
        }
    }
}

@Composable
private fun SelectionCard(selection: String, onDrop: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().border(1.dp, Buddy.colors.line, ROUNDED).padding(start = 12.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "Your selection: “${firstWords(selection)}”",
            Modifier.weight(1f),
            color = Buddy.colors.muted,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        IconButton(onClick = onDrop) { Text("✕", color = Buddy.colors.muted) }
    }
}

/** The box, the 🎤 and the send button: the chat's, or in Claude mode the session's. */
@Composable
private fun InputRow(draft: String, placeholder: String, canSend: Boolean, setDraft: (String) -> Unit, send: () -> Unit, micButton: @Composable () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        OutlinedTextField(
            value = draft,
            onValueChange = setDraft,
            modifier = Modifier.weight(1f),
            placeholder = { Text(placeholder, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            maxLines = 4,
            shape = RoundedCornerShape(BuddyRadius),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { if (canSend) send() }),
        )
        micButton()
        IconButton(onClick = send, enabled = canSend) {
            Icon(SendArrow, contentDescription = "Send", Modifier.size(20.dp), tint = if (canSend) Buddy.colors.accent else Buddy.colors.muted)
        }
    }
}

/** The Mac's segmented control: a groove with the chosen segment raised in it, and hairlines between the others. */
@Composable
internal fun <T> Segmented(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit, role: Role, modifier: Modifier = Modifier) {
    val colors = Buddy.colors
    Row(modifier.fillMaxWidth().background(colors.track, RoundedCornerShape(9.dp)).padding(2.dp)) {
        options.forEachIndexed { i, (value, label) ->
            val chosen = value == selected
            val hairline = i > 0 && !chosen && options[i - 1].first != selected
            Box(
                Modifier
                    .weight(1f)
                    .drawBehind {
                        if (hairline) drawLine(colors.line, Offset(0f, size.height * 0.25f), Offset(0f, size.height * 0.75f), 1.dp.toPx())
                    }
                    .then(if (chosen) Modifier.shadow(1.dp, RoundedCornerShape(7.dp)).background(colors.control, RoundedCornerShape(7.dp)) else Modifier)
                    .selectable(selected = chosen, role = role, onClick = { onSelect(value) })
                    .padding(vertical = 7.dp, horizontal = 4.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    fontSize = 13.sp,
                    fontWeight = if (chosen) FontWeight.Medium else FontWeight.Normal,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

internal val ROUNDED = RoundedCornerShape(BuddyRadius)
private val BUTTON_PADDING = PaddingValues(horizontal = 16.dp, vertical = 8.dp)

@Composable
internal fun Primary(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Button(onClick, modifier, enabled = enabled, shape = ROUNDED, contentPadding = BUTTON_PADDING) { Text(label, fontWeight = FontWeight.Medium) }
}

@Composable
internal fun Secondary(label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    OutlinedButton(
        onClick,
        modifier,
        shape = ROUNDED,
        contentPadding = BUTTON_PADDING,
        border = BorderStroke(1.dp, Buddy.colors.line),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Buddy.colors.fg),
    ) { Text(label) }
}

@Composable
internal fun Busy(buddyName: String) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp), color = Buddy.colors.accent, trackColor = Buddy.colors.track)
        Text("$buddyName is thinking…", color = Buddy.colors.muted, style = MaterialTheme.typography.bodyMedium)
    }
}

/** An answer's words, in a box like the Mac's, and selectable so that a part of it can be copied. */
@Composable
internal fun AnswerText(text: String) {
    SelectionContainer {
        Text(
            text,
            Modifier.fillMaxWidth().border(1.dp, Buddy.colors.line, ROUNDED).padding(horizontal = 12.dp, vertical = 10.dp),
            style = MaterialTheme.typography.bodyLarge,
        )
    }
}
