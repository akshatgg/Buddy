package com.akshatgg.buddy.ui.welcome

import androidx.lifecycle.SavedStateHandle
import com.akshatgg.buddy.account.User
import com.akshatgg.buddy.ai.aiSection
import com.akshatgg.buddy.cloud.FreeSettings
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.ui.common.Status
import com.akshatgg.buddy.ui.common.failure
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private const val NAME_MAX = 24
private const val CANNOT_FLOAT = "Let Buddy float: allow Display over other apps."

// What the Welcome keeps when Android ends the process while Buddy is in the background.
private const val SAVED_STEP = "welcome.step"
private const val SAVED_BUDDY = "welcome.buddy"
private const val SAVED_NAME = "welcome.name"

enum class Step { SIGN_IN, BUDDY, FLOAT, AI, DONE }

/** The steps for this person: Connect an AI only when they may need a key of their own, as on the Mac. */
fun stepsFor(free: FreeSettings?): List<Step> = Step.entries.filter { it != Step.AI || aiSection(free).showForm }

internal fun defaultName(characterId: String) =
    AppSettings.CHARACTERS.firstOrNull { it.first == characterId }?.second ?: AppSettings.CHARACTERS[0].second

/**
 * Everything the Welcome shows. `signInStatus` is only what went wrong with a sign-in: someone signed in is shown from
 * `user`. `finishError` is why the last step could not finish; `floatNote` is shown on Let Buddy float when the last
 * step sent the person back there.
 */
data class WelcomeState(
    val steps: List<Step>,
    val index: Int = 0,
    val user: User? = null,
    val signingIn: Boolean = false,
    val signInStatus: Status? = null,
    val characterId: String,
    val name: String,
    val finishError: String? = null,
    val floatNote: String? = null,
) {
    val step: Step get() = steps[index]

    /** Next is off on the first step until the person is signed in. */
    val canGoNext: Boolean get() = step != Step.SIGN_IN || user != null
}

/**
 * The Welcome's steps, as the Mac's onboarding.js: sign in, pick a buddy, let it float, connect an AI (only when free
 * mode may not cover this person), and done. The buddy and its name are kept here until the last step saves them,
 * and with the step shown they are kept in `saved` too, so a process Android ends in the background comes back where
 * the person was. Plain Kotlin, so that it is tested on the JVM; MainActivity tells it who is signed in and the
 * free-mode settings.
 */
class WelcomeModel(
    private val settings: AppSettings,
    private val scope: CoroutineScope,
    private val saved: SavedStateHandle,
) {
    private val current = MutableStateFlow(restore())
    val state: StateFlow<WelcomeState> = current.asStateFlow()

    private fun restore(): WelcomeState {
        val steps = stepsFor(null)
        val buddy = saved.get<String>(SAVED_BUDDY)?.takeIf { id -> AppSettings.CHARACTERS.any { it.first == id } } ?: settings.characterId
        val step = saved.get<String>(SAVED_STEP)?.let { name -> Step.entries.firstOrNull { it.name == name } }
        return WelcomeState(
            steps = steps,
            index = steps.indexOf(step).coerceAtLeast(0),
            characterId = buddy,
            name = saved.get<String>(SAVED_NAME) ?: defaultName(buddy),
        )
    }

    private fun update(change: (WelcomeState) -> WelcomeState) {
        val s = change(current.value)
        current.value = s
        saved[SAVED_STEP] = s.step.name
        saved[SAVED_BUDDY] = s.characterId
        saved[SAVED_NAME] = s.name
    }

    /**
     * The person signed in, or out behind the Welcome's back (a sign-in that expired, or the server turned it down).
     * What the sign-in line said no longer holds, and someone signed out goes back to the first step, where the Sign in
     * button is.
     */
    fun setUser(user: User?) = update {
        val changed = (user == null) != (it.user == null)
        it.copy(
            user = user,
            signInStatus = if (changed) null else it.signInStatus,
            index = if (user == null) 0 else it.index,
        )
    }

    /** New free-mode settings may add or remove Connect an AI. The step on screen stays, or the one after it if it went. */
    fun setFree(free: FreeSettings?) = update {
        val steps = stepsFor(free)
        val kept = steps.indexOf(it.step)
        it.copy(steps = steps, index = if (kept >= 0) kept else minOf(it.index, steps.size - 1))
    }

    /** The next step; false (and nothing changes) while Next is off, or on the last step. */
    fun next(): Boolean {
        val s = current.value
        if (!s.canGoNext || s.index >= s.steps.size - 1) return false
        update { it.copy(index = it.index + 1, finishError = null) }
        return true
    }

    fun back() = update { it.copy(index = maxOf(0, it.index - 1), finishError = null) }

    /** Follow the buddy's own name until the person types one of their own. */
    fun pick(characterId: String) = update {
        val name = if (it.name.isBlank() || it.name == defaultName(it.characterId)) defaultName(characterId) else it.name
        it.copy(characterId = characterId, name = name)
    }

    fun setName(name: String) = update { it.copy(name = name.take(NAME_MAX)) }

    /** Run a sign-in (Google's picker, then the free-mode settings). Signed in shows by itself; a failure says why. */
    fun signIn(run: suspend () -> Unit) {
        if (current.value.signingIn) return
        update { it.copy(signingIn = true, signInStatus = null) }
        scope.launch {
            try {
                run()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                update { it.copy(signInStatus = failure(e, "sign-in")) }
            } finally {
                update { it.copy(signingIn = false) }
            }
        }
    }

    /**
     * Save the buddy and its name, and turn Buddy on. Refused to anyone signed out, who goes back to the first step:
     * nobody uses Buddy without signing in. Refused too while Buddy cannot float (`canFloat`: "Display over other
     * apps" is not allowed): the person goes back to Let Buddy float and is told why, and nothing is saved, so the
     * Welcome is not over until there is a buddy to see.
     */
    fun finish(canFloat: Boolean): Boolean {
        val s = current.value
        if (s.user == null) {
            update { it.copy(index = 0, finishError = "Sign in with Google first.") }
            return false
        }
        if (!canFloat) {
            update { it.copy(index = it.steps.indexOf(Step.FLOAT), floatNote = CANNOT_FLOAT) }
            return false
        }
        settings.characterId = s.characterId
        settings.buddyName = s.name
        settings.onboarded = true
        settings.buddyOn = true
        update { it.copy(floatNote = null) }
        return true
    }
}
