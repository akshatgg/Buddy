package com.akshatgg.buddy.ui.panel

import android.util.Log
import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.AskInput
import com.akshatgg.buddy.ai.ChatReply
import com.akshatgg.buddy.ai.ChatTurn
import com.akshatgg.buddy.ai.providers.AI_TIMEOUT_MS
import com.akshatgg.buddy.apps.AppOpening
import com.akshatgg.buddy.apps.Opened
import com.akshatgg.buddy.bubble.BubbleEvent
import com.akshatgg.buddy.bubble.Mood
import com.akshatgg.buddy.calls.CALL_UNSURE
import com.akshatgg.buddy.calls.CallFound
import com.akshatgg.buddy.calls.CallTelling
import com.akshatgg.buddy.calls.Callee
import com.akshatgg.buddy.calls.Called
import com.akshatgg.buddy.calls.PHONE_CALL_UNSURE
import com.akshatgg.buddy.calls.PhoneCalling
import com.akshatgg.buddy.calls.Told
import com.akshatgg.buddy.calls.WhatsAppCalling
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.message.Found
import com.akshatgg.buddy.message.Messaging
import com.akshatgg.buddy.message.Person
import com.akshatgg.buddy.message.NOT_SURE
import com.akshatgg.buddy.message.Sent
import com.akshatgg.buddy.notify.NotifReading
import com.akshatgg.buddy.store.Facts
import com.akshatgg.buddy.typing.Edit
import com.akshatgg.buddy.typing.PutMode
import com.akshatgg.buddy.typing.TextEdit
import com.akshatgg.buddy.typing.TypeIn
import com.akshatgg.buddy.voice.Heard
import com.akshatgg.buddy.voice.Lock
import com.akshatgg.buddy.voice.SpokenCard
import com.akshatgg.buddy.voice.SpokenItem
import com.akshatgg.buddy.voice.TalkBack
import com.akshatgg.buddy.voice.VoiceWords
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/** A button on a line of the chat. */
enum class ChatButton { INSERT, REPLACE, COPY, SHARE, UNDO, RETRY, SETTINGS, SEND_MESSAGE, NOT_NOW, CALL }

/** A line of the chat. `id`s go up from 1 in each chat. */
sealed interface ChatItem {
    val id: Int
}

/** The person's message, on the right. */
data class YouSaid(override val id: Int, val text: String) : ChatItem

/** The buddy's answer, on the left: what it says to the person, the text it wrote or fixed, notes on the mistakes. */
data class BuddySaid(override val id: Int, val say: String, val text: String, val notes: List<String>, val buttons: List<ChatButton>) : ChatItem

/** A small line between messages: "👀 Looked at the screen", "📝 Remembered: …", "✅ Put it in WhatsApp". */
data class ChatEvent(override val id: Int, val text: String, val buttons: List<ChatButton> = emptyList()) : ChatItem

/** What went wrong, in red. `code` says which part of Settings "Open Settings" goes to. */
data class ChatError(override val id: Int, val text: String, val code: String, val buttons: List<ChatButton>) : ChatItem

/**
 * Everything the panel shows. `draft` is what is in the box; `boxError` what is wrong with it (too long), under the
 * box; `selection` the text the panel was opened with (Fix with Buddy, Share → Buddy), on its card.
 */
data class PanelState(
    val greeting: String = "Hi! What should we do?",
    val appName: String = "",
    val items: List<ChatItem> = emptyList(),
    val selection: String = "",
    val draft: String = "",
    val busy: Boolean = false,
    val boxError: String? = null,
)

/**
 * What the chat asks of Android, from PanelActivity or FixActivity; a test passes fakes. `stepAside` moves the panel
 * out of the app's way, keeping the chat; `screen` is one picture of the screen (base64 JPEG), null when the person
 * said no, and throws a BuddyError when it could not be taken; `replace` hands the text back to the app that opened
 * the panel on its selection (PROCESS_TEXT), which closes the panel; `openSettings` goes where the fix for the error
 * code is; `contacts` is true when Buddy may read the phone's contacts, asking the person once when it may not yet;
 * `allow` is true when Buddy holds the Android permission, asking the person once (with a line why) when it does not.
 */
class PanelHands(
    val stepAside: suspend () -> Unit = {},
    val copy: (String) -> Unit = {},
    val share: (String) -> Unit = {},
    val screen: suspend () -> String? = { null },
    val replace: (String) -> Unit = {},
    val openSettings: (String?) -> Unit = {},
    val contacts: suspend () -> Boolean = { false },
    val allow: suspend (String) -> Boolean = { false },
)

private const val RESUME_MS = 5 * 60_000L // a panel only hidden comes back on the same chat this long after
private const val HISTORY = 6
private const val COPIED = "Copied — long-press the box and tap Paste"
internal const val READY = "Your answer is ready. Open me to see it."
private const val NO_SEND = "I can't press Send on Android. Press Send yourself."
private const val NO_TYPE = "Turn on \"Buddy can type for you\" in Settings to let me read your box."
private const val NO_BOX = "Tap in the box you are writing in, then open me again."
private const val EMPTY_BOX = "That box looks empty."
private const val NO_PICTURE = "I need a picture of your screen for that. Ask me again and allow it."
private const val LOOK_AGAIN = "Open me again and ask once more, so I can look at the screen."
private const val NOT_FOUND = "I couldn't find it. Select the text and ask me again."
private const val VOICE_OFF = "Voice isn't set up yet."
private const val BOX_CHANGED = "That box has changed since, so I left it."
private const val NOT_SENT = "Okay, not sent."
private const val NOT_NOW_CALL = "Okay, not now."
private const val IN_WHATSAPP = "It's in WhatsApp, ready for you to send."
// A "message" answer to a second step: who and what may be someone else's words, read in their box or on the screen.
private const val MESSAGE_ASK = "Tell me who to message and what, and I'll do it."
// The same for the answers Buddy acts on by itself (a call, an app to open, their calls or notifications).
private const val SECOND_ASK = "Ask me that on its own, and I'll do it."
private val ACTS = setOf("call", "open", "calls", "notifs")

private enum class From { NOTHING, SELECTION, BOX }

