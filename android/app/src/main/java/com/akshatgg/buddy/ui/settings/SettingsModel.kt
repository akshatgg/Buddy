package com.akshatgg.buddy.ui.settings

import android.util.Log
import com.akshatgg.buddy.account.Account
import com.akshatgg.buddy.account.User
import com.akshatgg.buddy.cloud.CloudClient
import com.akshatgg.buddy.cloud.FreeSettings
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.BuddySize
import com.akshatgg.buddy.ui.common.Status
import com.akshatgg.buddy.ui.common.Tone
import com.akshatgg.buddy.ui.common.failure
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val NAME_MAX = 24
private const val FADE_AFTER_MS = 3000L // how long a success ("Saved ✓") is shown before it goes

/** Where a status line is: under the account, or under the Buddy card. */
enum class Line { ACCOUNT, BUDDY }

/**
 * What Settings shows besides the account and free mode (which come from their own flows). `name` is the name box as
 * typed: what is saved is trimmed, and a blank one is the buddy's own.
 */
data class SettingsState(
    val characterId: String,
    val name: String,
    val size: BuddySize,
    val buddyOn: Boolean,
    /** Look where I type: whether its Accessibility service is on in Android's settings. */
    val lookOn: Boolean = false,
    val signingIn: Boolean = false,
    val lines: Map<Line, Status> = emptyMap(),
)

/**
 * Settings' state, as the Mac's settings.js: every change is saved at once and said on its card's line. A success
 * fades after a few seconds; anything else (an error, a wait) stays until the line is used again. `lookEnabled` says
 * whether Look where I type is on in Android's Accessibility settings, which only Android changes: it is read again
 * each time Settings comes back.
 */
class SettingsModel(
    private val account: Account,
    private val cloud: CloudClient,
    private val settings: AppSettings,
    private val scope: CoroutineScope,
    private val lookEnabled: () -> Boolean = { false },
) {
    val user: StateFlow<User?> = account.user
    val free: StateFlow<FreeSettings?> = cloud.free

    private val current = MutableStateFlow(read(name = settings.buddyName))
    val state: StateFlow<SettingsState> = current.asStateFlow()
    private val fading = mutableMapOf<Line, Job>()

    // Buddy on was asked for while it could not float: it comes on once "Display over other apps" is allowed.
    private var waitingToFloat = false

    private fun read(name: String) = SettingsState(
        characterId = settings.characterId,
        name = name,
        size = settings.size,
        buddyOn = settings.buddyOn,
        lookOn = lookEnabled(),
    )

    fun say(line: Line, status: Status?) {
        fading.remove(line)?.cancel()
        current.update { it.copy(lines = if (status == null) it.lines - line else it.lines + (line to status)) }
        if (status?.tone != Tone.GOOD) return
        fading[line] = scope.launch {
            delay(FADE_AFTER_MS)
            current.update { it.copy(lines = it.lines - line) }
        }
    }

    /**
     * Coming back to Settings: Buddy may have been turned off meanwhile (from its notification, or on the ✕), and Look
     * where I type turned on or off in Android's settings. What is being typed in the name box stays.
     */
    fun reload() = current.update { read(name = it.name).copy(signingIn = it.signingIn, lines = it.lines) }

    /** The admin may have changed free mode since the app last asked. A failure is only logged: the last known settings show. */
    fun refreshFree() {
        if (!account.isSignedIn()) return
        scope.launch {
            try {
                cloud.settings(force = true)
            } catch (e: BuddyError) {
                Log.w("Buddy", "could not fetch the free settings: ${e.code}")
            }
        }
    }

    fun signIn(run: suspend () -> Unit) {
        if (current.value.signingIn) return
        current.update { it.copy(signingIn = true) }
        say(Line.ACCOUNT, null)
        scope.launch {
            try {
                run()
                say(Line.ACCOUNT, Status("Signed in ✓", Tone.GOOD))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                say(Line.ACCOUNT, failure(e, "sign-in"))
            } finally {
                current.update { it.copy(signingIn = false) }
            }
        }
    }

    /** Signing out forgets the free-mode settings too, so that the next person does not inherit them. */
    fun signOut() {
        account.signOut()
        cloud.forget()
        say(Line.ACCOUNT, Status("Signed out."))
    }

    /** Another buddy; false when it is the one already chosen. */
    fun pick(characterId: String): Boolean {
        if (characterId == current.value.characterId) return false
        settings.characterId = characterId
        current.update { it.copy(characterId = settings.characterId) }
        say(Line.BUDDY, Status("Saved ✓", Tone.GOOD))
        return true
    }

    /** Saved as it is typed, so that nothing is lost when the screen is left. */
    fun setName(name: String) {
        val cut = name.take(NAME_MAX)
        settings.buddyName = cut
        current.update { it.copy(name = cut) }
    }

    fun setSize(size: BuddySize) {
        settings.size = size
        current.update { it.copy(size = size) }
        say(Line.BUDDY, Status("Saved ✓", Tone.GOOD))
    }

    /**
     * Buddy on or off; true when it changed. On needs "Display over other apps": without it nothing changes, the line
     * says why, and Buddy comes on by itself once it is allowed (see resumed).
     */
    fun setBuddyOn(on: Boolean, canFloat: Boolean): Boolean {
        waitingToFloat = on && !canFloat
        if (waitingToFloat) {
            say(Line.BUDDY, Status("Let Buddy float: allow Display over other apps.", Tone.ERROR))
            return false
        }
        settings.buddyOn = on
        current.update { it.copy(buddyOn = on) }
        say(Line.BUDDY, null)
        return true
    }

    /** Back on Settings: true when Buddy was waiting for "Display over other apps", has it now, and has come on. */
    fun resumed(canFloat: Boolean): Boolean {
        reload()
        if (!waitingToFloat || !canFloat) return false
        return setBuddyOn(true, canFloat = true)
    }
}
