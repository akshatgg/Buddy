package com.akshatgg.buddy.ui.panel

import android.annotation.SuppressLint
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.bubble.BubbleBus
import com.akshatgg.buddy.ui.claude.ClaudeActivity
import com.akshatgg.buddy.ui.theme.BuddyTheme
import kotlinx.coroutines.Dispatchers
import androidx.compose.runtime.remember
import com.akshatgg.buddy.voice.MicButton

/**
 * The panel the buddy opens when it is tapped: the chat (PanelModel), in an activity rather than an overlay, so that
 * the keyboard works as in any app. It is a card over whatever was on screen, kept out of Recents, which its handle
 * pulls up to the whole screen (and the next panel opens so). ✕, Back, a tap outside the card or a pull down on its
 * handle closes it, and the chat ends. When Buddy puts text in the app it steps aside instead (it goes behind
 * that app): a tap on the buddy within five minutes brings it back on the same chat.
 */
class PanelActivity : ComponentActivity(), ChatHost {
    private val kept: ChatViewModel by viewModels()
    private val model: PanelModel get() = kept.model
    private val settings = AppGraph.instance.settings
    // Full screen or the card, as the person left the last panel.
    private var full by mutableStateOf(settings.panelFull)

    // Lint reads Fragment 1.2.5 from the compile classpath (the app runs with 1.5.7), and the check is about a
    // FragmentActivity before 1.3.0 losing results: the panel is a plain ComponentActivity.
    @SuppressLint("InvalidFragmentVersionForActivityResult")
    override val consent: ActivityResultLauncher<Intent> =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { kept.pictureAnswered(it) }

    override val activity: ComponentActivity get() = this

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        kept.host = this
        // A turn of the phone makes the activity again on the same chat; only a new panel starts one.
        if (savedInstanceState == null) model.open()
        val buddyName = settings.buddyName
        // The Claude button only for a person signed in: Claude mode reaches their computers through Buddy's server.
        fun callbacks(signedIn: Boolean) = PanelCallbacks(
            setDraft = model::setDraft,
            send = model::send,
            dropSelection = model::dropSelection,
            press = model::press,
            settings = { openSettingsFor(null) },
            close = ::finish,
            claude = if (signedIn) ::openClaude else null,
            setFull = ::fillScreen,
        )
        setContent {
            BuddyTheme {
                // Collected without a hop through the main queue, so that the box always shows what was just typed.
                val state by model.state.collectAsStateWithLifecycle(context = Dispatchers.Main.immediate)
                val user by AppGraph.instance.account.user.collectAsStateWithLifecycle()
                val signedIn = user != null
                // One recorder for this screen; its words go into the box, its refusals become a line in the chat.
                val voice = remember { AppGraph.instance.voiceFactory(applicationContext) }
                val on = remember(signedIn) { callbacks(signedIn) }
                PanelScreen(state, buddyName, on, full) {
                    MicButton(voice, onWords = model::voiceWords, onError = model::voiceError)
                }
            }
        }
    }

    /** The card to the whole screen or back, and the next panel opens the same way. */
    private fun fillScreen(on: Boolean) {
        full = on
        settings.panelFull = on
    }

    /** Claude Code on its own screen, in Buddy: the panel closes, as the person has gone there. */
    private fun openClaude() {
        startActivity(ClaudeActivity.intent(this))
        finish()
    }

    override fun onDestroy() {
        if (kept.host === this) kept.host = null
        super.onDestroy()
    }

    // The buddy steps out of the panel's way while it is on screen. A turn of the phone stops this activity and starts
    // the next one at once: the buddy stays hidden through it.
    override fun onStart() {
        super.onStart()
        BubbleBus.sheetShown(kept)
        model.shown()
    }

    override fun onStop() {
        if (!isChangingConfigurations) {
            BubbleBus.sheetGone(kept)
            if (!isFinishing) model.hidden() // behind the app: the chat waits five minutes
        }
        super.onStop()
    }

    /** The buddy tapped while the panel was behind the app: the same chat if it is recent, else a new one. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        model.open()
    }

    /** Behind the app the panel was opened over: its task goes to the back, and the chat stays. */
    override fun stepAside() {
        moveTaskToBack(true)
    }
}