/** How a message ended: answered (happy), stopped short (idle), its text went into the app (happy already), or gone. */
private enum class Outcome { ANSWERED, STOPPED, PUT, GONE }

/** Who a Call card calls. */
private sealed interface CallCard {
    data class Phone(val callee: Callee) : CallCard
    data class WhatsApp(val person: Person, val video: Boolean) : CallCard
}

/** What a put changed, for Undo and for a new version: the box's text and cursor before it, and the edit. */
private data class PutRecord(val before: String, val beforeCursor: Int, val edit: Edit)

/**
 * The panel as a chat, as the Mac's actions.js on a phone (the chat panel design, and the Android chat design §2-§3):
 * the person's messages and the buddy's answers, the "box" and "screen" second steps, doing it in the app through
 * "Buddy can type for you" (TypeIn) with Undo, what Buddy learns about the person (Facts), and errors with Try again.
 * A message to someone on WhatsApp (Messaging) is a card that is sent only when the person presses Send on it; an app
 * the person names (AppOpening) is opened at once. A phone call (PhoneCalling) or a WhatsApp call (WhatsAppCalling) is
 * a card too: nobody is called until the person presses Call on it. "Who is calling?" and "any missed calls?"
 * (CallTelling) are answered in a line that stays off the chat sent to the AI, as is "who messaged me?" (NotifReading).
 * One message at a time. The chat lasts until the panel is closed; a panel only hidden opens on it again within five
 * minutes, from the same app. Plain Kotlin, so that it is tested on the JVM.
 */
