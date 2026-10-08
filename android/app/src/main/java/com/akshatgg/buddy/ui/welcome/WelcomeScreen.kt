package com.akshatgg.buddy.ui.welcome

import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.akshatgg.buddy.ai.aiSection
import com.akshatgg.buddy.bubble.Mood
import com.akshatgg.buddy.cloud.FreeSettings
import com.akshatgg.buddy.ui.common.AiForm
import com.akshatgg.buddy.ui.common.AiFormModel
import com.akshatgg.buddy.ui.common.BuddyPicker
import com.akshatgg.buddy.ui.common.HeadPreview
import com.akshatgg.buddy.ui.common.Note
import com.akshatgg.buddy.ui.common.StatusLine
import com.akshatgg.buddy.ui.common.openFloatSettings
import com.akshatgg.buddy.ui.common.rememberAllowed
import com.akshatgg.buddy.ui.panel.Primary
import com.akshatgg.buddy.ui.panel.ROUNDED
import com.akshatgg.buddy.ui.panel.Secondary
import com.akshatgg.buddy.ui.theme.Buddy
import com.akshatgg.buddy.ui.theme.BuddyRadius
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow

/** What the Welcome asks of Android. MainActivity wires them; a test leaves them be. */
class WelcomeCallbacks(
    /** Google's account picker, then the free-mode settings. */
    val signIn: () -> Unit = {},
    val askNotifications: () -> Unit = {},
    /** The last step's button: save, turn Buddy on, and get out of the way. */
    val done: () -> Unit = {},
)

/**
 * The Welcome, as the Mac's: one step at a time on a card, the steps as dots above it, and Back and Next below it.
 * The card fills the room between them, so from one step to the next only what is on the card changes.
 */
@Composable
fun WelcomeScreen(model: WelcomeModel, free: StateFlow<FreeSettings?>, ai: AiFormModel, on: WelcomeCallbacks) {
    val state by model.state.collectAsStateWithLifecycle(context = Dispatchers.Main.immediate)
    val freeNow by free.collectAsStateWithLifecycle()
    // Back goes to the step before, as the Back button does; on the first step it leaves the app.
    BackHandler(enabled = state.index > 0) { model.back() }
    val colors = Buddy.colors
    // A Surface, so that every word on the page is in the text colour, in light and dark.
    Surface(Modifier.fillMaxSize(), color = colors.bg, contentColor = colors.fg) {
        Box(contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier
                    .widthIn(max = 520.dp)
                    .fillMaxSize()
                    .windowInsetsPadding(WindowInsets.safeDrawing) // the keyboard too: Back and Next stay above it
                    .padding(horizontal = 16.dp, vertical = 16.dp),
            ) {
                Dots(state)
                Column(
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .background(colors.card, RoundedCornerShape(BuddyRadius))
                        .border(1.dp, colors.lineSoft, RoundedCornerShape(BuddyRadius))
                        .verticalScroll(rememberScrollState())
                        .padding(horizontal = 20.dp, vertical = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    when (state.step) {
                        Step.SIGN_IN -> SignInStep(state, on)
                        Step.BUDDY -> BuddyStep(state, model)
                        Step.FLOAT -> FloatStep(state.floatNote, on, model::next)
                        Step.AI -> AiStep(aiSection(freeNow).note, ai)
                        Step.DONE -> DoneStep(state)
                    }
                }
                state.finishError?.let {
                    Spacer(Modifier.size(12.dp))
                    Note(it, error = true)
                }
                Row(Modifier.fillMaxWidth().padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (state.index > 0) Secondary("Back", modifier = Modifier.widthIn(min = 88.dp), onClick = model::back)
                    Spacer(Modifier.weight(1f))
                    if (state.step == Step.DONE) {
                        Primary("Start my buddy", modifier = Modifier.widthIn(min = 88.dp), onClick = on.done)
                    } else {
                        Primary("Next", enabled = state.canGoNext, modifier = Modifier.widthIn(min = 88.dp)) { model.next() }
                    }
                }
            }
        }
    }
}

