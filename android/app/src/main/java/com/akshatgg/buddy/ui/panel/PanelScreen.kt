package com.akshatgg.buddy.ui.panel

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.akshatgg.buddy.ai.CheckResult
import com.akshatgg.buddy.ui.theme.Buddy
import com.akshatgg.buddy.ui.theme.BuddyRadius

/** What the panel's boxes and buttons do. PanelActivity wires them to PanelModel and to Android; a test leaves them be. */
class PanelCallbacks(
    val select: (Tab) -> Unit = {},
    val setInstruction: (String) -> Unit = {},
    val setTone: (String) -> Unit = {},
    val setFixText: (String) -> Unit = {},
    val paste: () -> Unit = {},
    val setQuestion: (String) -> Unit = {},
    val takePicture: () -> Unit = {},
    val submit: () -> Unit = {},
    val copy: (String) -> Unit = {},
    val share: (String) -> Unit = {},
    val retry: () -> Unit = {},
    /** The error's own "Open Settings": to the part of Settings that fixes it. */
    val openSettings: (PanelError) -> Unit = {},
    /** The ⚙ in the header. */
    val settings: () -> Unit = {},
    val close: () -> Unit = {},
)

private val TONES = listOf("formal" to "Formal", "friendly" to "Friendly", "short" to "Short")
private val TABS = listOf(Tab.WRITE to "Write for me", Tab.FIX to "Fix my English", Tab.CHECK to "Check screen")

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

/** The words an answer gives to Copy and Share: a Check's corrected text, or its own words when it gave no verdict. */
fun answerText(state: PanelState): String {
    val answer = state.answer ?: return ""
    if (state.tab != Tab.CHECK) return answer.text
    return when (val check = answer.check) {
        is CheckResult.Verdict -> check.corrected.orEmpty()
        is CheckResult.Raw -> check.text
        null -> answer.text
    }
}

/**
 * The panel: a card at the bottom of the screen with the buddy's name, the three tabs, and the answer, in the Mac
 * panel's order and words.
 */
@Composable
fun PanelScreen(state: PanelState, buddyName: String, on: PanelCallbacks) {
    Sheet(on.close) {
        Header(buddyName, on.settings)
        Segmented(TABS, state.tab, on.select, Role.Tab)
        when (state.tab) {
            Tab.WRITE -> WriteTab(state, on)
            Tab.FIX -> FixTab(state, on)
            Tab.CHECK -> CheckTab(state, on)
        }
        if (state.busy) Busy()
        state.error?.let { ErrorLine(it, on.openSettings) }
        if (state.answer != null) AnswerSection(state, on)
    }
}

/**
 * Buddy's card over whatever app is on screen, at the bottom, with a handle bar: the panel's, and the Fix sheet's. A
 * tap outside the card closes it, as a click anywhere else hides the Mac's panel.
 */
