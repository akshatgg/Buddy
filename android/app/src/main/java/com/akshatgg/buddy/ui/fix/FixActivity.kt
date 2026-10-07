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

/** Keeps the one Fix, and its answer or error, through a turn of the phone. */
class FixViewModel : ViewModel() {
    // The panel's own request: one deadline, the buddy's moods, the errors whose fix is in Settings, and Try again.
    val model = PanelModel(AppGraph.instance.ask, viewModelScope, BubbleBus::send)
    private var started = false

    /** Asks once, with the text the other app gave; the sheet made again after a turn of the phone shows the same Fix. */
    fun start(text: String) {
        if (started) return
        started = true
        model.select(Tab.FIX)
        model.setFixText(text)
        model.submit()
    }
}

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
        val selected = intent.action == Intent.ACTION_PROCESS_TEXT
        // Sent as it is, however long: the router says when it is too long, in the Mac's words.
        val text = intent.getCharSequenceExtra(if (selected) Intent.EXTRA_PROCESS_TEXT else Intent.EXTRA_TEXT)?.toString().orEmpty()
        val canReplace = selected && !intent.getBooleanExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, false)
        val model = kept.model
        kept.start(text)
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
                FixScreen(state, canReplace, on)
            }
        }
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
