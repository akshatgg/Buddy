package com.akshatgg.buddy.ui.claude

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.ui.panel.ClaudeCallbacks
import com.akshatgg.buddy.ui.panel.ClaudeModel
import com.akshatgg.buddy.ui.panel.openSettingsFor
import com.akshatgg.buddy.ui.theme.BuddyTheme
import com.akshatgg.buddy.voice.MicButton
import kotlinx.coroutines.Dispatchers

/**
 * Keeps Claude mode (ClaudeModel) through a turn of the phone. Its looks and its "stop" run in the app's scope, not
 * this ViewModel's, so that the stop sent as the screen closes still goes.
 */
class ClaudeViewModel : ViewModel() {
    private val graph = AppGraph.instance

    val claude = ClaudeModel(
        look = { graph.cloud.remoteLook(it) },
        send = { session, text -> graph.cloud.remoteSend(session, text) },
        stop = { graph.cloud.remoteStop() },
        scope = graph.scope,
    )

    /** The screen was closed: the phone stops looking, and the computer stops sending. */
    override fun onCleared() {
        claude.close()
    }
}

/**
 * Claude Code, on Buddy's own screen: the Claude Code sessions the person's computers share through Buddy's server, one
 * of them live, and the box that types into it. The panel's Claude button opens it (and the panel closes), and so does
 * the shortcut on Buddy's icon (a long press → Claude Code). It is its own task, so that Back and the bar's arrow go
 * back to where the person was rather than to Settings. The session shown is looked at only while the screen is in
 * view.
 */
class ClaudeActivity : ComponentActivity() {
    private val kept: ClaudeViewModel by viewModels()
    private val claude: ClaudeModel get() = kept.claude

    override fun onCreate(savedInstanceState: Bundle?) {
        // Black like Claude Code's terminal, whatever the phone's light or dark: light icons in the bars over it.
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        val on = ClaudeCallbacks(
            open = claude::open,
            list = claude::list,
            setDraft = claude::setDraft,
            send = claude::send,
        )
        setContent {
            BuddyTheme {
                // Collected without a hop through the main queue, so that the box always shows what was just typed.
                val state by claude.state.collectAsStateWithLifecycle(context = Dispatchers.Main.immediate)
                val user by AppGraph.instance.account.user.collectAsStateWithLifecycle()
                val signedIn = user != null
                // Signed in, the sessions are asked for (the screen made again after a turn stays where it was);
                // signed out meanwhile, Claude mode ends, as it cannot reach the computers any more.
                LaunchedEffect(signedIn) { if (signedIn) claude.enter() else claude.leave() }
                // One recorder for this screen; its words go into the box, its refusals under it.
                val voice = remember { AppGraph.instance.voiceFactory(applicationContext) }
                ClaudeScreen(
                    state,
                    signedIn,
                    on,
                    back = ::finish,
                    // Settings at the account, or the Welcome when Buddy is not set up yet: both sign in.
                    signIn = { openSettingsFor("signed_out") },
                ) {
                    MicButton(voice, onWords = claude::voiceWords, onError = claude::voiceError)
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        claude.shown()
    }

    // A turn of the phone stops this activity and starts the next one at once: the looks go on through it.
    override fun onStop() {
        if (!isChangingConfigurations) claude.hidden()
        super.onStop()
    }

    companion object {
        /** The screen, from the panel: in its own task, as the panel's is apart and closes. */
        fun intent(context: Context): Intent = Intent(context, ClaudeActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}
