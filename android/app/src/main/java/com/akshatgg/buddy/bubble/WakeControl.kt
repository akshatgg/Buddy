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
                launch { graph.voiceModel.state.collect { refresh() } }
                launch { graph.account.user.collect { refresh() } }
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

    /** Looks at the situation again: starts listening, with the phrase of the name now, or stops. */
    fun refresh() {
        job?.cancel(); job = null
        val name = graph.settings.buddyName
        val phrase = VoiceWords.wakePhrase(name)
        job = scope.launch {
            val situation = WakeSituation(
                wakeOn = graph.settings.wakeOn,
                buddyOn = graph.settings.buddyOn,
                signedIn = graph.account.isSignedIn(),
                voiceOn = runCatching { graph.cloud.voiceOn() }.getOrDefault(false),
                micAllowed = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED,
                modelReady = graph.voiceModel.ready(),
                nameOk = phrase != null && VoiceWords.wakeMissing(name, graph.shared.voiceModelMissing).isEmpty(),
                micService = micService,
            )
            if (!WakeRules.listen(situation) || phrase == null) return@launch
            listen(phrase)
        }
    }

    private suspend fun listen(phrase: String) {
        val listener = WakeListener(
            mic = { AudioRecordSource() },
            spotters = Spotters { grammar -> graph.spotters.get()!!.make(grammar) },
            phrase = phrase,
            paused = ::paused,
        )
        try {
            kotlinx.coroutines.withContext(Dispatchers.IO) {
                listener.run { event ->
                    when (event) {
                        WakeEvent.Woke -> BubbleBus.mood(Mood.THINKING)
                        is WakeEvent.Request -> {
                            turnRunning = true
                            try {
                                onRequest(event.wav)
                            } finally {
                                turnRunning = false
                                BubbleBus.mood(Mood.IDLE)
                            }
                        }
                        WakeEvent.Hearing -> {}
                    }
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w("Buddy", "wake: stopped (${e.javaClass.simpleName})")
        }
    }

    private fun paused(): Boolean {
        val mode = audio.mode
        val inCall = mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_IN_COMMUNICATION || mode == AudioManager.MODE_RINGTONE
        return WakeRules.paused(inCall, silenced, MicBus.busy.value, turnRunning)
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
