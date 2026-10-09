package com.akshatgg.buddy.ui.fix

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
import com.akshatgg.buddy.ui.panel.ChatHost
import com.akshatgg.buddy.ui.panel.ChatViewModel
import com.akshatgg.buddy.ui.panel.PanelCallbacks
import com.akshatgg.buddy.ui.panel.PanelScreen
import com.akshatgg.buddy.ui.panel.openSettingsFor
import com.akshatgg.buddy.ui.theme.BuddyTheme
import kotlinx.coroutines.Dispatchers
import androidx.compose.runtime.remember
import com.akshatgg.buddy.voice.MicButton

// Sent as it is, however long: the chat says when it is too long. Any app can send this sheet anything, and extras it
// packed badly (a class Buddy does not have) throw when read: that is no text, not a crash.
private fun textOf(intent: Intent): String {
    val key = if (intent.action == Intent.ACTION_PROCESS_TEXT) Intent.EXTRA_PROCESS_TEXT else Intent.EXTRA_TEXT
    return runCatching { intent.getCharSequenceExtra(key)?.toString() }.getOrNull().orEmpty()
}

// Only a selection the app lets Buddy change can be replaced, and only when the app waits for the fixed text (`waiting`:
// it started the sheet for a result). Compose's text menu, in Buddy's own boxes and in other apps, starts it without
// waiting, so Replace would change nothing there. Shared or read-only text can only be copied (or put in the box through
// "Buddy can type for you"), and so can text whose read-only flag cannot be read.
private fun replaceable(intent: Intent, waiting: Boolean) = waiting && intent.action == Intent.ACTION_PROCESS_TEXT &&
    runCatching { intent.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, false) }.getOrNull() == false

/**
 * "Fix with Buddy" in any app's text menu, and Share → Buddy: the chat, as in the panel, over that app, with the text
 * as its selection (↩ in an empty box fixes it). Replace hands the fixed text back to the app, which puts it in place
 * of the selection, when the app allows it; otherwise the text goes in through "Buddy can type for you", or is copied.
 * It opens in the task of the app that asked, so it closes when it steps aside (its chat ends with it).
 */
class FixActivity : ComponentActivity(), ChatHost {
    private val kept: ChatViewModel by viewModels()
    private val settings = AppGraph.instance.settings
    // Full screen or the card, as the panel: the person's last choice in either.
    private var full by mutableStateOf(settings.panelFull)

    @SuppressLint("InvalidFragmentVersionForActivityResult") // as in PanelActivity: a plain ComponentActivity
    override val consent: ActivityResultLauncher<Intent> =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { kept.pictureAnswered(it) }

    override val activity: ComponentActivity get() = this

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        kept.host = this
        val model = kept.model
        // The sheet made again after a turn of the phone shows the same chat.
        if (savedInstanceState == null) model.open(selection = textOf(intent), replaceable = replaceable(intent, waiting = callingActivity != null))
        val buddyName = settings.buddyName
        val on = PanelCallbacks(
            setDraft = model::setDraft,
            send = model::send,
            dropSelection = model::dropSelection,
            press = model::press,
            settings = { openSettingsFor(null) },
            close = ::finish,
            setFull = { on ->
                full = on
                settings.panelFull = on
            },
        )
        setContent {
            BuddyTheme {
                val state by model.state.collectAsStateWithLifecycle(context = Dispatchers.Main.immediate)
                // One recorder for this screen; its words go into the box, its refusals become a line in the chat.
                val voice = remember { AppGraph.instance.voiceFactory(applicationContext) }
                PanelScreen(state, buddyName, on, full) {
                    MicButton(voice, onWords = model::voiceWords, onError = model::voiceError)
                }
            }
        }
    }

    override fun onDestroy() {
        if (kept.host === this) kept.host = null
        super.onDestroy()
    }

    /**
     * Share → Buddy again while this sheet is still open, behind the app the last share came from: Android brings
     * this sheet back with the new text (it is singleTop), and a new chat starts with it. A selection's "Fix with
     * Buddy" reaches the open sheet only from its own box: it does not take it over.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action != Intent.ACTION_SEND) return
        setIntent(intent)
        kept.model.open(selection = textOf(intent), replaceable = false) // shared text cannot be handed back
    }

    // The buddy steps out of the sheet's way while it is on screen, as for the panel.
    override fun onStart() {
        super.onStart()
        BubbleBus.sheetShown(kept)
        kept.model.shown()
    }

    override fun onStop() {
        if (!isChangingConfigurations) {
            BubbleBus.sheetGone(kept)
            if (!isFinishing) kept.model.hidden()
        }
        super.onStop()
    }

    /** The sheet is in the other app's task: it closes, and Buddy finishes its work in the app without it. */
    override fun stepAside() {
        finish()
    }

    override fun replace(text: String) {
        setResult(RESULT_OK, Intent().putExtra(Intent.EXTRA_PROCESS_TEXT, text))
        finish()
    }
}
