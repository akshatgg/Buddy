package com.akshatgg.buddy.ui.claude

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.akshatgg.buddy.ui.panel.ClaudeCallbacks
import com.akshatgg.buddy.ui.panel.ClaudeState
import com.akshatgg.buddy.ui.panel.ClaudeView
import com.akshatgg.buddy.ui.panel.InputRow
import com.akshatgg.buddy.ui.panel.Primary
import com.akshatgg.buddy.ui.theme.Buddy
import com.akshatgg.buddy.ui.theme.ClaudeCliTheme

/** What the box says before a session is picked: its words would have nowhere to go. */
const val CLAUDE_PICK_FIRST = "Pick a session first…"

const val CLAUDE_SIGN_IN = "Sign in to Buddy first."
const val CLAUDE_SIGN_IN_WHY = "Your Claude Code sessions reach this phone through Buddy's server, with your account."

// An arrow back, for the bar; turned the other way where words run right to left.
private val BackArrow = ImageVector.Builder("back", 20.dp, 20.dp, 20f, 20f, autoMirror = true).addPath(
    pathData = addPathNodes("M16 10H4M4 10L9.5 4.5M4 10L9.5 15.5"),
    stroke = SolidColor(Color.Black),
    strokeLineWidth = 2f,
    strokeLineCap = StrokeCap.Round,
    strokeLineJoin = StrokeJoin.Round,
).build()

/**
 * Claude Code, Buddy's own screen for Claude mode, drawn as Claude Code's terminal (black, white, monospace): a bar with the way back, then the sessions to pick from (or the one
 * picked, live) and the box that types into it, with `micButton` in it. Signed out, it says to sign in first, and
 * `signIn` opens where that is done.
 */
@Composable
fun ClaudeScreen(
    state: ClaudeState,
    signedIn: Boolean,
    on: ClaudeCallbacks,
    back: () -> Unit,
    signIn: () -> Unit,
    micButton: @Composable () -> Unit = {},
) = ClaudeCliTheme { ClaudeScreenBody(state, signedIn, on, back, signIn, micButton) }

/** The screen in Claude Code's own look (ClaudeCliTheme): black, white, monospace, as the terminal and the Mac panel. */
@Composable
private fun ClaudeScreenBody(
    state: ClaudeState,
    signedIn: Boolean,
    on: ClaudeCallbacks,
    back: () -> Unit,
    signIn: () -> Unit,
    micButton: @Composable () -> Unit,
) {
    val colors = Buddy.colors
    // A Surface, so that every word on the screen is in the text colour, in light and dark.
    Surface(Modifier.fillMaxSize(), color = colors.card, contentColor = colors.fg) {
        Column(
            Modifier
                .fillMaxSize()
                // The status bar, the navigation bar and the keyboard: the box stays above the keyboard.
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .padding(start = 16.dp, end = 16.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(Modifier.padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = back) { Icon(BackArrow, contentDescription = "Back", Modifier.size(20.dp)) }
                Text("Claude Code", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleLarge, maxLines = 1)
            }
            if (signedIn) {
                ClaudeView(state, on, Modifier.weight(1f))
                InputRow(state.draft, state.placeholder ?: CLAUDE_PICK_FIRST, state.canSend, on.setDraft, on.send, micButton)
                state.boxError?.let { Text(it, color = colors.error, style = MaterialTheme.typography.bodySmall) }
            } else {
                SignedOut(signIn, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun SignedOut(signIn: () -> Unit, modifier: Modifier) {
    Column(
        modifier.fillMaxWidth().padding(top = 32.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(CLAUDE_SIGN_IN, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        Text(CLAUDE_SIGN_IN_WHY, color = Buddy.colors.muted, style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
        Primary("Sign in", onClick = signIn)
    }
}
