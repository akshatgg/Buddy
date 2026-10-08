package com.akshatgg.buddy.ui

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.bubble.BubbleService
import com.akshatgg.buddy.ui.common.AiFormModel
import com.akshatgg.buddy.ui.common.askForNotifications
import com.akshatgg.buddy.ui.common.signInWithGoogle
import com.akshatgg.buddy.ui.settings.SectionRequest
import com.akshatgg.buddy.ui.settings.SettingsCallbacks
import com.akshatgg.buddy.ui.settings.SettingsModel
import com.akshatgg.buddy.ui.settings.SettingsScreen
import com.akshatgg.buddy.ui.theme.BuddyTheme
import com.akshatgg.buddy.ui.welcome.WelcomeCallbacks
import com.akshatgg.buddy.ui.welcome.WelcomeModel
import com.akshatgg.buddy.ui.welcome.WelcomeScreen
import kotlinx.coroutines.launch

// The panel's and the Fix sheet's "Open Settings" name the part of Settings that fixes the error: "ai", "account" or
// "buddy" (SheetActions.kt).
private const val SECTION = "section"

/**
 * Keeps the Welcome's steps, Settings and the AI form through a turn of the phone; the Welcome's step, buddy and name
 * through the end of the process too (`saved`).
 */
class MainViewModel(saved: SavedStateHandle) : ViewModel() {
    val graph = AppGraph.instance
    val welcome = WelcomeModel(graph.settings, viewModelScope, saved)
    val settings = SettingsModel(graph.account, graph.cloud, graph.settings, viewModelScope)
    val ai = AiFormModel(
        graph.settings, graph.secrets, graph.providers, graph.keySaver, graph.router::listModels, graph.router::modelFor, viewModelScope,
    )

    init {
        viewModelScope.launch { graph.account.user.collect(welcome::setUser) }
        viewModelScope.launch { graph.cloud.free.collect(welcome::setFree) }
    }

    /** Google's account picker over `activity`, then this person's free-mode settings. */
    suspend fun signIn(activity: Activity) = signInWithGoogle(graph.account, graph.cloud) { graph.google.pick(activity) }
}

/**
 * Buddy's own screen: the Welcome until it is done, then Settings. One instance (singleTask), so that an "Open
 * Settings" from the panel or a Fix sheet reaches the Settings already open, and scrolls it to the part it names.
 */
class MainActivity : ComponentActivity() {
    private val kept: MainViewModel by viewModels()
    private var section by mutableStateOf<SectionRequest?>(null)
    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) section = sectionOf(intent)
        val settings = kept.graph.settings
        val onboarded = settings.onboarded
        val askNotifications = { askForNotifications(settings, notifications) }
        val welcome = WelcomeCallbacks(
            signIn = { kept.welcome.signIn { kept.signIn(this) } },
            askNotifications = askNotifications,
            done = ::done,
        )
        val settingsCallbacks = SettingsCallbacks(
            signIn = { kept.settings.signIn { kept.signIn(this) } },
            lookChanged = { BubbleService.lookChanged(this) },
            powerChanged = { on -> if (on) BubbleService.start(this) else BubbleService.stop(this) },
            askNotifications = askNotifications,
        )
        setContent {
            BuddyTheme {
                if (onboarded) {
                    SettingsScreen(kept.settings, kept.ai, section, settingsCallbacks)
                } else {
                    WelcomeScreen(kept.welcome, kept.graph.cloud.free, kept.ai, welcome)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        sectionOf(intent)?.let { section = it }
    }

    override fun onResume() {
        super.onResume()
        // Buddy is on but not floating: "Display over other apps" was taken away and has been given back (or Android
        // stopped it). Opening the app brings it back, as the Mac's buddy comes back when Buddy starts.
        val settings = kept.graph.settings
        if (settings.onboarded && settings.buddyOn && Settings.canDrawOverlays(this)) BubbleService.start(this)
    }

    /**
     * The Welcome's last step: Buddy on, and the person back on their phone with the buddy waving. Without "Display over
     * other apps" there would be no buddy to see: the Welcome goes back to Let Buddy float instead.
     */
    private fun done() {
        if (!kept.welcome.finish(canFloat = Settings.canDrawOverlays(this))) return
        BubbleService.start(this)
        finish()
    }

    private fun sectionOf(intent: Intent?): SectionRequest? =
        runCatching { intent?.getStringExtra(SECTION) }.getOrNull()?.let(::SectionRequest)
}
