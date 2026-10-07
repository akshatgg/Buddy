package com.akshatgg.buddy.ui.panel

import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.ActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewModelScope
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.bubble.BubbleBus
import com.akshatgg.buddy.capture.ScreenCapture
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.ui.MainActivity
import com.akshatgg.buddy.ui.theme.BuddyTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

private const val COPIED = "Copied — long-press the box and tap Paste"
private const val NO_PICTURE = "Check screen needs a picture of your screen. Try again and tap Start."
private const val NOTHING_TO_PASTE = "Copy some text first, then tap Paste."
private const val HIDE_MS = 1500L // the buddy is out of the picture for this long

// MainActivity scrolls Settings to this section: where a key, a model or free mode is set; the account; Buddy on.
private const val SECTION = "section"
private val AI_ERRORS = setOf("no_key", "bad_key", "no_credit", "bad_model", "no_vision", "need_key", "free_off")

private fun sectionFor(code: String?) = when (code) {
    in AI_ERRORS -> "ai"
    "signed_out", "not_set_up" -> "account"
    "buddy_off" -> "buddy"
    else -> null
}

/** Keeps the panel's state, its picture and its request through a turn of the phone. */
class PanelViewModel : ViewModel() {
    val model = PanelModel(AppGraph.instance.router::ask, viewModelScope, BubbleBus::send)
}

/**
 * The panel the buddy opens when it is tapped: an activity rather than an overlay, so that the keyboard works as in
 * any app. It is a card over whatever was on screen, kept out of Recents; Back or a tap outside the card closes it.
 */
class PanelActivity : ComponentActivity() {
    private val kept: PanelViewModel by viewModels()
    private val model: PanelModel get() = kept.model
    private lateinit var capture: ScreenCapture

    // Lint reads Fragment 1.2.5 from the compile classpath (the app runs with 1.5.7), and the check is about a
    // FragmentActivity before 1.3.0 losing results: the panel is a plain ComponentActivity.
    @SuppressLint("InvalidFragmentVersionForActivityResult")
    private val consent = registerForActivityResult(ActivityResultContracts.StartActivityForResult(), ::takePicture)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        capture = ScreenCapture(this)
        val buddyName = AppGraph.instance.settings.buddyName
        val model = model
        val on = PanelCallbacks(
            select = model::select,
            setInstruction = model::setInstruction,
            setTone = model::setTone,
            setFixText = model::setFixText,
            paste = ::paste,
            setQuestion = model::setQuestion,
            takePicture = ::askForPicture,
            submit = model::submit,
            copy = ::copy,
            share = ::share,
            retry = model::retry,
            openSettings = { openSettings(sectionFor(it.code)) },
            settings = { openSettings(null) },
            close = ::finish,
        )
        setContent {
            BuddyTheme {
                // Collected without a hop through the main queue, so that a text box always shows what was just typed.
                val state by model.state.collectAsStateWithLifecycle(context = Dispatchers.Main.immediate)
                PanelScreen(state, buddyName, on)
            }
        }
    }

    /** Android only lets an app read the clipboard when the person asks: here, when they press Paste. */
    private fun paste() {
        val clip = getSystemService(ClipboardManager::class.java).primaryClip
        val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString().orEmpty()
        if (text.isEmpty()) model.showError(PanelError(NOTHING_TO_PASTE, showSettings = false)) else model.setFixText(text)
    }

    private fun copy(text: String) {
        getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Buddy", text))
        // Android 13 and later show their own "Copied" too; the buddy says how to paste it.
        BubbleBus.say(COPIED)
        finish()
    }

    private fun share(text: String) {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        startActivity(Intent.createChooser(send, null))
    }

    /** Settings, in the app's own task (the panel's is apart and out of Recents), and the panel closes, as on the Mac. */
    private fun openSettings(section: String?) {
        val intent = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (section != null) intent.putExtra(SECTION, section)
        startActivity(intent)
        finish()
    }

    /** Android asks the person first ("Start recording or casting?"), every time: that is its rule. */
    private fun askForPicture() {
        // The picture is taken through the buddy's service, which runs only while Buddy is on.
        if (!AppGraph.instance.settings.buddyOn) {
            showCaptureError(ScreenCapture.buddyOff())
            return
        }
        // The keyboard would be in the picture.
        WindowCompat.getInsetsController(window, window.decorView).hide(WindowInsetsCompat.Type.ime())
        val projections = getSystemService(MediaProjectionManager::class.java)
        // The whole screen, which is what is behind the panel: not the choice of a single app that Android 14 offers.
        val intent = if (Build.VERSION.SDK_INT >= 34) {
            projections.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
        } else {
            projections.createScreenCaptureIntent()
        }
        consent.launch(intent)
    }

    /**
     * Agreed to: the panel steps out of the picture (the dimming behind it too) and so does the buddy, the picture is
     * taken, and the panel comes back with it.
     */
    private fun takePicture(result: ActivityResult) {
        val data = result.data
        if (result.resultCode != RESULT_OK || data == null) {
            model.showError(PanelError(NO_PICTURE, showSettings = false, code = "no_picture"))
            return
        }
        lifecycleScope.launch {
            val dim = window.attributes.dimAmount
            window.decorView.alpha = 0f
            window.setDimAmount(0f)
            BubbleBus.hideFor(HIDE_MS)
            try {
                val (jpeg, thumb) = capture.captureOnce(result.resultCode, data)
                model.setScreenshot(jpeg, thumb)
            } catch (e: BuddyError) {
                showCaptureError(e)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("Buddy", "capture: failed (${e.javaClass.simpleName})")
                showCaptureError(BuddyError("capture_failed", "Could not take the screenshot. Try again."))
            } finally {
                window.decorView.alpha = 1f
                window.setDimAmount(dim)
            }
        }
    }

    private fun showCaptureError(err: BuddyError) {
        model.showError(PanelError(err.message.orEmpty(), showSettings = err.code == "buddy_off", code = err.code))
    }
}
