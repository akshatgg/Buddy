package com.akshatgg.buddy.ui.panel

import androidx.compose.foundation.BorderStroke
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.calculateEndPadding
import androidx.compose.foundation.layout.calculateStartPadding
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.lerp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
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
    /** The header's Claude button: Claude Code on its own screen. Null where there is none (the Fix sheet, signed out). */
    val claude: (() -> Unit)? = null,
    /** The card to the whole screen (true) or back (false): its handle, and the header's button. Null: it keeps its size. */
    val setFull: ((Boolean) -> Unit)? = null,
)

internal const val PLACEHOLDER = "Tell me what to do…"

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

// Four corners pointing out, for "Full screen", and in, for "Smaller".
private fun corners(name: String, path: String) = ImageVector.Builder(name, 16.dp, 16.dp, 16f, 16f).addPath(
    pathData = addPathNodes(path),
    stroke = SolidColor(Color.Black),
    strokeLineWidth = 1.7f,
    strokeLineCap = StrokeCap.Round,
    strokeLineJoin = StrokeJoin.Round,
).build()

private val Bigger = corners("bigger", "M2 6V2H6M10 2H14V6M14 10V14H10M6 14H2V10")
private val Smaller = corners("smaller", "M6 2V6H2M14 6H10V2M10 14V10H14M2 10H6V14")

/** The first words of a selection, for its card. */
internal fun firstWords(selection: String, max: Int = 60): String {
    val line = selection.replace(Regex("\\s+"), " ").trim()
    return if (line.length <= max) line else line.take(max).trimEnd() + "…"
}

/** Whether the send button (and ↩) sends: not while the buddy answers; with words in the box, or a selection to fix. */
internal fun canSend(state: PanelState) = !state.busy && (state.draft.isNotBlank() || state.selection.isNotBlank())

/**
 * The panel: a card at the bottom of the screen with the buddy's name and the app, the chat, the selection the panel
 * was opened with, and the box, in the Mac panel's words. `micButton` is the voice button's place in the box. `full`:
 * the card fills the screen (where `on.setFull` lets it).
 */
@Composable
fun PanelScreen(
    state: PanelState,
    buddyName: String,
    on: PanelCallbacks,
    full: Boolean = false,
    micButton: @Composable () -> Unit = {},
) {
    Sheet(on.close, full, on.setFull) { body ->
        Header(buddyName, state.appName, on.settings, on.close, on.claude, full, on.setFull)
        Messages(state, body, on.press)
        if (state.busy) Busy(buddyName)
        if (state.selection.isNotBlank()) SelectionCard(state.selection, on.dropSelection)
        InputRow(state.draft, PLACEHOLDER, canSend(state), on.setDraft, on.send, micButton)
        state.boxError?.let { Text(it, color = Buddy.colors.error, style = MaterialTheme.typography.bodySmall) }
    }
}

// How long the card takes to fill the screen, or to go back.
private const val GROW_MS = 250

/**
 * Buddy's card over whatever app is on screen, at the bottom, at most most of the screen high, with a handle bar. A
 * tap outside the card closes it, as a click anywhere else hides the Mac's panel. Its handle pulls it: up to the whole
 * screen (`full`, through `setFull`), down from there back to the card, and down from the card to close it; the card
 * follows the finger while it pulls, and goes on to where sheetMove says when it lets go. Full, the card is the whole
 * screen, and keeps its words clear of the status bar, the navigation bar and the keyboard. `body` is for the part of
 * the content that takes the room the card has (the chat): it fills a card that is taller than what it holds.
 */
