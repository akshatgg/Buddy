package com.akshatgg.buddy.bubble

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.AudioRecordingConfiguration
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.voice.AudioRecordSource
import com.akshatgg.buddy.voice.MicBus
import com.akshatgg.buddy.voice.MyVoiceRules
import com.akshatgg.buddy.voice.runWithin
import com.akshatgg.buddy.voice.Spotters
import com.akshatgg.buddy.voice.VoiceWords
import com.akshatgg.buddy.voice.WakeEvent
import com.akshatgg.buddy.voice.WakeListener
import com.akshatgg.buddy.voice.WakeRules
import com.akshatgg.buddy.voice.WakeSituation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch

/**
 * Runs the wake listener inside the bubble's microphone service, while WakeRules say it may listen, and lets go of the
 * microphone while a call, another app's recording, Buddy's own 🎤 or a hands-free turn needs it. Runs on the service's
 * (main) scope; the listening itself on Dispatchers.IO. `refresh()` looks at everything again: the switch, the name, the
 * model, the sign-in.
 */
class WakeControl(
    private val context: Context,
    private val graph: AppGraph,
    private val scope: CoroutineScope,
    private val chatBusy: () -> Boolean = { false }, // the hands-free chat is still answering
    private val onRequest: suspend (ByteArray?) -> Unit,
) {
    private val audio = context.getSystemService(AudioManager::class.java)
    private var job: Job? = null
    private var watching: Job? = null
    private var micService = false
    @Volatile private var silenced = false
    @Volatile private var turnRunning = false
    private var recordingCallback: AudioManager.AudioRecordingCallback? = null

    /** The service is a microphone one now: listening may begin. */
    fun start() {
        micService = true
        if (watching == null) {
            watching = scope.launch { // the model arriving, or a sign-in or sign-out, changes what may be done
                // the first value of each is what start() looks at itself below
                launch { graph.voiceModel.state.drop(1).distinctUntilChanged().collect { refresh() } }
                launch { graph.account.user.drop(1).distinctUntilChanged().collect { refresh() } }
            }
        }
        watchRecordings()
        refresh()
    }

    /** The service is no longer a microphone one (or ends): everything stops. */
    fun stop() {
        micService = false
        watching?.cancel(); watching = null
        job?.cancel(); job = null
        unwatchRecordings()
    }

    /**
     * Looks at the situation again: starts listening, with the phrases of the name now, or stops. With `testMs` (Settings'
     * Test it) it only listens for wakes for that long, tells BubbleBus of each, takes no request, and then goes on as before.
     * With `clips` too (setting up "Only my voice") it listens for `only` and gives no voice check: each phrase's audio goes
     * to BubbleBus.clips instead, to learn the owner's voice from.
     */
    fun refresh(testMs: Long? = null, only: List<String>? = null, clips: Boolean = false) {
        job?.cancel(); job = null
        val name = graph.settings.buddyName
        val phrases = only ?: VoiceWords.wakePhrases(name, graph.shared.voiceModelMissing)
        job = scope.launch {
            val situation = WakeSituation(
                wakeOn = graph.settings.wakeOn,
                buddyOn = graph.settings.buddyOn,
                signedIn = graph.account.isSignedIn(),
                voiceOn = runCatching { graph.cloud.voiceOn() }.getOrDefault(false),
                micAllowed = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED,
                modelReady = graph.voiceModel.ready(),
                micService = micService,
            )
            if (!WakeRules.listen(situation)) return@launch
            // "Only my voice": the check on each wake phrase (normal listening and Test it, not setup). Warmed now, so that
            // the first wake does not wait for the engine to load.
            val checkVoice = graph.settings.myVoiceOn && !clips
            if (checkVoice) launch(Dispatchers.IO) { graph.embedder.warm() }
            val check: ((ShortArray?) -> Boolean)? =
                if (checkVoice) { clip -> runWithin(MyVoiceRules.CHECK_MS) { graph.myVoice.allows(clip) } ?: false } else null
            if (testMs == null) {
                listen(phrases, testOnly = false, check = check)
            } else {
                kotlinx.coroutines.withTimeoutOrNull(testMs) { listen(phrases, testOnly = true, check = check, clips = clips) }
                refresh()
            }
        }
    }

    private suspend fun listen(phrases: List<String>, testOnly: Boolean, check: ((ShortArray?) -> Boolean)?, clips: Boolean = false) {
        val listener = WakeListener(
            mic = { AudioRecordSource() },
            spotters = Spotters { grammar -> (runCatching { graph.spotters.get() }.getOrNull() ?: throw EarsFailed()).make(grammar) },
            phrases = phrases,
            paused = ::paused,
            silenced = { silenced },
            testOnly = testOnly,
            check = check,
        )
        try {
            kotlinx.coroutines.withContext(Dispatchers.IO) {
                listener.run { event ->
                    when (event) {
                        is WakeEvent.Woke -> if (clips) BubbleBus.clip(event.phrase) else if (testOnly) BubbleBus.woke() else BubbleBus.mood(Mood.THINKING)
                        WakeEvent.NotYou -> BubbleBus.notYou()
                        is WakeEvent.Request -> {
                            turnRunning = true
                            try {
                                onRequest(event.wav)
                                // the chat answers (and speaks) after the request is handed over: the microphone stays
                                // let go of until it is quiet again
                                WakeRules.untilQuiet { chatBusy() || MicBus.busy.value > 0 }
                            } finally {
                                turnRunning = false
                                BubbleBus.mood(Mood.IDLE)
                            }
                        }
                    }
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: EarsFailed) {
            Log.w("Buddy", "wake: no model to listen with")
            BubbleBus.say(VoiceWords.WakeLines.EARS_FAILED)
        } catch (e: Exception) {
            Log.w("Buddy", "wake: stopped (${e.javaClass.simpleName})")
        }
    }

    private fun paused(): Boolean {
        val mode = audio.mode
        val inCall = mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_IN_COMMUNICATION || mode == AudioManager.MODE_RINGTONE
        return WakeRules.paused(inCall, MicBus.busy.value, turnRunning)
    }

    /** Android 10+ tells an app when its own recording is silenced because another app (a call) took the microphone. */
    private fun watchRecordings() {
        if (Build.VERSION.SDK_INT < 29 || recordingCallback != null) return
        val callback = object : AudioManager.AudioRecordingCallback() {
            override fun onRecordingConfigChanged(configs: MutableList<AudioRecordingConfiguration>) {
                silenced = configs.any { it.isClientSilenced }
            }
        }
        audio.registerAudioRecordingCallback(callback, Handler(Looper.getMainLooper()))
        recordingCallback = callback
    }

    private fun unwatchRecordings() {
        recordingCallback?.let { audio.unregisterAudioRecordingCallback(it) }
        recordingCallback = null
        silenced = false
    }
}

/** The on-device model is not there (or would not load) when the listener needs a recognizer. */
private class EarsFailed : RuntimeException()
