package com.akshatgg.buddy.voice

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
     * The listener lets go of the microphone while a call rings or runs, while Android silences Buddy's recording (another
     * app records), while Buddy's own 🎤 or a spoken answer records, and while a hands-free turn runs.
     */
    fun paused(inCall: Boolean, silenced: Boolean, micBusy: Int, turn: Boolean): Boolean =
        inCall || silenced || micBusy > 0 || turn
}
