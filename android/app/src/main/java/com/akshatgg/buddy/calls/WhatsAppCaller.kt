package com.akshatgg.buddy.calls

import android.content.ActivityNotFoundException
import android.content.Context
import com.akshatgg.buddy.bubble.LookService
import com.akshatgg.buddy.message.ChatState
import com.akshatgg.buddy.message.Person
import com.akshatgg.buddy.message.WhatsApp
import com.akshatgg.buddy.message.sameName
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** What Buddy's Accessibility service can do for a call in WhatsApp's chat screen. */
interface CallScreen {
    fun on(): Boolean
    suspend fun chat(app: String): ChatState?
    suspend fun pressCall(app: String, name: String, video: Boolean): Boolean
    suspend fun question(app: String, name: String): Confirm
}

/**
 * The chat screen through Buddy's Accessibility service (LookService), which reads and presses off the main thread.
 * The chat is read in any of WhatsApp's windows (one behind a question of WhatsApp's still counts as shown).
 */
class ServiceCallScreen(private val context: Context) : CallScreen {
    override fun on() = LookService.isEnabled(context) && LookService.running != null
    override suspend fun chat(app: String) = withContext(Dispatchers.Default) { LookService.running?.whatsAppChatBehind(app) }
    override suspend fun pressCall(app: String, name: String, video: Boolean) =
        withContext(Dispatchers.Default) { LookService.running?.pressWhatsAppCall(app, name, video) == true }
    override suspend fun question(app: String, name: String) =
        withContext(Dispatchers.Default) { LookService.running?.whatsAppCallQuestion(app, name) ?: Confirm.NONE }
}

/** What the chat panel needs for a WhatsApp call: call this person (found as for a message), by voice or video. */
fun interface WhatsAppCalling {
    suspend fun call(person: Person, video: Boolean): Called
}

/** What Buddy says when a call may or may not have started. */
const val CALL_UNSURE = "I'm not sure the call started. Check WhatsApp."
private const val OPEN_WAIT_MS = 8_000L
private const val CALL_WAIT_MS = 4_000L
private const val STEP_MS = 250L
private const val NO_WHATSAPP = "WhatsApp isn't on this phone."
private const val OPEN_THERE = "It's open in WhatsApp. Turn on Buddy in Accessibility so I can press Call for you."
private const val WRONG_CHAT = "That opened the wrong chat, so I didn't call."
private const val NOT_PRESSED = "I couldn't press Call. Call from WhatsApp yourself."
private const val SOMEONE_ELSE = "WhatsApp asked to call someone else, so I didn't."

/**
 * A WhatsApp call, only after the person pressed Call: open the person's chat (WhatsApp's link with no text), wait
 * until WhatsApp shows that chat, press its call button (checked again on the screen it is pressed on), answer
 * WhatsApp's own "Call?" only when it names the same person, and see the chat give way to the call screen. Call is
 * pressed at most once: from the press on, anything Buddy cannot tell is "not sure", never a second try.
 */
class WhatsAppCaller(
    private val whatsApp: WhatsApp,
    private val screen: CallScreen,
    private val wait: suspend (Long) -> Unit = { delay(it) },
) : WhatsAppCalling {
    override suspend fun call(person: Person, video: Boolean): Called {
        try {
            whatsApp.open(person, "")
        } catch (e: ActivityNotFoundException) {
            return Called.Failed(NO_WHATSAPP) // uninstalled since the card was shown
        }
        if (!screen.on()) return Called.Failed(OPEN_THERE, "no_accessibility")
        // WhatsApp may still show the chat it had open before for a moment: Buddy waits until the chat is theirs, and
        // looks for the first time only after a step (never at once, while WhatsApp may not have switched yet).
        var seen: ChatState? = null
        var waited = 0L
        while (waited < OPEN_WAIT_MS) {
            wait(STEP_MS)
            waited += STEP_MS
            val now = screen.chat(person.app) ?: continue
            seen = now
            if (sameName(now.name, person.name)) break
        }
        val chat = seen ?: return Called.Failed("WhatsApp didn't open ${person.name}'s chat, so I didn't call.")
        if (!sameName(chat.name, person.name)) return Called.Failed(WRONG_CHAT)
        // Checked once more at the press, on the screen the button is found on.
        val pressed = try {
            screen.pressCall(person.app, person.name, video)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return Called.Unsure // it may have been pressed: never a second call
        }
        if (!pressed) return Called.Failed(NOT_PRESSED)
        return try {
            afterPress(person)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Called.Unsure // pressed: what came of it cannot be told
        }
    }

    /**
     * Started once the chat has gone from WhatsApp's screen two reads in a row with no question showing (its call screen
     * is up). WhatsApp's question for this person is answered; one about someone else is not. Not seen in 4 s: unsure.
     */
    private suspend fun afterPress(person: Person): Called {
        var gone = 0
        var waited = 0L
        while (waited < CALL_WAIT_MS) {
            wait(STEP_MS)
            waited += STEP_MS
            when (screen.question(person.app, person.name)) {
                Confirm.OTHER -> return Called.Failed(SOMEONE_ELSE)
                Confirm.NOT_PRESSED -> return Called.Failed(NOT_PRESSED)
                Confirm.PRESSED -> {
                    gone = 0
                    continue
                }
                Confirm.NONE -> Unit
            }
            if (screen.chat(person.app) == null) {
                gone += 1
                if (gone >= 2) return Called.Done
            } else {
                gone = 0
            }
        }
        return Called.Unsure
    }
}