@Composable
internal fun Sheet(onClose: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val colors = Buddy.colors
    Box(Modifier.fillMaxSize()) {
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
                .padding(16.dp)
                .widthIn(max = 420.dp)
                .fillMaxWidth(),
            shape = RoundedCornerShape(14.dp),
            color = colors.card,
            contentColor = colors.fg,
            border = BorderStroke(1.dp, colors.line),
            shadowElevation = 6.dp,
        ) {
            Column(
                Modifier.verticalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
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
private fun Header(buddyName: String, onSettings: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Buddy", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
        Text(
            " · $buddyName",
            Modifier.weight(1f),
            color = Buddy.colors.muted,
            style = MaterialTheme.typography.titleMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        IconButton(onClick = onSettings) {
            Icon(Gear, contentDescription = "Settings", Modifier.size(18.dp), tint = Buddy.colors.muted)
        }
    }
}

/** The Mac's segmented control: a groove with the chosen segment raised in it, and hairlines between the others. */
@Composable
private fun <T> Segmented(options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit, role: Role, modifier: Modifier = Modifier) {
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

@Composable
private fun Field(value: String, onChange: (String) -> Unit, placeholder: String, lines: IntRange) {
    OutlinedTextField(
        value = value,
        onValueChange = onChange,
        modifier = Modifier.fillMaxWidth(),
        // A one-line box keeps its hint to one line too, rather than growing a line it loses when the person types.
        placeholder = { Text(placeholder, maxLines = if (lines.last == 1) 1 else Int.MAX_VALUE, overflow = TextOverflow.Ellipsis) },
        minLines = lines.first,
        maxLines = lines.last,
        singleLine = lines.last == 1,
        shape = RoundedCornerShape(BuddyRadius),
    )
}

internal val ROUNDED = RoundedCornerShape(BuddyRadius)
private val BUTTON_PADDING = PaddingValues(horizontal = 16.dp, vertical = 8.dp)

@Composable
internal fun Primary(label: String, enabled: Boolean = true, onClick: () -> Unit) {
    Button(onClick, enabled = enabled, shape = ROUNDED, contentPadding = BUTTON_PADDING) { Text(label, fontWeight = FontWeight.Medium) }
}

@Composable
internal fun Secondary(label: String, onClick: () -> Unit) {
    OutlinedButton(
        onClick,
        shape = ROUNDED,
        contentPadding = BUTTON_PADDING,
        border = BorderStroke(1.dp, Buddy.colors.line),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = Buddy.colors.fg),
    ) { Text(label) }
}

@Composable
private fun WriteTab(state: PanelState, on: PanelCallbacks) {
    Field(state.instruction, on.setInstruction, "What should I write? e.g. boss ko mail, kal chutti chahiye", 3..6)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Segmented(TONES, state.tone, on.setTone, Role.RadioButton, Modifier.weight(1f))
        Primary("Write", enabled = !state.busy, onClick = on.submit)
    }
}

@Composable
private fun FixTab(state: PanelState, on: PanelCallbacks) {
    Field(state.fixText, on.setFixText, "Text to fix", 3..6)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Secondary("Paste", on.paste)
        Spacer(Modifier.weight(1f))
        Primary("Fix", enabled = !state.busy, onClick = on.submit)
    }
    Text("Tip: select text in any app and tap Fix with Buddy.", color = Buddy.colors.muted, style = MaterialTheme.typography.bodySmall)
}

@Composable
private fun CheckTab(state: PanelState, on: PanelCallbacks) {
    state.screenshot?.let { shot ->
        // With an answer under it, the picture shrinks, so that the answer and its buttons stay in view.
        Image(
            shot.asImageBitmap(),
            contentDescription = "Picture of your screen",
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = if (state.answer != null) 56.dp else 120.dp)
                .border(1.dp, Buddy.colors.line, RoundedCornerShape(7.dp))
                .background(Buddy.colors.bg, RoundedCornerShape(7.dp))
                .padding(1.dp),
            contentScale = ContentScale.Fit,
        )
    }
    Field(state.question, on.setQuestion, "Ask something (optional), e.g. is this mail okay?", 1..1)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Secondary("Take a picture of the screen", on.takePicture)
        Spacer(Modifier.weight(1f))
        Primary("Check", enabled = !state.busy, onClick = on.submit)
    }
}

@Composable
internal fun Busy() {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp), color = Buddy.colors.accent, trackColor = Buddy.colors.track)
        Text("Buddy is thinking…", color = Buddy.colors.muted, style = MaterialTheme.typography.bodyMedium)
    }
}

/** What went wrong, in the error colour on its soft tint, with the way to Settings beside it when the fix is there. */
@Composable
internal fun ErrorLine(error: PanelError, onOpenSettings: (PanelError) -> Unit) {
    val colors = Buddy.colors
    Row(
        Modifier.fillMaxWidth().background(colors.errorSoft, RoundedCornerShape(7.dp)).padding(start = 12.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(error.message, Modifier.weight(1f).padding(vertical = 4.dp), color = colors.error, style = MaterialTheme.typography.bodyMedium)
        if (error.showSettings) Secondary("Open Settings") { onOpenSettings(error) }
    }
}

@Composable
private fun Label(text: String) {
    Text(text, color = Buddy.colors.muted, style = MaterialTheme.typography.labelLarge)
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

@Composable
private fun AnswerSection(state: PanelState, on: PanelCallbacks) {
    val answer = state.answer ?: return
    val colors = Buddy.colors
    when (state.tab) {
        Tab.WRITE -> AnswerText(answer.text)
        Tab.FIX -> {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Label("Before")
                Text(state.original, color = colors.muted, style = MaterialTheme.typography.bodyMedium)
            }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Label("After")
                AnswerText(answer.text)
            }
        }
        Tab.CHECK -> when (val check = answer.check) {
            is CheckResult.Verdict -> {
                Text(
                    if (check.good) "Looks good ✓" else "Has problems",
                    Modifier.background(if (check.good) colors.goodSoft else colors.errorSoft, RoundedCornerShape(11.dp))
                        .padding(horizontal = 10.dp, vertical = 3.dp),
                    color = if (check.good) colors.good else colors.error,
                    fontWeight = FontWeight.Medium,
                    style = MaterialTheme.typography.labelLarge,
                )
                if (check.problems.isNotEmpty()) {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        for (problem in check.problems) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("•", color = colors.error)
                                Text(problem, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }
                check.corrected?.let {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Label("Corrected")
                        AnswerText(it)
                    }
                }
            }
            is CheckResult.Raw -> AnswerText(check.text)
            null -> AnswerText(answer.text)
        }
    }
    val text = answerText(state)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        if (text.isNotEmpty()) {
            Primary("Copy") { on.copy(text) }
            if (state.tab != Tab.CHECK) Secondary("Share") { on.share(text) }
        }
        Spacer(Modifier.weight(1f))
        TextButton(on.retry, enabled = !state.busy, shape = ROUNDED) { Text("Try again") }
    }
}
