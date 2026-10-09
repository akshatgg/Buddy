package com.akshatgg.buddy.ui.panel

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.ViewModel
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.bubble.BubbleBus
import com.akshatgg.buddy.capture.ScreenCapture
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.ui.fix.FixActivity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay

// The app the panel stepped away from becomes the active window again: Accessibility then reaches its box.
private const val ASIDE_MS = 400L
// The buddy is already out of the panel's way while the panel is on screen; this keeps it out of the picture even
// if the panel is sent to the background meanwhile.
private const val HIDE_MS = 1500L

/** What an activity showing the chat does for it: PanelActivity, and FixActivity (Fix with Buddy, Share → Buddy). */
interface ChatHost {
    /** Out of the app's way: the panel goes behind it (or the Fix sheet closes). */
    fun stepAside()

    /** Hand the text back to the app that gave the selection, in its place (PROCESS_TEXT); the sheet closes. */
    fun replace(text: String) = Unit

    val activity: ComponentActivity

    /** Where Android's answer to "Start recording or casting?" goes (registered by the activity). */
    val consent: ActivityResultLauncher<Intent>
}

/**
 * Keeps the chat (PanelModel) through a turn of the phone, and gives it Android's hands through whichever activity
 * shows it now (`host`). The chat's work runs in the app's scope, not this ViewModel's: closing the panel lets go of an
 * answer still on its way (PanelModel.close), but not of text Buddy is putting in the app after stepping aside.
 */
class ChatViewModel : ViewModel() {
    var host: ChatHost? = null
    private var picture: CompletableDeferred<ActivityResult>? = null
    private val graph = AppGraph.instance
    private val app = graph.appContext

    val model = PanelModel(
        ask = graph.ask,
        scope = graph.scope,
        bubble = BubbleBus::send,
        typeIn = graph.typeIn,
        facts = graph.facts,
        hands = PanelHands(
            stepAside = {
                host?.stepAside()
                delay(ASIDE_MS)
            },
            copy = { app.copyText(it) },
            share = { text -> host?.activity?.let { share(it, text) } },
            screen = ::screen,
            replace = { host?.replace(it) },
            openSettings = { app.openSettingsFor(it) },
        ),
        firstName = graph::firstName,
        maxMessage = graph.shared.limitInstruction,
        maxSelection = graph.shared.limitText,
    )

    /**
     * Claude mode, in the panel only (the Fix sheet has no Claude button): the Claude Code sessions on the person's
     * computer, through Buddy's server. Its looks and its "stop" run in the app's scope too, so that the stop sent as
     * the panel closes still goes.
     */
    val claude = ClaudeModel(
        look = { graph.cloud.remoteLook(it) },
        send = { session, text -> graph.cloud.remoteSend(session, text) },
        stop = { graph.cloud.remoteStop() },
        scope = graph.scope,
    )

    /** Android's answer to "Start recording or casting?", from the activity that asked (or the one made after a turn). */
    fun pictureAnswered(result: ActivityResult) {
        picture?.complete(result)
    }

    /**
     * One picture of the screen for the chat's "screen" step: Android asks the person first, every time; null when
     * they said no. The panel steps out of the picture (the dimming behind it too) and so does the buddy.
     */
    private suspend fun screen(): String? {
        val asking = host ?: return null
        // The picture is taken through the buddy's service, which runs only while Buddy is on.
        if (!graph.settings.buddyOn) throw ScreenCapture.buddyOff()
        val answer = CompletableDeferred<ActivityResult>()
        picture = answer
        askForPicture(asking.activity, asking.consent)
        val result = try {
            answer.await()
        } finally {
            picture = null
        }
        val data = result.data
        if (result.resultCode != Activity.RESULT_OK || data == null) return null
        val activity = host?.activity ?: return null
        val window = activity.window
        val dim = window.attributes.dimAmount
        window.decorView.alpha = 0f
        window.setDimAmount(0f)
        BubbleBus.hideFor(HIDE_MS)
        try {
            return ScreenCapture(activity).captureOnce(result.resultCode, data).first
        } catch (e: BuddyError) {
            throw e
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w("Buddy", "capture: failed (${e.javaClass.simpleName})")
            throw ScreenCapture.couldNotCapture()
        } finally {
            window.decorView.alpha = 1f
            window.setDimAmount(dim)
        }
    }

    /** The panel was closed: an answer still on its way is let go of, and Claude mode ends. */
    override fun onCleared() {
        model.close()
        claude.close()
    }
}

/** Android asks the person first ("Start recording or casting?"), every time: that is its rule. */
private fun askForPicture(activity: ComponentActivity, consent: ActivityResultLauncher<Intent>) {
    // The keyboard would be in the picture.
    WindowCompat.getInsetsController(activity.window, activity.window.decorView).hide(WindowInsetsCompat.Type.ime())
    val projections = activity.getSystemService(MediaProjectionManager::class.java)
    // The whole screen, which is what is behind the panel: not the choice of a single app that Android 14 offers.
    val intent = if (Build.VERSION.SDK_INT >= 34) {
        projections.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
    } else {
        projections.createScreenCaptureIntent()
    }
    consent.launch(intent)
}

/** Share an answer with someone: Buddy's own Share → Buddy is left out, as it would only fix the answer again. */
private fun share(activity: Activity, text: String) {
    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
    val buddy = arrayOf(ComponentName(activity, FixActivity::class.java))
    activity.startActivity(Intent.createChooser(send, null).putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, buddy))
}
