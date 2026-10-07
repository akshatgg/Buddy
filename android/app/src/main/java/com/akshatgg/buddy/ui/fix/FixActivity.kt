package com.akshatgg.buddy.ui.fix

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.bubble.BubbleBus
import com.akshatgg.buddy.ui.panel.PanelModel
import com.akshatgg.buddy.ui.panel.Tab
import com.akshatgg.buddy.ui.panel.copyAnswer
import com.akshatgg.buddy.ui.panel.openSettingsFor
import com.akshatgg.buddy.ui.theme.BuddyTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Keeps the Fix, and its answer or error, through a turn of the phone. */
class FixViewModel : ViewModel() {
    // The panel's own request: one deadline, the buddy's moods, the errors whose fix is in Settings, and Try again.
    val model = PanelModel(AppGraph.instance.ask, viewModelScope, BubbleBus::send)
    private val replaceable = MutableStateFlow(false)
    private var started = false

    /** Whether Replace shows. Kept with the Fix, since a newer text can come to the sheet after it opens. */
    val canReplace: StateFlow<Boolean> = replaceable.asStateFlow()

    /** Asks once, with the text the other app gave; the sheet made again after a turn of the phone shows the same Fix. */
    fun start(text: String, canReplace: Boolean) {
        if (started) return
        started = true
        replaceable.value = canReplace
        model.select(Tab.FIX)
        model.setFixText(text)
        model.submit()
    }

    /**
     * A new text for the sheet that is still open (a second Share → Buddy): the last Fix is let go of, as the panel's
     * reset() lets go of an earlier opening, and the new text is asked at once.
     */
    fun restart(text: String, canReplace: Boolean) {
        model.reset()
        started = false
        start(text, canReplace)
    }
}

// Sent as it is, however long: the router says when it is too long, in the Mac's words.
private fun textOf(intent: Intent): String {
    val key = if (intent.action == Intent.ACTION_PROCESS_TEXT) Intent.EXTRA_PROCESS_TEXT else Intent.EXTRA_TEXT
    return intent.getCharSequenceExtra(key)?.toString().orEmpty()
}

// Only a selection the app lets Buddy change can be replaced: shared or read-only text can only be copied.
private fun replaceable(intent: Intent) =
    intent.action == Intent.ACTION_PROCESS_TEXT && !intent.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, false)

/**
 * "Fix with Buddy" in any app's text menu, and Share → Buddy: a sheet over that app that fixes the text at once.
 * Replace hands the fixed text back to the app, which puts it in place of the selection; text the app does not let
 * Buddy change (read-only, or shared) can only be copied.
 */
class FixActivity : ComponentActivity() {
    private val kept: FixViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val model = kept.model
        kept.start(textOf(intent), replaceable(intent))
        val on = FixCallbacks(
            replace = ::replace,
            copy = ::copy,
            retry = model::retry,
            openSettings = {
                openSettingsFor(it.code)
                finish()
            },
            close = ::finish,
        )
        setContent {
            BuddyTheme {
                val state by model.state.collectAsStateWithLifecycle()
                val canReplace by kept.canReplace.collectAsStateWithLifecycle()
                FixScreen(state, canReplace, on)
            }
        }
    }

    /**
     * Share → Buddy again while this sheet is still open, behind the app the last share came from: Android brings
     * this sheet back with the new text (it is singleTop), and the sheet fixes that text, not the last one.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        kept.restart(textOf(intent), replaceable(intent))
    }

    // The buddy steps out of the sheet's way while it is on screen, as for the panel.
    override fun onStart() {
        super.onStart()
        BubbleBus.sheetShown(kept)
    }

    override fun onStop() {
        if (!isChangingConfigurations) BubbleBus.sheetGone(kept)
        super.onStop()
    }

    private fun replace(fixed: String) {
        setResult(RESULT_OK, Intent().putExtra(Intent.EXTRA_PROCESS_TEXT, fixed))
        finish()
    }

    private fun copy(fixed: String) {
        copyAnswer(fixed)
        finish()
    }
}