class PanelModel(
    private val ask: suspend (Action, AskInput) -> Answer,
    private val scope: CoroutineScope,
    private val bubble: (BubbleEvent) -> Unit,
    private val typeIn: TypeIn,
    private val facts: Facts,
    private val hands: PanelHands,
    private val messaging: Messaging,
    private val apps: AppOpening = AppOpening { error("no apps") },
    private val phone: PhoneCalling = object : PhoneCalling {
        override suspend fun find(asked: String): CallFound = error("no phone")
        override suspend fun call(callee: Callee): Called = error("no phone")
    },
    private val whatsAppCalls: WhatsAppCalling = WhatsAppCalling { _, _ -> error("no WhatsApp calls") },
    private val callInfo: CallTelling = object : CallTelling {
        override suspend fun ringing() = error("no calls")
        override suspend fun missed() = error("no calls")
    },
    private val notifs: NotifReading = NotifReading { error("no notifications") },
    private val firstName: () -> String = { "" },
    private val now: () -> Long = System::currentTimeMillis,
    private val maxMessage: Int = 1000,
    private val maxSelection: Int = 8000,
    private val talkBack: TalkBack = TalkBack.SILENT,
    private val lock: Lock = Lock.OPEN,
    private val readyLine: String = READY, // what the bubble says when an answer to put in an app waits
) {
    private class Chat(val app: String, val greeting: String) {
        val items = mutableListOf<ChatItem>()
        var nextId = 1
        var selection = ""
        var lastPut: Int? = null // the buddy's text Buddy last put in the app, which a new version replaces
        val modes = HashMap<Int, PutMode>() // how each buddy text goes in the app
        val about = HashMap<Int, String>() // the selection each buddy text was made from
        val puts = HashMap<Int, PutRecord>()
        val factOf = HashMap<Int, String>() // a "Remembered" line's fact
        val youOf = HashMap<Int, Int>() // an error's message, for Try again
        val messages = HashMap<Int, Pair<Person, String>>() // a message card's person and text, until it is sent
        val calls = HashMap<Int, CallCard>() // a call card's who, until it is called
        val offRecord = HashSet<Int>() // lines kept out of the chat sent to the AI: who called or wrote
        var spoken = false // the last message was said out loud: Buddy answers out loud
        var asking: Int? = null // the card whose question Buddy is asking out loud now
        var followUps = 0 // spoken follow-ups in a row, for a "which one?"
        var speaking = false // Buddy is speaking an answer
        var unlocking: Int? = null // the card whose send or call waits for the phone to be unlocked
        var voice = 0 // goes up whenever speech is ended: older speech steps stop at once
    }

    private val current = MutableStateFlow(PanelState())
    val state: StateFlow<PanelState> = current.asStateFlow()

    private var chat = Chat("", "")
    private var draft = ""
    private var boxError: String? = null
    private var busy = false
    private var running: Job? = null // the message the AI is answering now, if any
    private var workJob: Job? = null // the work in the app now, so that a wait for the unlock can be let go of
    private var working = false // Buddy is putting text in the app or taking it back
    private var replaceable = false // the app that opened the panel on its selection takes the fix back
    private var shown = false
    private var hiddenAt: Long? = null

    private fun publish() {
        val c = chat
        current.value = PanelState(c.greeting, c.app, c.items.toList(), c.selection, draft, busy, boxError)
    }

    private fun appLabel(c: Chat) = c.app.ifEmpty { "your app" }

    private fun mood(m: Mood) = bubble(BubbleEvent.SetMood(m))

    private fun say(text: String) = bubble(BubbleEvent.Say(text))

    // ---- openings ----

    /**
     * The panel opens (or comes back from the background): on the same chat when it was only hidden less than five
     * minutes ago and the person is in the same app, else on a new one. `selection` is the text it was opened with,
     * and `replaceable` whether the app that gave it takes the fixed text back.
     */
    fun open(selection: String = "", replaceable: Boolean = false) {
        val app = typeIn.appName()?.trim().orEmpty()
        val since = hiddenAt
        val resume = since != null && now() - since < RESUME_MS && app == chat.app
        hiddenAt = null
        shown = true
        if (!resume) newChat(app)
        chat.selection = selection
        this.replaceable = replaceable
        publish()
    }

    /** The panel is on screen again (it came back from behind the app). */
    fun shown() {
        shown = true
    }

    /** The panel went behind the app without being closed: Buddy put text there, or the person went elsewhere. */
    fun hidden() {
        shown = false
        hiddenAt = now()
    }

    /**
     * The panel was closed (✕, Back, a tap outside): the chat ends with it, and an answer still on its way is let go
     * of. Text Buddy is putting in the app, having stepped aside for it, still goes in.
     */
    fun close() {
        hush(chat)
        cancelUnlock(chat)
        if (busy) {
            running?.let {
                running = null
                it.cancel()
                mood(Mood.IDLE)
            }
            busy = false
            publish()
        }
        shown = false
        hiddenAt = null
    }

    /** A new chat in place of the last one, whose answer, if it is still on its way, is dropped. */
    private fun newChat(app: String) {
        hush(chat)
        cancelUnlock(chat)
        running?.let {
            running = null
            it.cancel()
            mood(Mood.IDLE)
        }
        busy = false
        draft = ""
        boxError = null
        val name = firstName().trim()
        chat = Chat(app, if (name.isEmpty()) "Hi! What should we do?" else "Hi $name! What should we do?")
    }

    // ---- the box ----

    fun setDraft(text: String) {
        if (text != draft) hush(chat) // typing ends any question Buddy is asking out loud
        draft = text
        boxError = null
        publish()
    }

    /**
     * Words the person said into the 🎤: with nothing typed (and no answer on its way) they go at once, as a spoken
     * message; else into the box after what is there, to send when they want.
     */
    fun voiceWords(text: String) {
        val words = text.trim()
        if (words.isEmpty()) return
        val typed = draft.trimEnd()
        if (typed.isEmpty() && !busy) return sendSpoken(words)
        setDraft(if (typed.isEmpty()) words else "$typed $words")
    }

    /** Listening went wrong: a red line, with the way to the app's microphone setting when that is the fix. */
    fun voiceError(err: BuddyError) {
        val c = chat
        when (err.code) {
            "no_microphone" -> add(c) { ChatError(it, err.message.orEmpty(), err.code, listOf(ChatButton.SETTINGS)) }
            "voice_off" -> add(c) { ChatError(it, VOICE_OFF, err.code, emptyList()) }
            else -> add(c) { ChatError(it, err.message.orEmpty(), err.code, emptyList()) }
        }
        publish()
    }

    /** ✕ on the selection card: the next message goes without it. */
    fun dropSelection() {
        chat.selection = ""
        publish()
    }

    /** The message in the box. An empty one with a selection means "fix this". One at a time: the next waits. */
    fun send() = sendText(draft, spoken = false, followUp = false, fromBox = true)

    /** A message said out loud: Buddy answers out loud too, and asks a card's question. Same checks as `send()`. */
    fun sendSpoken(text: String) = sendText(text, spoken = true, followUp = false, fromBox = false)

    private fun sendText(raw: String, spoken: Boolean, followUp: Boolean, fromBox: Boolean) {
        if (busy) return
        val c = chat
        var text = raw.trim()
        if (text.isEmpty() && fromBox && c.selection.isNotBlank()) text = "Fix this."
        if (text.isEmpty()) return
        // The AI's limits, before the message joins the chat: the person keeps their words to make shorter.
        if (text.length > maxMessage) {
            boxError = "That message is too long (over $maxMessage characters). Try a shorter one."
            publish()
            return
        }
        if (c.selection.trim().length > maxSelection) {
            boxError = "Your selection is too long (over $maxSelection characters). Press ✕ to leave it out."
            publish()
            return
        }
        hush(c)
        cancelUnlock(c)
        if (fromBox) draft = ""
        boxError = null
        c.spoken = spoken
        c.followUps = if (followUp) c.followUps + 1 else 0
        val you = add(c) { YouSaid(it, text) }
        talk(c, you.id)
    }

    /** The person pressed the 🎤: Buddy stops asking and listening first, and an answer that comes late presses nothing. */
    fun hushVoice() = hush(chat)

    /**
     * A send or call waiting for the unlock is let go of: nothing is sent or called. True when there was one. With `only`,
     * just the wait of that card (Not now on it); without, any wait (a new message, closing).
     */
    private fun cancelUnlock(c: Chat, only: Int? = null): Boolean {
        if (c.unlocking == null || (only != null && c.unlocking != only)) return false
        c.unlocking = null
        workJob?.cancel()
        workJob = null
        working = false
        return true
    }

    /** A line said out loud after a card was pressed: hush ends it, like an answer. */
    private suspend fun sayAloud(c: Chat, text: String) {
        val epoch = c.voice
        c.speaking = true
        try {
            talkBack.say(text)
        } finally {
            if (c.voice == epoch) c.speaking = false
        }
    }

    /** Any speech or question Buddy has out loud ends: nothing it hears afterwards counts. */
    private fun hush(c: Chat) {
        val asking = c.asking != null
        c.voice++
        if (asking || c.speaking) talkBack.stop()
        c.asking = null
        c.speaking = false
        if (asking && c === chat) mood(Mood.IDLE)
    }

    private fun <T : ChatItem> add(c: Chat, make: (Int) -> T): T {
        val item = make(c.nextId++)
        c.items += item
        return item
    }

    private fun replaceItem(c: Chat, item: ChatItem) {
        val at = c.items.indexOfFirst { it.id == item.id }
        if (at >= 0) c.items[at] = item
    }

    private fun buddyItem(c: Chat, id: Int) = c.items.firstOrNull { it.id == id } as? BuddySaid

    private fun setButtons(c: Chat, id: Int, buttons: List<ChatButton>) {
        buddyItem(c, id)?.let { replaceItem(c, it.copy(buttons = buttons)) }
    }

    // ---- one message through to its answer ----

    private fun talk(c: Chat, youId: Int) {
        mood(Mood.THINKING)
        busy = true
        publish()
        running = scope.launch {
            val mine = coroutineContext[Job]
            // Let go of (the panel closed, or a new chat) while the AI was busy: it changes nothing on the panel, and
            // the buddy stops thinking unless a newer message has started.
            fun letGo() {
                if (running === mine) {
                    running = null
                    mood(Mood.IDLE)
                }
            }
            try {
                val outcome = answer(c, youId)
                if (c === chat) {
                    when (outcome) {
                        Outcome.ANSWERED -> mood(Mood.HAPPY)
                        Outcome.STOPPED -> mood(Mood.IDLE)
                        Outcome.PUT, Outcome.GONE -> Unit // happy as the text went in, or nobody's now
                    }
                }
            } catch (e: CancellationException) {
                letGo()
                throw e
            } catch (e: BuddyError) {
                // A request let go of can fail rather than stop: an interrupted read is "no internet" to whatever
                // reads it. That failure is nobody's now.
                if (isActive && c === chat) fail(c, e, youId) else letGo()
            } catch (e: Exception) {
                if (!isActive || c !== chat) {
                    letGo()
                } else {
                    // A bug or a system failure, whose own words would mean nothing to the person.
                    Log.w("Buddy", "chat: unexpected ${e.javaClass.simpleName}")
                    fail(c, BuddyError("failed", "Something went wrong. Try again."), youId)
                }
            } finally {
                if (running === mine) {
                    running = null
                    busy = false
                    publish()
                }
            }
            // Out loud, for a spoken message: what the answer added, then a card's question.
            if (c.spoken && c === chat) speakAnswer(c, youId)
        }
    }

    private suspend fun speakAnswer(c: Chat, youId: Int) {
        val epoch = c.voice
        c.speaking = true
        try {
            val added = c.items.dropWhile { it.id != youId }.drop(1)
            val card = added.lastOrNull { it.id in c.messages || it.id in c.calls }
            val lines = VoiceWords.spoken(added.filter { it.id != card?.id }.map(::spokenItem))
            for (line in lines) {
                talkBack.say(line)
                if (c !== chat || c.voice != epoch) return
            }
            if (card != null) return askAloud(c, card.id, epoch)
            val last = lines.lastOrNull() ?: return
            if (!VoiceWords.asksBack(last) || c.followUps >= VoiceWords.MAX_FOLLOW_UPS) return
            val words = talkBack.listen() ?: return
            if (c === chat && c.voice == epoch && !busy) {
                c.speaking = false
                sendText(words, spoken = true, followUp = true, fromBox = false)
            }
        } finally {
            if (c.voice == epoch) c.speaking = false
        }
    }

    private fun spokenItem(item: ChatItem) = when (item) {
        is BuddySaid -> SpokenItem("buddy", item.say, item.text)
        is ChatEvent -> SpokenItem("event", text = item.text)
        is ChatError -> SpokenItem("error", text = item.text, code = item.code)
        is YouSaid -> SpokenItem("you", text = item.text)
    }

    /**
     * "To Priya Sharma: … Send it?" or "Call Prince Sharma?" out loud, then the answer: a yes presses the card's own
     * button, once, and only while this card's question is the one being asked; anything else is Not now.
     */
    private suspend fun askAloud(c: Chat, id: Int, epoch: Int) {
        val call = c.calls[id]
        val question = when (call) {
            is CallCard.Phone -> VoiceWords.question(SpokenCard.Call(call.callee.name, "phone"))
            is CallCard.WhatsApp -> VoiceWords.question(SpokenCard.Call(call.person.name, if (call.video) "whatsapp_video" else "whatsapp"))
            null -> c.messages[id]?.let { (person, text) -> VoiceWords.question(SpokenCard.Message(person.name, text)) } ?: return
        }
        val verb = if (call != null) "call" else "send"
        c.asking = id
        talkBack.say(question)
        if (c.asking != id || c !== chat || c.voice != epoch) return
        mood(Mood.THINKING) // listening: Android's head has no listening face
        val heard = talkBack.hear(verb)
        if (c.asking != id || c !== chat || c.voice != epoch) return
        c.asking = null
        mood(Mood.IDLE)
        val yes = if (verb == "call") ChatButton.CALL else ChatButton.SEND_MESSAGE
        pressOn(c, id, if (heard == Heard.YES) yes else ChatButton.NOT_NOW, spoken = true)
    }

    /** One chat request, with the AI's deadline. An answer that came without its reading is a written one. */
    private suspend fun askChat(input: AskInput): ChatReply {
        val answer = try {
            withTimeout(AI_TIMEOUT_MS.toLong()) { ask(Action.CHAT, input) }
        } catch (e: TimeoutCancellationException) {
            throw BuddyError("timeout", "Buddy took too long to answer. Try again.")
        }
        return answer.chat ?: ChatReply("write", "", answer.text, emptyList(), false, false, emptyList(), false)
    }

    private fun historyBefore(c: Chat, youId: Int): List<ChatTurn> =
        c.items.takeWhile { it.id != youId }
            .filter { it.id !in c.offRecord }
            .mapNotNull {
                when (it) {
                    is YouSaid -> ChatTurn("you", it.text)
                    is BuddySaid -> ChatTurn("buddy", listOf(it.say, it.text).filter(String::isNotEmpty).joinToString("\n\n"))
                    else -> null
                }
            }
            .filter { it.text.isNotEmpty() }
            .takeLast(HISTORY)

    /** Buddy stopped short: a red line saying why. */
    private fun stop(c: Chat, code: String, text: String, buttons: List<ChatButton> = emptyList()): Outcome {
        add(c) { ChatError(it, text, code, buttons) }
        return Outcome.STOPPED
    }

    /**
     * Ask the AI about the message and do what its answer says. At most one second step: the text of the person's box,
     * or a picture of the screen, when the first answer asks for it.
     */
    private suspend fun answer(c: Chat, youId: Int): Outcome {
        val you = c.items.first { it.id == youId } as YouSaid
        val base = AskInput(
            message = you.text,
            history = historyBefore(c, youId),
            facts = facts.facts().map { it.text },
            appName = c.app.ifEmpty { null },
            userName = firstName().trim().ifEmpty { null },
            canMessage = true, // this app can message on WhatsApp
            canOpen = true, // this app can open apps
            canCall = true, // this app can call: by phone and on WhatsApp
            canSeeCalls = true, // this app can tell who is calling, and the missed calls
            canReadNotifs = true, // this app can read the phone's notifications
        )
        val sent = c.selection
        val selection = sent.ifEmpty { null }
        var from = if (sent.isEmpty()) From.NOTHING else From.SELECTION
        var second = false // whether the answer is to a second step
        var reply = askChat(base.copy(selection = selection, step = 1))
        if (c !== chat) return Outcome.GONE
        // Facts come from this first answer only: the second one has read the box or the screen, whose text could
        // tell the AI to "remember" anything.
        remember(c, reply.remember)
        publish()
        if (reply.kind == "box") {
            if (!typeIn.on()) return stop(c, "no_type", NO_TYPE, listOf(ChatButton.SETTINGS))
            val box = typeIn.read()
            if (c !== chat) return Outcome.GONE
            if (box == null) return stop(c, "no_box", NO_BOX)
            if (box.text.isBlank()) return stop(c, "empty_box", EMPTY_BOX)
            add(c) { ChatEvent(it, "📖 Read your text") }
            publish()
            reply = askChat(base.copy(box = box.text, step = 2)) // the box takes the place of the selection
            if (c !== chat) return Outcome.GONE
            from = From.BOX
            second = true
        } else if (reply.kind == "screen") {
            if (!shown) {
                add(c) { BuddySaid(it, LOOK_AGAIN, "", emptyList(), emptyList()) }
                return Outcome.STOPPED
            }
            val image = hands.screen()
            if (c !== chat) return Outcome.GONE
            if (image == null) return stop(c, "no_picture", NO_PICTURE)
            add(c) { ChatEvent(it, "👀 Looked at the screen") }
            publish()
            reply = askChat(base.copy(selection = selection, image = image, step = 2))
            if (c !== chat) return Outcome.GONE
            second = true
        }
        busy = false // the answer is in: what is left is Buddy's own work
        publish()
        if (reply.kind == "box" || reply.kind == "screen") return stop(c, "not_found", NOT_FOUND)
        // The selection went with this message: the next one goes without it.
        if (c.selection == sent) c.selection = ""
        // A message only from a first answer: a second one has read their box or the screen, whose words (a mail
        // someone sent them, a web page) could say who to message and what. Nobody is looked up; Buddy asks them.
        if (second && reply.kind == "message") {
            add(c) { BuddySaid(it, MESSAGE_ASK, "", emptyList(), emptyList()) }
            return Outcome.ANSWERED
        }
        // The same for a call, an app to open, their calls or notifications: Buddy does these by itself, so only from
        // their own words.
        if (second && reply.kind in ACTS) {
            add(c) { BuddySaid(it, SECOND_ASK, "", emptyList(), emptyList()) }
            return Outcome.ANSWERED
        }
        return finish(c, reply, from, sent)
    }

    private fun remember(c: Chat, found: List<String>) {
        for (text in found) {
            val fact = facts.add(text, "chat") ?: continue
            val line = add(c) { ChatEvent(it, "📝 Remembered: ${fact.text}", listOf(ChatButton.UNDO)) }
            c.factOf[line.id] = fact.id
        }
    }

    /** Insert at the cursor, or Replace over the selection or the box, when Buddy can put it there; Copy and Share. */
    private fun putButtons(mode: PutMode): List<ChatButton> {
        val canPut = typeIn.on() || (mode == PutMode.REPLACE && replaceable)
        val put = if (mode == PutMode.INSERT) ChatButton.INSERT else ChatButton.REPLACE
        return if (canPut) listOf(put, ChatButton.COPY, ChatButton.SHARE) else listOf(ChatButton.COPY, ChatButton.SHARE)
    }

    /** The final answer: what it shows, and what Buddy does in the app. */
    private suspend fun finish(c: Chat, reply: ChatReply, from: From, sent: String): Outcome {
        if (reply.kind == "message") return message(c, reply)
        if (reply.kind == "open") return openApp(c, reply)
        if (reply.kind == "call" && reply.how == "phone") return phoneCall(c, reply)
        if (reply.kind == "call") return whatsAppCall(c, reply)
        if (reply.kind == "calls") return tellCalls(c, reply)
        if (reply.kind == "notifs") return showTold(c, notifs.read(reply.app))
        if (reply.kind == "send") {
            add(c) { BuddySaid(it, NO_SEND, "", emptyList(), emptyList()) }
            return Outcome.ANSWERED
        }
        // Text read from the box goes back over the whole box; a fix of the selection over the selection; the rest at
        // the cursor.
        val mode = when {
            from == From.BOX -> PutMode.REPLACE_ALL
            from == From.SELECTION && reply.kind == "fix" -> PutMode.REPLACE
            else -> PutMode.INSERT
        }
        val putting = reply.kind == "write" || reply.kind == "fix"
        val buttons = when {
            reply.text.isEmpty() -> emptyList()
            putting -> putButtons(mode)
            else -> listOf(ChatButton.COPY) // an answer (and the desktop's "code"): nothing goes in the app
        }
        val item = add(c) { BuddySaid(it, reply.say, reply.text, reply.notes, buttons) }
        c.modes[item.id] = mode
        c.about[item.id] = sent
        publish()
        if (!putting || !reply.doIt || reply.text.isEmpty()) return Outcome.ANSWERED
        // Only while the person is still with Buddy: when they left meanwhile, the answer waits in the chat.
        if (!shown) {
            say(readyLine)
            return Outcome.ANSWERED
        }
        return if (putInApp(c, item.id, reply.again)) Outcome.PUT else Outcome.ANSWERED
    }

    /**
     * A message to someone on WhatsApp: who it is (asking for the contacts first), then a card with Send and Not now.
     * Nothing is opened or sent until Send is pressed.
     */
    private suspend fun message(c: Chat, reply: ChatReply): Outcome {
        if (reply.say.isNotBlank()) {
            add(c) { BuddySaid(it, reply.say, "", emptyList(), emptyList()) }
            publish()
        }
        val found = messaging.find(reply.to)
        if (c !== chat) return Outcome.GONE
        when (found) {
            is Found.Say -> {
                if (found.code != null) {
                    return stop(c, found.code, found.line, if (found.code in SETTINGS_ERRORS) listOf(ChatButton.SETTINGS) else emptyList())
                }
                add(c) { BuddySaid(it, "", found.line, emptyList(), emptyList()) }
            }
            is Found.One -> {
                val card = add(c) {
                    BuddySaid(it, "", "To ${found.person.name}:\n${reply.text}", emptyList(), listOf(ChatButton.SEND_MESSAGE, ChatButton.NOT_NOW))
                }
                c.messages[card.id] = found.person to reply.text
            }
        }
        return Outcome.ANSWERED
    }

    /** "Open YouTube": opened at once, no question; the chat says it was, or which one or why not. */
    private suspend fun openApp(c: Chat, reply: ChatReply): Outcome {
        if (reply.say.isNotBlank()) {
            add(c) { BuddySaid(it, reply.say, "", emptyList(), emptyList()) }
            publish()
        }
        val opened = apps.open(reply.app)
        if (c !== chat) return Outcome.GONE
        when (opened) {
            is Opened.Done -> add(c) { ChatEvent(it, "✅ Opened ${opened.label}") }
            is Opened.Say -> add(c) { BuddySaid(it, "", opened.line, emptyList(), emptyList()) }
        }
        return Outcome.ANSWERED
    }

    /** "Call Prince": who it is (asking for the contacts first), then a card with Call and Not now. Nothing rings yet. */
    private suspend fun phoneCall(c: Chat, reply: ChatReply): Outcome {
        if (reply.say.isNotBlank()) {
            add(c) { BuddySaid(it, reply.say, "", emptyList(), emptyList()) }
            publish()
        }
        val found = phone.find(reply.to)
        if (c !== chat) return Outcome.GONE
        when (found) {
            is CallFound.Say -> {
                if (found.code != null) {
                    return stop(c, found.code, found.line, if (found.code in SETTINGS_ERRORS) listOf(ChatButton.SETTINGS) else emptyList())
                }
                add(c) { BuddySaid(it, "", found.line, emptyList(), emptyList()) }
            }
            is CallFound.One -> {
                val card = add(c) { BuddySaid(it, "", "Call ${found.callee.name}?", emptyList(), listOf(ChatButton.CALL, ChatButton.NOT_NOW)) }
                c.calls[card.id] = CallCard.Phone(found.callee)
            }
        }
        return Outcome.ANSWERED
    }

    /** "Who is calling?" / "Any missed calls?" */
    private suspend fun tellCalls(c: Chat, reply: ChatReply): Outcome =
        showTold(c, if (reply.what == "missed") callInfo.missed() else callInfo.ringing())

    /**
     * A line about the phone's calls or notifications: shown, but kept off the chat sent to the AI, as it names the
     * people who called or wrote. The AI's own `say` is left out: the line is the answer.
     */
    private fun showTold(c: Chat, told: Told): Outcome {
        if (c !== chat) return Outcome.GONE
        val code = told.code
        if (code != null) return stop(c, code, told.line, if (code in SETTINGS_ERRORS) listOf(ChatButton.SETTINGS) else emptyList())
        val line = add(c) { BuddySaid(it, "", told.line, emptyList(), emptyList()) }
        c.offRecord += line.id
        return Outcome.ANSWERED
    }

    /**
     * "WhatsApp call Prince": who it is on WhatsApp (as for a message), then a card with Call and Not now. Nothing is
     * opened or rings until Call is pressed.
     */
    private suspend fun whatsAppCall(c: Chat, reply: ChatReply): Outcome {
        if (reply.say.isNotBlank()) {
            add(c) { BuddySaid(it, reply.say, "", emptyList(), emptyList()) }
            publish()
        }
        val found = messaging.find(reply.to)
        if (c !== chat) return Outcome.GONE
        when (found) {
            is Found.Say -> {
                if (found.code != null) {
                    return stop(c, found.code, found.line, if (found.code in SETTINGS_ERRORS) listOf(ChatButton.SETTINGS) else emptyList())
                }
                add(c) { BuddySaid(it, "", found.line, emptyList(), emptyList()) }
            }
            is Found.One -> {
                val video = reply.how == "whatsapp_video"
                val ask = if (video) "WhatsApp video call ${found.person.name}?" else "WhatsApp call ${found.person.name}?"
                val card = add(c) { BuddySaid(it, "", ask, emptyList(), listOf(ChatButton.CALL, ChatButton.NOT_NOW)) }
                c.calls[card.id] = CallCard.WhatsApp(found.person, video)
            }
        }
        return Outcome.ANSWERED
    }

    /**
     * Call on a call card: the card's own person, once. Called: the card says so. Not called, before anything was
     * pressed: a red line says why and the card stays, to press Call again. Stopped after the call button was pressed,
     * or not sure (the call threw too): the card says so, and goes (never a second call).
     */
    private suspend fun placeCall(c: Chat, id: Int) {
        val first = c.calls[id] ?: return
        if (!unlockedFor(c, id, "call", nameOf(first))) return
        if (first is CallCard.WhatsApp) hands.stepAside() // nothing called yet: should it throw, the card stays
        // Taken off the card before calling, and put back only when it did not call: should the call throw, whether it
        // rang is not known, and the card must not call a second time.
        val card = c.calls.remove(id) ?: return
        val called = try {
            when (card) {
                is CallCard.Phone -> phone.call(card.callee)
                is CallCard.WhatsApp -> whatsAppCalls.call(card.person, card.video)
            }
        } catch (e: Exception) {
            currentCoroutineContext().ensureActive() // the panel's own cancel goes on; anything else is "not sure"
            Log.w("Buddy", "call: unexpected ${e.javaClass.simpleName}")
            Called.Unsure
        }
        var aloud = ""
        when (called) {
            Called.Done -> {
                replaceItem(c, ChatEvent(id, calledLine(card)))
                mood(Mood.HAPPY)
                aloud = VoiceWords.calling(nameOf(card))
            }
            Called.Unsure -> {
                val line = if (card is CallCard.Phone) PHONE_CALL_UNSURE else CALL_UNSURE
                replaceItem(c, ChatEvent(id, line))
                say(line)
                aloud = line
            }
            is Called.Ended -> {
                replaceItem(c, ChatEvent(id, called.line))
                say(called.line)
                aloud = called.line
            }
            is Called.Failed -> {
                c.calls[id] = card
                val code = called.code ?: "call_failed"
                add(c) { ChatError(it, called.line, code, if (code in SETTINGS_ERRORS) listOf(ChatButton.SETTINGS) else emptyList()) }
                say(called.line)
                aloud = called.line
            }
        }
        publish()
        if (c.spoken) sayAloud(c, aloud)
    }

    private fun calledLine(card: CallCard) = when (card) {
        is CallCard.Phone -> "📞 Calling ${card.callee.name}"
        is CallCard.WhatsApp -> if (card.video) "📹 Video calling ${card.person.name} on WhatsApp" else "📞 Calling ${card.person.name} on WhatsApp"
    }

    /** A line in the chat that is not an answer: why Android is about to ask for a permission. */
    fun note(text: String) {
        add(chat) { ChatEvent(it, text) }
        publish()
    }

    /**
     * Send on a message card, out of the way: WhatsApp opens the chat, Buddy checks it is theirs and presses Send.
     * When it was not sent, a red line says why and the card stays, to press Send again; but when the text was left
     * in their chat for them to send (Accessibility off, Send not pressed), the card only says so.
     */
    private suspend fun sendMessage(c: Chat, id: Int) {
        val (person, text) = c.messages[id] ?: return
        if (!unlockedFor(c, id, "message", person.name)) return
        hands.stepAside()
        var aloud = ""
        when (val sent = messaging.send(person, text)) {
            Sent.Done -> {
                c.messages.remove(id)
                replaceItem(c, ChatEvent(id, "✅ Sent to ${person.name}"))
                say("Sent ✅")
                mood(Mood.HAPPY)
                aloud = VoiceWords.SENT
            }
            Sent.Unsure -> {
                // Pressed, or maybe pressed: no red error and no second Send, only the line to check WhatsApp.
                c.messages.remove(id)
                replaceItem(c, ChatEvent(id, NOT_SURE))
                say(NOT_SURE)
                aloud = NOT_SURE
            }
            is Sent.Failed -> {
                if (sent.inWhatsApp) {
                    // The text waits in their chat for them to press Send: offering Send again could send it twice.
                    c.messages.remove(id)
                    replaceItem(c, ChatEvent(id, IN_WHATSAPP))
                }
                val code = sent.code ?: "message_failed"
                add(c) { ChatError(it, sent.line, code, if (code in SETTINGS_ERRORS) listOf(ChatButton.SETTINGS) else emptyList()) }
                say(sent.line)
                aloud = sent.line
            }
        }
        publish()
        if (c.spoken) sayAloud(c, aloud)
    }

    private fun nameOf(card: CallCard) = when (card) {
        is CallCard.Phone -> card.callee.name
        is CallCard.WhatsApp -> card.person.name
    }

    /**
     * A locked phone: Buddy asks for the unlock and waits a minute (the spec's locked rule, for calls too). Still
     * locked: the card goes, and says so. True when it may go on (the card still there, in this chat).
     */
    private suspend fun unlockedFor(c: Chat, id: Int, kind: String, name: String): Boolean {
        if (!lock.locked()) return true
        val ask = VoiceWords.unlockLine("phone", kind, name)
        say(ask)
        val gave = if (kind == "call") VoiceWords.DIDNT_CALL else VoiceWords.DIDNT_SEND
        c.unlocking = id
        val opened = try {
            if (c.spoken) sayAloud(c, ask)
            lock.unlocked(VoiceWords.UNLOCK_WAIT_MS).also { currentCoroutineContext().ensureActive() }
        } finally {
            if (c.unlocking == id) c.unlocking = null
        }
        if (opened) {
            if (c === chat && (c.messages.containsKey(id) || c.calls.containsKey(id))) return true
            // Unlocked, but the chat or the card changed meanwhile: nothing goes.
            say(gave)
            if (c.spoken) sayAloud(c, gave)
            return false
        }
        c.messages.remove(id)
        c.calls.remove(id)
        replaceItem(c, ChatEvent(id, gave))
        publish()
        if (c.spoken) sayAloud(c, gave)
        return false
    }

    /**
     * Put a buddy's text in the app: handed back to the app that gave the selection when it takes it, else through
     * "Buddy can type for you", with the panel out of the way. When it cannot go in, it is copied and the bubble says
     * how to paste it. `again`: a new version of the last text put in, which takes its place while it can be undone.
     * True when it went in.
     */
    private suspend fun putInApp(c: Chat, id: Int, again: Boolean): Boolean {
        val item = buddyItem(c, id) ?: return false
        val mode = c.modes[id] ?: PutMode.INSERT
        if (mode == PutMode.REPLACE && replaceable) {
            hands.replace(item.text)
            setButtons(c, id, listOf(ChatButton.COPY))
            wentIn(c)
            return true
        }
        if (!typeIn.on()) {
            copied(c, item.text, aside = false)
            return false
        }
        hands.stepAside()
        val box = typeIn.read()
        if (c !== chat) return false
        if (box == null) {
            copied(c, item.text, aside = true)
            return false
        }
        // A new version goes in the last one's place only while the box still has what Buddy put there; when the
        // person has changed it since, it goes in as a new text, and nothing of theirs is written over.
        val lastId = c.lastPut
        val over = lastId?.takeIf { again && buddyItem(c, it)?.buttons?.contains(ChatButton.UNDO) == true }
            ?.let { c.puts[it] }
            ?.takeIf { it.edit.text == box.text }
        val before: String
        val beforeCursor: Int
        val edit: Edit
        if (over != null) {
            before = over.before
            beforeCursor = over.beforeCursor
            edit = TextEdit.again(over.before, over.edit, item.text)
        } else {
            before = box.text
            beforeCursor = box.selEnd.takeIf { it in 0..box.text.length } ?: box.text.length
            edit = TextEdit.put(box, mode, item.text, c.about[id].orEmpty())
        }
        val wrote = typeIn.write(edit.text, edit.cursor)
        if (c !== chat) return false
        if (!wrote) {
            copied(c, item.text, aside = true)
            return false
        }
        // The last text's place is taken: it cannot be undone any more.
        if (over != null) buddyItem(c, lastId)?.let { setButtons(c, it.id, it.buttons - ChatButton.UNDO) }
        c.puts[id] = PutRecord(before, beforeCursor, edit)
        c.lastPut = id
        setButtons(c, id, listOf(ChatButton.UNDO, ChatButton.COPY))
        wentIn(c)
        return true
    }

    private fun wentIn(c: Chat) {
        add(c) { ChatEvent(it, "✅ Put it in ${appLabel(c)}") }
        say("Done! It's in ${appLabel(c)} ✅")
        mood(Mood.HAPPY)
        publish()
    }

    /** The text on the clipboard, the bubble saying how to paste it, and the panel out of the way to paste. */
    private suspend fun copied(c: Chat, text: String, aside: Boolean) {
        hands.copy(text)
        add(c) { ChatEvent(it, COPIED) }
        say(COPIED)
        publish()
        if (!aside) hands.stepAside()
    }

    /**
     * Undo on text Buddy put in the app: the box gets back the text it had before, but only while it still has what
     * Buddy put there. A box the person has changed since is left alone, and its Undo goes.
     */
    private suspend fun undo(c: Chat, id: Int) {
        val record = c.puts[id] ?: return
        hands.stepAside()
        val box = typeIn.read()
        if (c !== chat) return
        if (box != null && box.text != record.edit.text) {
            buddyItem(c, id)?.let { setButtons(c, id, it.buttons - ChatButton.UNDO) }
            add(c) { ChatError(it, BOX_CHANGED, "box_changed", emptyList()) }
            say(BOX_CHANGED)
            publish()
            return
        }
        val ok = box != null && typeIn.write(record.before, record.beforeCursor)
        if (c !== chat) return
        if (ok) {
            buddyItem(c, id)?.let { setButtons(c, id, it.buttons - ChatButton.UNDO) }
            say("Undone")
        } else {
            add(c) { ChatError(it, "I couldn't undo it: that box is gone.", "undo_failed", emptyList()) }
        }
        publish()
    }

    /**
     * Buddy's own work in the app, one at a time: a quick second press does nothing. It runs in the app's scope, so
     * nothing may escape it: a failure is a red line (and the bubble says it, as the panel may be behind the app).
     */
    private fun inApp(work: suspend () -> Unit) {
        if (working) return
        working = true
        val c = chat
        scope.launch {
            val me = currentCoroutineContext()[Job]
            workJob = me
            try {
                work()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                val err = e as? BuddyError ?: BuddyError("failed", "Something went wrong. Try again.").also {
                    Log.w("Buddy", "in the app: unexpected ${e.javaClass.simpleName}")
                }
                if (c === chat) {
                    add(c) { ChatError(it, err.message.orEmpty(), err.code, emptyList()) }
                    say(err.message.orEmpty())
                    publish()
                }
            } finally {
                if (workJob === me) {
                    workJob = null
                    working = false
                }
            }
        }
    }

    // ---- the buttons ----

    /** A button on a line of the chat. Only a button the line shows can be pressed. */
    fun press(id: Int, button: ChatButton) {
        hush(chat) // the person's own press ends any question Buddy is asking out loud
        pressOn(chat, id, button, spoken = false)
    }

    /** The one press path: the person's button, or their spoken yes or no (`spoken`), for the card in chat `c`. */
    private fun pressOn(c: Chat, id: Int, button: ChatButton, spoken: Boolean) {
        if (c !== chat) return
        val item = c.items.firstOrNull { it.id == id } ?: return
        val buttons = when (item) {
            is BuddySaid -> item.buttons
            is ChatEvent -> item.buttons
            is ChatError -> item.buttons
            is YouSaid -> emptyList()
        }
        if (button !in buttons) return
        val text = (item as? BuddySaid)?.text.orEmpty()
        when (button) {
            ChatButton.COPY -> {
                hands.copy(text)
                say(COPIED)
                scope.launch { hands.stepAside() } // so that the person can paste it
            }
            ChatButton.SHARE -> hands.share(text)
            ChatButton.SETTINGS -> hands.openSettings((item as? ChatError)?.code)
            ChatButton.INSERT, ChatButton.REPLACE -> inApp { putInApp(c, id, again = false) }
            ChatButton.UNDO -> {
                val fact = c.factOf[id]
                if (item is ChatEvent && fact != null) {
                    // A fact Buddy remembered, forgotten again.
                    facts.remove(fact)
                    replaceItem(c, ChatEvent(id, "Okay, I forgot that."))
                    publish()
                } else {
                    inApp { undo(c, id) }
                }
            }
            ChatButton.SEND_MESSAGE -> inApp { sendMessage(c, id) }
            ChatButton.CALL -> inApp { placeCall(c, id) }
            ChatButton.NOT_NOW -> {
                // Being sent or called now: too late. While a card only waits for the unlock, Not now on that card ends the wait
                // and Not now on another card leaves it alone.
                if (working && !cancelUnlock(c, id) && c.unlocking == null) return
                // A call card is the one with Call: "not now" whether or not its call is still kept.
                val call = ChatButton.CALL in buttons || c.calls.containsKey(id)
                c.calls.remove(id)
                c.messages.remove(id)
                val line = if (call) NOT_NOW_CALL else NOT_SENT
                replaceItem(c, ChatEvent(id, line))
                publish()
                if (spoken) scope.launch { sayAloud(c, if (call) VoiceWords.NOT_NOW else VoiceWords.NOT_SENT) }
            }
            ChatButton.RETRY -> {
                if (busy) return
                val you = c.youOf[id] ?: return
                c.items.removeAll { it.id == id }
                talk(c, you)
            }
        }
    }

    // ---- errors ----

    private fun fail(c: Chat, err: BuddyError, youId: Int) {
        val code = err.code
        val buttons = buildList {
            if (code != "bad_request") add(ChatButton.RETRY)
            if (code in SETTINGS_ERRORS) add(ChatButton.SETTINGS)
        }
        val line = add(c) { ChatError(it, err.message.orEmpty(), code, buttons) }
        c.youOf[line.id] = youId
        mood(if (code == "network" || code == "timeout") Mood.SLEEPY else Mood.IDLE)
        publish()
    }

    companion object {
        /**
         * Errors whose fix is in Settings, as the Mac's: no key yet, a key that was refused, an account out of credit,
         * a model that cannot be used; signed out, today's free requests used up with own keys allowed but none saved,
         * free mode turned off, a copy of Buddy that cannot sign in; Buddy off (no picture of the screen without it);
         * "Buddy can type for you" off; the microphone or the contacts not allowed (the app's own Android settings);
         * the call permission not allowed (the same); the call log not allowed (the same); Notification access off;
         * Buddy off in Android's Accessibility settings, so it cannot press WhatsApp's Send. They come with "Open Settings".
         */
        val SETTINGS_ERRORS = setOf(
            "no_key", "bad_key", "no_credit", "bad_model", "no_vision", "signed_out", "need_key", "free_off", "not_set_up",
            "buddy_off", "no_type", "no_microphone", "no_contacts", "no_accessibility", "no_calls", "no_call_log",
            "no_notifs",
        )
    }
}
