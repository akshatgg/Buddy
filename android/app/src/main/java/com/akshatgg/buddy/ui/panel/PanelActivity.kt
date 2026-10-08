package com.akshatgg.buddy.ui.panel

import android.annotation.SuppressLint
import android.content.ClipboardManager
import android.content.ComponentName
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
import com.akshatgg.buddy.ui.fix.FixActivity
import com.akshatgg.buddy.ui.theme.BuddyTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

private const val NO_PICTURE = "Check screen needs a picture of your screen. Try again and allow it."
private const val NOTHING_TO_PASTE = "Copy some text first, then tap Paste."
// The buddy is already out of the panel's way while the panel is on screen; this keeps it out of the picture even
// if the panel is sent to the background meanwhile.
private const val HIDE_MS = 1500L

/** Keeps the panel's state, its picture and its request through a turn of the phone. */
class PanelViewModel : ViewModel() {
    val model = PanelModel(AppGraph.instance.ask, viewModelScope, BubbleBus::send).apply {
        select(chosen.first)
        setTone(chosen.second)
    }

    override fun onCleared() {
        val state = model.state.value
        chosen = state.tab to state.tone
    }

    private companion object {
        // The tab and tone last chosen, while Buddy runs: each opening starts from them, with empty boxes, as the
        // Mac's panel keeps its tone from one opening to the next.
        var chosen = Tab.WRITE to "formal"
    }
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
            openSettings = { openSettings(it.code) },
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

    // The buddy steps out of the panel's way while it is on screen. A turn of the phone stops this activity and starts
    // the next one at once: the buddy stays hidden through it.
    override fun onStart() {
        super.onStart()
        BubbleBus.sheetShown(kept)
    }

    override fun onStop() {
        if (!isChangingConfigurations) BubbleBus.sheetGone(kept)
        super.onStop()
    }

    /** The buddy tapped while the panel was in the background: a new opening, which starts afresh, as on the Mac. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        model.reset()
    }

    /** Android only lets an app read the clipboard when the person asks: here, when they press Paste. */
    private fun paste() {
        val clip = getSystemService(ClipboardManager::class.java).primaryClip
        val text = clip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString().orEmpty()
        if (text.isEmpty()) model.showError(PanelError(NOTHING_TO_PASTE, showSettings = false)) else model.setFixText(text)
    }

    private fun copy(text: String) {
        copyAnswer(text)
        finish()
    }

    private fun share(text: String) {
        val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
        // Buddy's own Share → Buddy would only fix the answer again: the person shares it with someone else.
        val buddy = arrayOf(ComponentName(this, FixActivity::class.java))
        startActivity(Intent.createChooser(send, null).putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, buddy))
    }

    /** Settings, and the panel closes, as on the Mac. */
    private fun openSettings(code: String?) {
        openSettingsFor(code)
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
            // Opened afresh meanwhile (sent to the background, then the buddy tapped): the picture, or why there is
            // none, belongs to the last opening.
            val opening = model.opening
            val dim = window.attributes.dimAmount
            window.decorView.alpha = 0f
            window.setDimAmount(0f)
            BubbleBus.hideFor(HIDE_MS)
            try {
                val (jpeg, thumb) = capture.captureOnce(result.resultCode, data)
                if (model.opening == opening) model.setScreenshot(jpeg, thumb)
            } catch (e: BuddyError) {
                if (model.opening == opening) showCaptureError(e)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                Log.w("Buddy", "capture: failed (${e.javaClass.simpleName})")
                if (model.opening == opening) showCaptureError(ScreenCapture.couldNotCapture())
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
