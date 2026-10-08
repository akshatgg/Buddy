package com.akshatgg.buddy.voice

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

private fun noMicrophone() = BuddyError("no_microphone", "Buddy needs the microphone to hear you. Allow it in Settings.")

/**
 * What the 🎤 button's presses do, in plain Kotlin so that it is tested on the JVM: 🎤 starts recording, and with it
 * the 60 s stop; ■ stops; leaving the screen cancels. The words go to `onWords`, a failure to `onError`; a dropped step
 * says nothing.
 */
class MicPresses(
    private val voice: Voice,
    private val scope: CoroutineScope,
    private val onWords: (String) -> Unit,
    private val onError: (BuddyError) -> Unit,
) {
    private var limit: Job? = null // the 60 s stop of the recording now

    /** 🎤, with the microphone allowed. */
    fun talk() {
        step {
            voice.start()
            limit = step { voice.stopAtLimit() }
            null
        }
    }

    /**
     * ■. Only while recording: when the 60 s stop has just begun (the button not yet turned into the spinner), the
     * press is let go of, and the words come from that stop, which goes on.
     */
    fun stop() {
        if (voice.state.value != VoiceState.Recording) return
        limit?.cancel()
        limit = null
        step { voice.stop() }
    }

    /** The screen went away: the microphone stops and nothing is sent. */
    fun leave() {
        limit?.cancel()
        limit = null
        voice.cancel()
    }

    private fun step(block: suspend () -> String?): Job = scope.launch {
        try {
            block()?.let(onWords)
        } catch (e: BuddyError) {
            onError(e)
        }
    }
}

/**
 * 🎤 in the box: press to talk, ■ to stop (or it stops by itself at 60 s), a small spinner while the words are written
 * down; they go to `onWords`, for the box. The first press asks for the microphone. Leaving the screen (closed, or only
 * stopped behind another app) stops at once and sends nothing.
 */
@Composable
fun MicButton(voice: Voice, onWords: (String) -> Unit, onError: (BuddyError) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val state by voice.state.collectAsState()
    val scope = rememberCoroutineScope()
    val words by rememberUpdatedState(onWords)
    val error by rememberUpdatedState(onError)
    val presses = remember(voice, scope) { MicPresses(voice, scope, { words(it) }, { error(it) }) }

    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
        if (allowed) presses.talk() else error(noMicrophone())
    }

    DisposableEffect(presses) {
        onDispose { presses.leave() }
    }
    // The panel only stopped (it stepped aside for the app, Home, another app on top): it is no longer on screen, so
    // the microphone stops at once, as when it closes.
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { presses.leave() }

    when (state) {
        VoiceState.Idle -> IconButton(
            onClick = {
                val allowed = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                if (allowed) presses.talk() else ask.launch(Manifest.permission.RECORD_AUDIO)
            },
            modifier = modifier.semantics { contentDescription = "Talk" },
        ) { Text("🎤") }
        VoiceState.Recording -> IconButton(
            onClick = presses::stop,
            modifier = modifier.semantics { contentDescription = "Stop listening" },
        ) { Text("■") }
        VoiceState.Sending -> IconButton(
            onClick = {},
            enabled = false,
            modifier = modifier.semantics { contentDescription = "Writing down what you said" },
        ) { CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) }
    }
}
