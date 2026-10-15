package com.akshatgg.buddy.message

import android.content.ActivityNotFoundException
import android.content.Context
import com.akshatgg.buddy.bubble.LookService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** What Buddy's Accessibility service can do in WhatsApp's chat screen. */
interface ChatScreen {
    fun on(): Boolean
    suspend fun chat(app: String): ChatState?
    suspend fun pressSend(app: String, name: String, text: String): Boolean
}

/** The chat screen through Buddy's Accessibility service (LookService), which reads it off the main thread. */
class ServiceChatScreen(private val context: Context) : ChatScreen {
    override fun on() = LookService.isEnabled(context) && LookService.running != null
    override suspend fun chat(app: String) = withContext(Dispatchers.Default) { LookService.running?.whatsAppChat(app) }
    override suspend fun pressSend(app: String, name: String, text: String) =
        withContext(Dispatchers.Default) { LookService.running?.pressWhatsAppSend(app, name, text) == true }
}

/** Who "Priya" is: one person, or what Buddy says instead (`code` says which part of Settings fixes it). */
sealed interface Found {
    data class One(val person: Person) : Found
    data class Say(val line: String, val code: String? = null) : Found
}

/**
 * How a send ended: sent, or not, and why (`code` says which part of Settings fixes it). `inWhatsApp`: the text waits
 * in the person's chat for them to send themselves, so Buddy must not offer to send it again.
 */
sealed interface Sent {
    data object Done : Sent
    data class Failed(val line: String, val code: String? = null, val inWhatsApp: Boolean = false) : Sent
}

/** What the chat panel needs for a message: who, then send. */
interface Messaging {
    suspend fun find(asked: String): Found
    suspend fun send(person: Person, text: String): Sent
}

private const val OPEN_WAIT_MS = 8_000L
private const val STEP_MS = 250L
private const val MAIN_APP = "com.whatsapp"
private const val NO_WHATSAPP = "WhatsApp isn't on this phone."
private const val READY_THERE = "It's ready in WhatsApp. Turn on Buddy in Accessibility so I can press Send for you."

/**
 * Messaging someone on WhatsApp, the steps in order. find(): who "Priya" is, among the phone's WhatsApp contacts.
 * send(), only after the person said yes: open the chat with the text in its box, wait until WhatsApp shows that
 * chat with that text in its box, check both again at the press, press Send. Nothing is sent when anything is off.
 */
class Messenger(
    private val whatsApp: WhatsApp,
    private val screen: ChatScreen,
    private val contactsAllowed: suspend () -> Boolean,
    private val wait: suspend (Long) -> Unit = { delay(it) },
) : Messaging {
    override suspend fun find(asked: String): Found {
        if (!whatsApp.installed()) return Found.Say(NO_WHATSAPP)
        val noContacts = Found.Say("I need your contacts to find $asked. You can allow it in Settings.", "no_contacts")
        if (!contactsAllowed()) return noContacts
        val people = try {
            whatsApp.people()
        } catch (e: SecurityException) {
            return noContacts // taken back in the phone's settings since it was allowed
        }
        val pick = pickChat(asked, people.map { it.name })
        if (pick !is Pick.One) return Found.Say(pickLine(asked, pick)!!)
        // Two contacts with the same name are one name to the pick: Buddy does not guess which. The same person on
        // WhatsApp and WhatsApp Business (the same number) is one person, on WhatsApp.
        val named = people.filter { sameName(it.name, pick.name) }
        if (named.map { it.number }.distinct().size > 1) {
            return Found.Say("You have more than one contact called ${pick.name}. Rename one in your phone's contacts, then ask me again.")
        }
        return Found.One(named.firstOrNull { it.app == MAIN_APP } ?: named.first())
    }

    override suspend fun send(person: Person, text: String): Sent {
        try {
            whatsApp.open(person, text)
        } catch (e: ActivityNotFoundException) {
            return Sent.Failed(NO_WHATSAPP) // uninstalled since the card was shown
        }
        if (!screen.on()) return Sent.Failed(READY_THERE, "no_accessibility", inWhatsApp = true)
        // WhatsApp may still show the chat it had open before for a moment, or this person's chat with an old draft
        // before it puts the new text in: Buddy waits until the chat is theirs with exactly this text in its box, and
        // looks for the first time only after a step (never at once, while WhatsApp may not have switched yet).
        var seen: ChatState? = null
        var waited = 0L
        while (waited < OPEN_WAIT_MS) {
            wait(STEP_MS)
            waited += STEP_MS
            val now = screen.chat(person.app) ?: continue
            seen = now
            if (now.readyFor(person.name, text)) {
                // Checked once more at the press, on the screen Send is found on.
                return if (screen.pressSend(person.app, person.name, text)) Sent.Done
                else Sent.Failed("I couldn't press Send. It's ready in WhatsApp: press Send yourself.", inWhatsApp = true)
            }
        }
        return when {
            seen == null -> Sent.Failed("WhatsApp didn't open ${person.name}'s chat, so I didn't send it.")
            !sameName(seen.name, person.name) -> Sent.Failed("That opened the wrong chat, so I didn't send it.")
            else -> Sent.Failed("WhatsApp didn't put the message in, so I didn't send it.")
        }
    }
}
