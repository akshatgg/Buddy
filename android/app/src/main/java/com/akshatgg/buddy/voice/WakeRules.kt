package com.akshatgg.buddy.voice

import kotlinx.coroutines.delay

/** Everything that must be so for Buddy to listen for "Hey <name>" at all. */
data class WakeSituation(
    val wakeOn: Boolean, // the switch in Settings
    val buddyOn: Boolean, // the floating buddy runs (the service the microphone belongs to)
    val signedIn: Boolean, // the request goes to Buddy's server after the wake
    val voiceOn: Boolean, // the server can write down what is said
    val micAllowed: Boolean, // Android's microphone permission
    val modelReady: Boolean, // the on-device model is there
    val nameOk: Boolean, // a name the model can hear
    val micService: Boolean, // the service is a microphone one now (it can only become one with the app on screen)
)

object WakeRules {
    /** All must be true. */
    fun listen(s: WakeSituation): Boolean =
        s.wakeOn && s.buddyOn && s.signedIn && s.voiceOn && s.micAllowed && s.modelReady && s.nameOk && s.micService

    /**
     * The listener lets go of the microphone while a call rings or runs, while Buddy's own 🎤 or a spoken answer records
     * or speaks, and while a hands-free turn runs. While Android silences Buddy's recording (another app records) the
     * microphone is kept open and only not listened to, so it is not here.
     */
    fun paused(inCall: Boolean, micBusy: Int, turn: Boolean): Boolean =
        inCall || micBusy > 0 || turn

    /** A name the model can hear: letters, and none of the words the model lacks. */
    fun nameHeard(name: String, missing: Set<String>): Boolean =
        VoiceWords.wakePhrase(name) != null && VoiceWords.wakeMissing(name, missing).isEmpty()

    /**
     * Waits until `busy` has been false twice in a row, a poll apart (a spoken turn goes from thinking to speaking to
     * asking, with a blink between), or `maxMs` has passed. The wake listener stays off the microphone meanwhile.
     */
    suspend fun untilQuiet(pollMs: Long = 250, maxMs: Long = 180_000, busy: () -> Boolean) {
        var waited = 0L
        var quiet = 0
        while (quiet < 2 && waited < maxMs) {
            quiet = if (busy()) 0 else quiet + 1
            if (quiet >= 2) break
            delay(pollMs)
            waited += pollMs
        }
    }
}
