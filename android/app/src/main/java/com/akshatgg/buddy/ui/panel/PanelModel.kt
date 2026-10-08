package com.akshatgg.buddy.ui.panel

import android.util.Log
import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.AskInput
import com.akshatgg.buddy.ai.ChatReply
import com.akshatgg.buddy.ai.ChatTurn
import com.akshatgg.buddy.ai.providers.AI_TIMEOUT_MS
import com.akshatgg.buddy.bubble.BubbleEvent
import com.akshatgg.buddy.bubble.Mood
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.store.Facts
import com.akshatgg.buddy.typing.Edit
import com.akshatgg.buddy.typing.PutMode
import com.akshatgg.buddy.typing.TextEdit
import com.akshatgg.buddy.typing.TypeIn
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/** A button on a line of the chat. */
enum class ChatButton { INSERT, REPLACE, COPY, SHARE, UNDO, RETRY, SETTINGS }

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
 * code is.
 */
class PanelHands(
    val stepAside: suspend () -> Unit = {},
    val copy: (String) -> Unit = {},
    val share: (String) -> Unit = {},
    val screen: suspend () -> String? = { null },
    val replace: (String) -> Unit = {},
    val openSettings: (String?) -> Unit = {},
)

private const val RESUME_MS = 5 * 60_000L // a panel only hidden comes back on the same chat this long after
private const val HISTORY = 6
private const val COPIED = "Copied — long-press the box and tap Paste"
private const val READY = "Your answer is ready. Open me to see it."
private const val NO_SEND = "I can't press Send on Android. Press Send yourself."
private const val NO_TYPE = "Turn on \"Buddy can type for you\" in Settings to let me read your box."
private const val NO_BOX = "Tap in the box you are writing in, then open me again."
private const val EMPTY_BOX = "That box looks empty."
private const val NO_PICTURE = "I need a picture of your screen for that. Ask me again and allow it."
private const val LOOK_AGAIN = "Open me again and ask once more, so I can look at the screen."
private const val NOT_FOUND = "I couldn't find it. Select the text and ask me again."
private const val VOICE_OFF = "Voice isn't set up yet."
private const val BOX_CHANGED = "That box has changed since, so I left it."

private enum class From { NOTHING, SELECTION, BOX }

/** How a message ended: answered (happy), stopped short (idle), its text went into the app (happy already), or gone. */
private enum class Outcome { ANSWERED, STOPPED, PUT, GONE }

/** What a put changed, for Undo and for a new version: the box's text and cursor before it, and the edit. */
private data class PutRecord(val before: String, val beforeCursor: Int, val edit: Edit)

/**
 * The panel as a chat, as the Mac's actions.js on a phone (the chat panel design, and the Android chat design §2-§3):
 * the person's messages and the buddy's answers, the "box" and "screen" second steps, doing it in the app through
 * "Buddy can type for you" (TypeIn) with Undo, what Buddy learns about the person (Facts), and errors with Try again.
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
    private val firstName: () -> String = { "" },
    private val now: () -> Long = System::currentTimeMillis,
    private val maxMessage: Int = 1000,
    private val maxSelection: Int = 8000,
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
    }

    private val current = MutableStateFlow(PanelState())
    val state: StateFlow<PanelState> = current.asStateFlow()

    private var chat = Chat("", "")
    private var draft = ""
    private var boxError: String? = null
    private var busy = false
    private var running: Job? = null // the message the AI is answering now, if any
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
        draft = text
        boxError = null
        publish()
    }

    /** Words the person said (voice): into the box after what is there, to send when they want. */
    fun voiceWords(text: String) {
        val words = text.trim()
        if (words.isEmpty()) return
        val typed = draft.trimEnd()
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
    fun send() {
        if (busy) return
        val c = chat
        var text = draft.trim()
        if (text.isEmpty() && c.selection.isNotBlank()) text = "Fix this."
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
        draft = ""
        boxError = null
        val you = add(c) { YouSaid(it, text) }
        talk(c, you.id)
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
        }
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
        )
        val sent = c.selection
        val selection = sent.ifEmpty { null }
        var from = if (sent.isEmpty()) From.NOTHING else From.SELECTION
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
        }
        busy = false // the answer is in: what is left is Buddy's own work
        publish()
        if (reply.kind == "box" || reply.kind == "screen") return stop(c, "not_found", NOT_FOUND)
        // The selection went with this message: the next one goes without it.
        if (c.selection == sent) c.selection = ""
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
            say(READY)
            return Outcome.ANSWERED
        }
        return if (putInApp(c, item.id, reply.again)) Outcome.PUT else Outcome.ANSWERED
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
                working = false
            }
        }
    }

    // ---- the buttons ----

    /** A button on a line of the chat. Only a button the line shows can be pressed. */
    fun press(id: Int, button: ChatButton) {
        val c = chat
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
         * "Buddy can type for you" off; the microphone not allowed (the app's own Android settings). They come with
         * "Open Settings".
         */
        val SETTINGS_ERRORS = setOf(
            "no_key", "bad_key", "no_credit", "bad_model", "no_vision", "signed_out", "need_key", "free_off", "not_set_up",
            "buddy_off", "no_type", "no_microphone",
        )
    }
}