@Composable
internal fun Sheet(
    onClose: () -> Unit,
    full: Boolean = false,
    setFull: ((Boolean) -> Unit)? = null,
    content: @Composable ColumnScope.(body: Modifier) -> Unit,
) {
    val colors = Buddy.colors
    val density = LocalDensity.current
    val direction = LocalLayoutDirection.current
    val nowFull by rememberUpdatedState(full && setFull != null)
    val nowSetFull by rememberUpdatedState(setFull)
    val nowClose by rememberUpdatedState(onClose)
    // 0: the card, 1: the whole screen, and between the two while it moves.
    val grown = remember { Animatable(if (nowFull) 1f else 0f) }
    // How far the card is pulled down below its place, toward closing (px).
    val slide = remember { Animatable(0f) }
    // How far the handle is pulled now (px, down is more); 0 when the finger is up.
    var drag by remember { mutableFloatStateOf(0f) }
    // The card's own height (px), measured while it is a card: where it grows from. 0 until it has been one.
    var natural by remember { mutableIntStateOf(0) }
    LaunchedEffect(nowFull) { grown.animateTo(if (nowFull) 1f else 0f, tween(GROW_MS)) }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val tallest = maxHeight * 0.85f
        val screen = constraints.maxHeight.toFloat()
        // What the card grows by from its own height to the whole screen; half the screen if it opened full.
        fun span() = (screen - (natural.takeIf { it > 0 } ?: (screen / 2).toInt())).coerceAtLeast(1f)
        // Where the card is with the finger's pull added: a pull up grows it, a pull down shrinks it to a card and then
        // slides it down.
        fun grownNow() = if (nowSetFull == null) 0f else (grown.value - drag / span()).coerceIn(0f, 1f)
        fun slideNow() = (slide.value + (drag - grown.value * span()).coerceAtLeast(0f)).coerceAtLeast(0f)
        val p = grownNow()
        Spacer(
            Modifier.fillMaxSize().clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClickLabel = "Close",
                onClick = onClose,
            ),
        )
        // The system bars and the keyboard: around the card while it is one, inside it as it fills the screen.
        val insets = WindowInsets.safeDrawing.asPaddingValues()
        fun around(p: Float, side: Dp, margin: Dp) = (side + margin) * (1f - p)
        val outside = PaddingValues(
            start = around(p, insets.calculateStartPadding(direction), 16.dp),
            top = around(p, insets.calculateTopPadding(), 16.dp),
            end = around(p, insets.calculateEndPadding(direction), 16.dp),
            bottom = around(p, insets.calculateBottomPadding(), 16.dp),
        )
        val inside = PaddingValues(
            start = insets.calculateStartPadding(direction) * p,
            top = insets.calculateTopPadding() * p,
            end = insets.calculateEndPadding(direction) * p,
            bottom = insets.calculateBottomPadding() * p,
        )
        val size = if (p > 0f) {
            val from = with(density) { natural.takeIf { it > 0 }?.toDp() ?: (maxHeight / 2) }
            Modifier.height(lerp(from, maxHeight, p))
        } else {
            Modifier.heightIn(max = tallest).onSizeChanged { if (drag == 0f && slide.value == 0f) natural = it.height }
        }
        // A Surface takes every touch that lands on it, so a tap on the card never reaches the space behind it.
        Surface(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .graphicsLayer { translationY = slideNow() }
                .padding(outside)
                .widthIn(max = if (maxWidth > 420.dp) lerp(420.dp, maxWidth, p) else maxWidth)
                .then(size)
                .fillMaxWidth(),
            shape = RoundedCornerShape(lerp(14.dp, 0.dp, p)),
            color = colors.card,
            contentColor = colors.fg,
            border = if (p < 1f) BorderStroke(1.dp, colors.line) else null,
            shadowElevation = 6.dp,
        ) {
            Column(Modifier.padding(inside).padding(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
                Handle(
                    pull = { drag += it },
                    letGo = { velocity ->
                        val move = sheetMove(nowFull, drag, velocity, screen).let {
                            if (nowSetFull == null && (it == SheetMove.EXPAND || it == SheetMove.COLLAPSE)) SheetMove.STAY else it
                        }
                        if (move == SheetMove.CLOSE) {
                            nowClose()
                            return@Handle
                        }
                        // The card stays where the finger left it, and goes on from there.
                        val at = grownNow()
                        val down = slideNow()
                        grown.snapTo(at)
                        slide.snapTo(down)
                        drag = 0f
                        when (move) {
                            SheetMove.EXPAND -> nowSetFull?.invoke(true)
                            SheetMove.COLLAPSE -> nowSetFull?.invoke(false)
                            else -> {}
                        }
                        coroutineScope {
                            launch { slide.animateTo(0f, tween(GROW_MS)) }
                            if (move == SheetMove.STAY) launch { grown.animateTo(if (nowFull) 1f else 0f, tween(GROW_MS)) }
                        }
                    },
                )
                Column(Modifier.weight(1f, fill = p > 0f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    content(Modifier.weight(1f, fill = p > 0f))
                }
            }
        }
    }
}

/** The bar at the top of the card, and the strip around it that the finger pulls. */
@Composable
private fun Handle(pull: (Float) -> Unit, letGo: suspend CoroutineScope.(Float) -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(22.dp)
            .draggable(rememberDraggableState(pull), Orientation.Vertical, onDragStopped = letGo),
        contentAlignment = Alignment.TopCenter,
    ) {
        Box(Modifier.padding(top = 8.dp).size(width = 36.dp, height = 4.dp).background(Buddy.colors.line, RoundedCornerShape(2.dp)))
    }
}

@Composable
private fun Header(
    buddyName: String,
    appName: String,
    onSettings: () -> Unit,
    onClose: () -> Unit,
    onClaude: (() -> Unit)?,
    full: Boolean,
    setFull: ((Boolean) -> Unit)?,
) {
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
        onClaude?.let { ClaudeButton(it) }
        setFull?.let { set ->
            IconButton(onClick = { set(!full) }) {
                Icon(if (full) Smaller else Bigger, contentDescription = if (full) "Smaller" else "Full screen", Modifier.size(16.dp), tint = Buddy.colors.muted)
            }
        }
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
internal fun InputRow(draft: String, placeholder: String, canSend: Boolean, setDraft: (String) -> Unit, send: () -> Unit, micButton: @Composable () -> Unit) {
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