/** A dot for each step: the ones done, the one shown (longer, in the accent) and the ones to come. */
@Composable
private fun Dots(state: WelcomeState) {
    val colors = Buddy.colors
    Row(
        Modifier.fillMaxWidth().padding(bottom = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
    ) {
        state.steps.forEachIndexed { i, _ ->
            val color = when {
                i < state.index -> colors.accent.copy(alpha = 0.7f)
                i == state.index -> colors.accent
                else -> colors.fg.copy(alpha = 0.4f)
            }
            Box(
                Modifier
                    .size(width = if (i == state.index) 22.dp else 6.dp, height = 6.dp)
                    .background(color, RoundedCornerShape(3.dp))
                    .semantics { contentDescription = "Step ${i + 1} of ${state.steps.size}" },
            )
        }
    }
}

@Composable
private fun Heading(text: String) {
    Text(text, fontSize = 22.sp, fontWeight = FontWeight.SemiBold, lineHeight = 28.sp)
}

@Composable
private fun Body(text: String, muted: Boolean = false) {
    Text(text, color = if (muted) Buddy.colors.muted else Buddy.colors.fg, style = MaterialTheme.typography.bodyLarge)
}

/** Allowed, in green, where the button was: "Allowed ✓". */
@Composable
private fun Allowed() {
    Text(
        "Allowed ✓",
        Modifier.fillMaxWidth().background(Buddy.colors.goodSoft, ROUNDED).padding(horizontal = 12.dp, vertical = 10.dp),
        color = Buddy.colors.good,
        fontWeight = FontWeight.Medium,
    )
}

@Composable
private fun ColumnScope.SignInStep(state: WelcomeState, on: WelcomeCallbacks) {
    HeadPreview(state.characterId, Modifier.size(150.dp).align(Alignment.CenterHorizontally), mood = Mood.WAVE)
    Heading("Hi! I'm Buddy. I help you write in English.")
    Body("Sign in with your Google account. Buddy only learns your name and your email address.")
    Spacer(Modifier.size(8.dp))
    val user = state.user
    if (user == null) {
        Primary("Sign in with Google", enabled = !state.signingIn, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp), onClick = on.signIn)
        StatusLine(state.signInStatus)
    } else {
        // Where the button was, at its size, so nothing on the step moves.
        Text(
            "Signed in as ${user.email} ✓",
            Modifier.fillMaxWidth().heightIn(min = 48.dp).background(Buddy.colors.goodSoft, ROUNDED).padding(horizontal = 12.dp, vertical = 13.dp),
            color = Buddy.colors.good,
        )
    }
}

@Composable
private fun BuddyStep(state: WelcomeState, model: WelcomeModel) {
    Heading("Pick your buddy")
    Body("You can change this any time in Settings.", muted = true)
    Spacer(Modifier.size(8.dp))
    BuddyPicker(state.characterId, onPick = model::pick)
    Spacer(Modifier.size(8.dp))
    Text("Give your buddy a name", style = MaterialTheme.typography.bodyMedium)
    OutlinedTextField(
        value = state.name,
        onValueChange = model::setName,
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
        shape = ROUNDED,
    )
}

@Composable
private fun FloatStep(note: String?, on: WelcomeCallbacks, skip: () -> Unit) {
    val allowed by rememberAllowed()
    val context = LocalContext.current
    Heading("Let Buddy float")
    Body("Buddy floats over your apps so you can tap it anywhere.")
    if (allowed.float) Allowed() else Primary("Allow", modifier = Modifier.fillMaxWidth()) { context.openFloatSettings() }
    // Sent back here by "Start my buddy": why, until it is allowed.
    if (note != null && !allowed.float) Note(note, error = true)
    // Android 13 and later ask for notifications: without them the notification's "Turn off" is not shown.
    if (Build.VERSION.SDK_INT >= 33) {
        Spacer(Modifier.size(12.dp))
        Body("While it is on, Buddy shows a notification you can turn it off from.")
        if (allowed.notifications) {
            Allowed()
        } else {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Secondary("Allow notifications", onClick = on.askNotifications)
                Spacer(Modifier.width(8.dp))
                TextButton(onClick = { skip() }, shape = ROUNDED) { Text("Skip") }
            }
        }
    }
}

@Composable
private fun AiStep(note: String, ai: AiFormModel) {
    Heading("Connect an AI")
    Body("Your buddy uses an AI to write. Pick one and paste your API key. You can also do this later in Settings.")
    if (note.isNotEmpty()) Note(note)
    Spacer(Modifier.size(4.dp))
    AiForm(ai)
}

@Composable
private fun ColumnScope.DoneStep(state: WelcomeState) {
    HeadPreview(state.characterId, Modifier.size(150.dp).align(Alignment.CenterHorizontally), mood = Mood.HAPPY)
    Heading("${state.name.trim().ifEmpty { defaultName(state.characterId) }} is ready")
    Body("It floats over your apps. Tap it any time to write, fix or check your English.")
}
