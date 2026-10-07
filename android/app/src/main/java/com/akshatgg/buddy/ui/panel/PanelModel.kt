package com.akshatgg.buddy.ui.panel

import android.graphics.Bitmap
import android.util.Log
import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.AskInput
import com.akshatgg.buddy.ai.providers.AI_TIMEOUT_MS
import com.akshatgg.buddy.bubble.BubbleEvent
import com.akshatgg.buddy.bubble.Mood
import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

enum class Tab { WRITE, FIX, CHECK }

/**
 * Everything the panel shows. `screenshot` is only the thumbnail: the picture sent to the AI stays in PanelModel.
 * `original` is the text the Fix answer was made from, shown as its "Before" (the box may have changed since).
 */
data class PanelState(
    val tab: Tab = Tab.WRITE,
    val instruction: String = "",
    val tone: String = "formal",
    val fixText: String = "",
    val question: String = "",
    val screenshot: Bitmap? = null,
    val busy: Boolean = false,
    val answer: Answer? = null,
    val error: PanelError? = null,
    val original: String = "",
)

/** What went wrong, in the person's words; `code` says which part of Settings "Open Settings" goes to. */
data class PanelError(val message: String, val showSettings: Boolean, val code: String? = null)

private data class Request(val action: Action, val input: AskInput)

private val TAB_OF = mapOf(Action.WRITE to Tab.WRITE, Action.FIX to Tab.FIX, Action.CHECK to Tab.CHECK)

/**
 * The panel's state and its one request at a time, as the Mac's panel.js and actions.run(): the buddy thinks while
 * the AI does, is happy with an answer, and sleepy when there is no internet (or no answer in time). Plain Kotlin, so
 * that it is tested on the JVM; PanelActivity gives it the router, a scope that ends with the panel, and the bus.
 */
class PanelModel(
    private val ask: suspend (Action, AskInput) -> Answer,
    private val scope: CoroutineScope,
    private val bubble: (BubbleEvent) -> Unit,
) {
    private val current = MutableStateFlow(PanelState())
    val state: StateFlow<PanelState> = current.asStateFlow()

    private var image: String? = null // the latest picture of the screen, base64 JPEG
    private var last: Request? = null // the latest request, for Try again
    private var running: Job? = null // the request the AI is answering now, if any

    /** Counts the openings: what ends after a new one (a picture of the screen) belongs to an earlier one. */
    var opening = 0
        private set

    /** Another tab hides the answer and the error, as on the Mac. */
    fun select(tab: Tab) = current.update { it.copy(tab = tab, answer = null, error = null) }

    fun setInstruction(t: String) = current.update { it.copy(instruction = t) }

    fun setTone(t: String) = current.update { it.copy(tone = t) }

    fun setFixText(t: String) = current.update { it.copy(fixText = t) }

    fun setQuestion(t: String) = current.update { it.copy(question = t) }

    fun setScreenshot(jpegBase64: String, thumb: Bitmap?) {
        image = jpegBase64
        current.update { it.copy(screenshot = thumb, error = null) }
    }

    /** An error that is not the AI's: no picture of the screen, nothing to paste. */
    fun showError(error: PanelError) = current.update { it.copy(error = error) }

    /** Ask for the current tab. A Check without a picture is still sent: the router says "Take a screenshot first." */
    fun submit() {
        val s = current.value
        run(
            when (s.tab) {
                Tab.WRITE -> Request(Action.WRITE, AskInput(instruction = s.instruction, tone = s.tone))
                Tab.FIX -> Request(Action.FIX, AskInput(text = s.fixText))
                Tab.CHECK -> Request(Action.CHECK, AskInput(image = image, instruction = s.question))
            },
        )
    }

    /**
     * A new opening from the buddy, as the Mac's panel.js reset(): empty boxes, and no picture, answer or error. The
     * tab and tone stay as they were chosen. An answer still on its way belonged to the last opening: it is dropped.
     */
    fun reset() {
        opening += 1
        running?.cancel()
        running = null
        image = null
        last = null
        current.update { PanelState(tab = it.tab, tone = it.tone) }
    }

    /** The same request again, whatever the boxes say now. */
    fun retry() {
        last?.let(::run)
    }

    private fun run(request: Request) {
        if (current.value.busy) return // one at a time: the buttons are off meanwhile, and a quick second press is too
        last = request
        current.update { it.copy(busy = true, answer = null, error = null) }
        bubble(BubbleEvent.SetMood(Mood.THINKING))
        running = scope.launch {
            val mine = coroutineContext[Job]
            // Let go of (the panel closed, or opened afresh) while the AI was busy: nobody is waiting for this request,
            // so it changes nothing on the panel, and the buddy stops thinking unless a newer request has started.
            fun letGo() {
                if (running == null || running === mine) bubble(BubbleEvent.SetMood(Mood.IDLE))
            }
            try {
                // One deadline for the whole request, as the Mac's AbortSignal.timeout(AI_TIMEOUT_MS) over ai.ask:
                // a slow fetch of the free-mode settings and then a slow answer must not add up to two minutes.
                val answer = withTimeout(AI_TIMEOUT_MS.toLong()) { ask(request.action, request.input) }
                // The answer shows on its own tab, even if the person looked at another meanwhile.
                current.update {
                    it.copy(
                        busy = false, tab = TAB_OF.getValue(request.action), answer = answer, error = null,
                        original = request.input.text.orEmpty(),
                    )
                }
                bubble(BubbleEvent.SetMood(Mood.HAPPY))
            } catch (e: TimeoutCancellationException) {
                if (isActive) fail(BuddyError("timeout", "Buddy took too long to answer. Try again.")) else letGo()
            } catch (e: CancellationException) {
                letGo()
                throw e
            } catch (e: BuddyError) {
                // A request let go of can fail rather than stop: its thread is interrupted, and an interrupted read is
                // "no internet" to whatever reads it. That failure is nobody's now.
                if (isActive) fail(e) else letGo()
            } catch (e: Exception) {
                if (!isActive) {
                    letGo()
                    return@launch
                }
                // A bug or a system failure, whose own words would mean nothing to the person (they can even hold a
                // file path): the kind goes to the log, and the panel says to try again, as the Mac's ipc/result.js.
                Log.w("Buddy", "panel: unexpected ${e.javaClass.simpleName}")
                fail(BuddyError("failed", "Something went wrong. Try again."))
            }
        }
    }

    private fun fail(err: BuddyError) {
        val error = PanelError(err.message.orEmpty(), err.code in SETTINGS_ERRORS, err.code)
        current.update { it.copy(busy = false, error = error) }
        val asleep = err.code == "network" || err.code == "timeout"
        bubble(BubbleEvent.SetMood(if (asleep) Mood.SLEEPY else Mood.IDLE))
    }

    companion object {
        /**
         * Errors whose fix is in Settings, as the Mac's panel.js: no key yet, a key that was refused, an account out of
         * credit, a model that cannot be used; and signed out, today's free requests used up with own keys allowed but
         * none saved, free mode turned off, and a copy of Buddy that cannot sign in. They come with "Open Settings".
         */
        val SETTINGS_ERRORS = setOf("no_key", "bad_key", "no_credit", "bad_model", "no_vision", "signed_out", "need_key", "free_off", "not_set_up")
    }
}
