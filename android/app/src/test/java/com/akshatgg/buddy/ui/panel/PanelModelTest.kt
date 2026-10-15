package com.akshatgg.buddy.ui.panel

import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.AskInput
import com.akshatgg.buddy.ai.ChatReply
import com.akshatgg.buddy.ai.ChatTurn
import com.akshatgg.buddy.apps.AppOpening
import com.akshatgg.buddy.apps.Opened
import com.akshatgg.buddy.bubble.BubbleEvent
import com.akshatgg.buddy.bubble.Mood
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.message.Found
import com.akshatgg.buddy.message.Messaging
import com.akshatgg.buddy.message.Person
import com.akshatgg.buddy.message.Sent
import com.akshatgg.buddy.store.Fact
import com.akshatgg.buddy.store.Facts
import com.akshatgg.buddy.typing.BoxText
import com.akshatgg.buddy.typing.TypeIn
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.cancel
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private class FakeTypeIn : TypeIn {
    var on = true
    var app: String? = "WhatsApp"
    var box: BoxText? = BoxText("", 0, 0)
    var writable = true
    var failRead: Exception? = null
    val writes = mutableListOf<Pair<String, Int>>()
    override fun on() = on
    override fun appName() = app
    override suspend fun read(): BoxText? {
        failRead?.let { throw it }
        return box
    }
    override suspend fun write(text: String, cursor: Int): Boolean {
        writes += text to cursor
        if (writable) box = BoxText(text, cursor, cursor)
        return writable
    }
}

private class FakeFacts : Facts {
    val kept = mutableListOf<Fact>()
    var refuse = false
    override fun facts() = kept.toList()
    override fun add(text: String, source: String): Fact? {
        if (refuse || source != "chat") return null
        return Fact("f${kept.size + 1}", text, 0L).also { kept += it }
    }
    override fun remove(id: String) = kept.removeIf { it.id == id }
    override val learning = true
}

/** Messaging on WhatsApp, as the panel asks it: queued answers, and each call in `log` (shared with the hands). */
private class FakeMessaging(val log: MutableList<String>) : Messaging {
    val found = ArrayDeque<Found>()
    val sent = ArrayDeque<Sent>()
    var sending: CompletableDeferred<Unit>? = null // a send that takes until this is completed
    override suspend fun find(asked: String): Found {
        log += "find $asked"
        return found.removeFirstOrNull() ?: Found.Say("I couldn't find $asked on WhatsApp.")
    }
    override suspend fun send(person: Person, text: String): Sent {
        log += "send ${person.name}: $text"
        sending?.await()
        return sent.removeFirstOrNull() ?: Sent.Done
    }
}

/** Opening apps, as the panel asks it: queued answers, and each call in `log` (shared with the hands). */
private class FakeApps(val log: MutableList<String>) : AppOpening {
    val opened = ArrayDeque<Opened>()
    override suspend fun open(asked: String): Opened {
        log += "open $asked"
        return opened.removeFirstOrNull() ?: Opened.Say("I couldn't find $asked on this phone.")
    }
}

@OptIn(ExperimentalCoroutinesApi::class) // runTest's clock: runCurrent, advanceTimeBy, advanceUntilIdle, StandardTestDispatcher
class PanelModelTest {
    private val asked = mutableListOf<AskInput>()
    private val events = mutableListOf<BubbleEvent>()
    private val moods get() = events.filterIsInstance<BubbleEvent.SetMood>().map { it.mood }
    private val said get() = events.filterIsInstance<BubbleEvent.Say>().map { it.text }
    private val replies = ArrayDeque<ChatReply>()
    private var reply: suspend (AskInput) -> Answer = { _ ->
        val r = replies.removeFirstOrNull() ?: written("Dear Sir,")
        Answer("raw", "m", chat = r)
    }
    private val typeIn = FakeTypeIn()
    private val facts = FakeFacts()
    private val log = mutableListOf<String>() // what the panel did with Android: stepped aside, copied, shared, …
    private val messaging = FakeMessaging(log)
    private val apps = FakeApps(log)
    private var picture: String? = "IMG"
    private var pictureError: BuddyError? = null
    private var clock = 1_000_000L

    private fun written(text: String, kind: String = "write", say: String = "", doIt: Boolean = false, again: Boolean = false, remember: List<String> = emptyList(), notes: List<String> = emptyList()) =
        ChatReply(kind, say, text, notes, doIt, false, remember, again)

    private fun answers(vararg r: ChatReply) = replies.addAll(r)

    private fun model(scope: CoroutineScope, name: String = "Akshat") = PanelModel(
        ask = { action, input -> assertEquals(Action.CHAT, action); asked += input; reply(input) },
        scope = scope,
        bubble = { events += it },
        typeIn = typeIn,
        facts = facts,
        hands = PanelHands(
            stepAside = { log += "aside" },
            copy = { log += "copy $it" },
            share = { log += "share $it" },
            screen = { log += "screen"; pictureError?.let { throw it }; picture },
            replace = { log += "replace $it" },
            openSettings = { log += "settings $it" },
        ),
        messaging = messaging,
        apps = apps,
        firstName = { name },
        now = { clock },
    ).apply { open() }

    private fun TestScope.model(name: String = "Akshat") = model(this, name)

    private fun PanelModel.say(text: String) {
        setDraft(text)
        send()
    }

    private val PanelModel.items get() = state.value.items

    private fun PanelModel.last() = items.last()

    private fun PanelModel.buddy() = items.filterIsInstance<BuddySaid>().last()

    private fun PanelModel.errorLine() = items.filterIsInstance<ChatError>().last()

    // ---- the chat ----

    @Test fun anEmptyChatGreetsThePersonByFirstName() = runTest {
        assertEquals("Hi Akshat! What should we do?", model().state.value.greeting)
        assertEquals("Hi! What should we do?", model(name = "").state.value.greeting)
        assertEquals("WhatsApp", model().state.value.appName)
        assertEquals(emptyList<ChatItem>(), model().items)
    }

    @Test fun aMessageIsAskedWithWhatIsKnownAndTheAnswerShowsWithInsertCopyAndShare() = runTest {
        facts.kept += Fact("a", "Your boss is Mr. Sharma.", 0)
        val m = model()
        m.say("  boss ko mail, kal chutti chahiye ")
        assertTrue(m.state.value.busy)
        assertEquals("", m.state.value.draft)
        advanceUntilIdle()
        assertEquals(
            AskInput(message = "boss ko mail, kal chutti chahiye", history = emptyList(), facts = listOf("Your boss is Mr. Sharma."), appName = "WhatsApp", userName = "Akshat", step = 1, canMessage = true, canOpen = true),
            asked.single(),
        )
        assertEquals(YouSaid(1, "boss ko mail, kal chutti chahiye"), m.items[0])
        assertEquals(BuddySaid(2, "", "Dear Sir,", emptyList(), listOf(ChatButton.INSERT, ChatButton.COPY, ChatButton.SHARE)), m.items[1])
        assertEquals(listOf(Mood.THINKING, Mood.HAPPY), moods)
        assertFalse(m.state.value.busy)
        assertEquals(emptyList<String>(), log) // nothing done in the app: it was not asked to
    }

    @Test fun withoutTheServiceTextCanOnlyBeCopiedOrShared() = runTest {
        typeIn.on = false
        val m = model()
        m.say("write a mail")
        advanceUntilIdle()
        assertEquals(listOf(ChatButton.COPY, ChatButton.SHARE), m.buddy().buttons)
    }

    @Test fun theChatSoFarGoesWithTheNextMessageTheBuddysLineAndTextTogether() = runTest {
        answers(written("Dear Sir, I need leave.", say = "Ye lo!"))
        val m = model()
        m.say("boss ko mail")
        advanceUntilIdle()
        m.say("make it shorter")
        advanceUntilIdle()
        assertEquals(listOf(ChatTurn("you", "boss ko mail"), ChatTurn("buddy", "Ye lo!\n\nDear Sir, I need leave.")), asked.last().history)
    }

    @Test fun anAnswerOnlyCopiesAndASendIsThePersonsToDo() = runTest {
        answers(written("It means tomorrow.", kind = "answer"), written("", kind = "send"))
        val m = model()
        m.say("kal ka matlab?")
        advanceUntilIdle()
        assertEquals(listOf(ChatButton.COPY), m.buddy().buttons)
        m.say("send it")
        advanceUntilIdle()
        assertEquals(BuddySaid(4, "I can't press Send on Android. Press Send yourself.", "", emptyList(), emptyList()), m.last())
    }

    @Test fun oneMessageAtATimeAndAnEmptyOneIsNotSent() = runTest {
        val gate = CompletableDeferred<Answer>()
        reply = { gate.await() }
        val m = model()
        m.say("one")
        runCurrent()
        m.say("two")
        runCurrent()
        assertEquals(1, asked.size)
        assertEquals("two", m.state.value.draft) // it waits in the box
        gate.complete(Answer("x", "m", chat = written("x")))
        advanceUntilIdle()
        m.say("   ")
        advanceUntilIdle()
        assertEquals(1, asked.size)
    }

    @Test fun aMessageOrASelectionTooLongIsSaidUnderTheBoxAndNothingIsAsked() = runTest {
        val m = model()
        m.say("a".repeat(1001))
        assertEquals("That message is too long (over 1000 characters). Try a shorter one.", m.state.value.boxError)
        assertEquals("a".repeat(1001), m.state.value.draft)
        m.setDraft("short")
        assertNull(m.state.value.boxError)
        m.open(selection = "s".repeat(8001))
        m.say("fix")
        assertEquals("Your selection is too long (over 8000 characters). Press ✕ to leave it out.", m.state.value.boxError)
        advanceUntilIdle()
        assertEquals(emptyList<AskInput>(), asked)
    }

    // ---- a selection (Fix with Buddy, Share → Buddy) ----

    @Test fun anEmptyBoxWithASelectionFixesItAndTheSelectionGoesWithThatMessageOnly() = runTest {
        answers(written("I am going.", kind = "fix"))
        val m = model()
        m.open(selection = "i am go", replaceable = true)
        assertEquals("i am go", m.state.value.selection)
        m.send()
        advanceUntilIdle()
        assertEquals("Fix this.", asked.single().message)
        assertEquals("i am go", asked.single().selection)
        assertEquals(listOf(ChatButton.REPLACE, ChatButton.COPY, ChatButton.SHARE), m.buddy().buttons)
        assertEquals("", m.state.value.selection)
        m.say("thanks")
        advanceUntilIdle()
        assertNull(asked.last().selection)
    }

    @Test fun theSelectionCanBeLeftOut() = runTest {
        val m = model()
        m.open(selection = "i am go")
        m.dropSelection()
        m.say("hi")
        advanceUntilIdle()
        assertNull(asked.single().selection)
    }

    @Test fun replaceHandsTheFixBackToTheAppThatAskedWhenItAllowsIt() = runTest {
        answers(written("I am going.", kind = "fix", doIt = true))
        val m = model()
        m.open(selection = "i am go", replaceable = true)
        m.send()
        advanceUntilIdle()
        assertEquals(listOf("replace I am going."), log)
        assertEquals(ChatEvent(3, "✅ Put it in WhatsApp"), m.last())
        assertEquals(listOf("Done! It's in WhatsApp ✅"), said)
        assertEquals(listOf(Mood.THINKING, Mood.HAPPY), moods)
    }

    @Test fun aFixOfASelectionThatCannotBeHandedBackGoesInThroughTheService() = runTest {
        answers(written("I am going.", kind = "fix", doIt = true))
        typeIn.box = BoxText("Hi, i am go now", 4, 11)
        val m = model()
        m.open(selection = "i am go", replaceable = false)
        m.send()
        advanceUntilIdle()
        assertEquals(listOf("Hi, I am going. now" to 15), typeIn.writes)
    }

    // ---- the box step ----

    @Test fun aBoxStepReadsTheBoxAndAsksAgainAndTheAnswerReplacesTheWholeBox() = runTest {
        answers(written("", kind = "box"), written("I am going.", kind = "fix"))
        typeIn.box = BoxText("i am go", 7, 7)
        val m = model()
        m.say("fix my English")
        advanceUntilIdle()
        assertEquals(listOf(1, 2), asked.map { it.step })
        assertEquals("i am go", asked[1].box)
        assertEquals(ChatEvent(2, "📖 Read your text"), m.items[1])
        assertEquals(listOf(ChatButton.REPLACE, ChatButton.COPY, ChatButton.SHARE), m.buddy().buttons)
        m.press(m.buddy().id, ChatButton.REPLACE)
        advanceUntilIdle()
        assertEquals(listOf("I am going." to 11), typeIn.writes)
    }

    @Test fun aBoxStepWithoutTheServiceSaysHowToTurnItOn() = runTest {
        answers(written("", kind = "box"))
        typeIn.on = false
        val m = model()
        m.say("fix my English")
        advanceUntilIdle()
        assertEquals(ChatError(2, "Turn on \"Buddy can type for you\" in Settings to let me read your box.", "no_type", listOf(ChatButton.SETTINGS)), m.last())
        assertEquals(listOf(Mood.THINKING, Mood.IDLE), moods)
        m.press(2, ChatButton.SETTINGS)
        assertEquals(listOf("settings no_type"), log)
    }

    @Test fun aBoxStepWithNoBoxOrAnEmptyOneStops() = runTest {
        answers(written("", kind = "box"), written("", kind = "box"))
        typeIn.box = null
        val m = model()
        m.say("fix my English")
        advanceUntilIdle()
        assertEquals(ChatError(2, "Tap in the box you are writing in, then open me again.", "no_box", emptyList()), m.last())
        typeIn.box = BoxText("  ", 0, 0)
        m.say("fix my English")
        advanceUntilIdle()
        assertEquals(ChatError(4, "That box looks empty.", "empty_box", emptyList()), m.last())
        assertEquals(2, asked.size)
    }

    @Test fun aSecondBoxOrScreenStepIsNotFound() = runTest {
        answers(written("", kind = "box"), written("", kind = "screen"))
        typeIn.box = BoxText("i am go", 7, 7)
        val m = model()
        m.say("fix my English")
        advanceUntilIdle()
        assertEquals(ChatError(3, "I couldn't find it. Select the text and ask me again.", "not_found", emptyList()), m.last())
    }

    // ---- the screen step ----

    @Test fun aScreenStepTakesOnePictureAndAsksAgainWithIt() = runTest {
        answers(written("", kind = "screen"), written("It says hello.", kind = "answer"))
        val m = model()
        m.open(selection = "namaste")
        m.say("what does this mean?")
        advanceUntilIdle()
        assertEquals(listOf("screen"), log)
        assertEquals(AskInput(message = "what does this mean?", selection = "namaste", history = emptyList(), facts = emptyList(), appName = "WhatsApp", userName = "Akshat", image = "IMG", step = 2, canMessage = true, canOpen = true), asked[1])
        assertEquals(ChatEvent(2, "👀 Looked at the screen"), m.items[1])
        assertEquals("It says hello.", m.buddy().text)
    }

    @Test fun aPictureRefusedOrThatFailsStops() = runTest {
        answers(written("", kind = "screen"), written("", kind = "screen"))
        picture = null
        val m = model()
        m.say("check my mail")
        advanceUntilIdle()
        assertEquals(ChatError(2, "I need a picture of your screen for that. Ask me again and allow it.", "no_picture", emptyList()), m.last())
        pictureError = BuddyError("buddy_off", "Turn Buddy on first.")
        m.say("check my mail")
        advanceUntilIdle()
        assertEquals(ChatError(4, "Turn Buddy on first.", "buddy_off", listOf(ChatButton.RETRY, ChatButton.SETTINGS)), m.last())
        assertEquals(2, asked.size)
    }

    // ---- doing it in the app ----

    @Test fun doItPutsTheTextInTheBoxWithTheServiceAndOffersUndo() = runTest {
        answers(written("Dear Sir,", doIt = true))
        typeIn.box = BoxText("Hello ", 6, 6)
        val m = model()
        m.say("reply to this")
        advanceUntilIdle()
        assertEquals(listOf("aside"), log)
        assertEquals(listOf("Hello Dear Sir," to 15), typeIn.writes)
        assertEquals(listOf(ChatButton.UNDO, ChatButton.COPY), m.buddy().buttons)
        assertEquals(ChatEvent(3, "✅ Put it in WhatsApp"), m.last())
        assertEquals(listOf("Done! It's in WhatsApp ✅"), said)
        assertEquals(listOf(Mood.THINKING, Mood.HAPPY), moods)
        m.press(m.buddy().id, ChatButton.UNDO)
        advanceUntilIdle()
        assertEquals("Hello " to 6, typeIn.writes.last())
        assertEquals(listOf(ChatButton.COPY), m.buddy().buttons)
        assertEquals("Undone", said.last())
    }

    @Test fun doItWithoutTheServiceCopiesAndSaysHowToPaste() = runTest {
        answers(written("Dear Sir,", doIt = true))
        typeIn.on = false
        val m = model()
        m.say("reply to this")
        advanceUntilIdle()
        assertEquals(listOf("copy Dear Sir,", "aside"), log)
        assertEquals(ChatEvent(3, "Copied — long-press the box and tap Paste"), m.last())
        assertEquals(listOf("Copied — long-press the box and tap Paste"), said)
        assertEquals(emptyList<Pair<String, Int>>(), typeIn.writes)
    }

    @Test fun aBoxThatCannotBeSetOrIsGoneGetsTheTextCopied() = runTest {
        answers(written("Dear Sir,", doIt = true), written("Hi", doIt = true))
        typeIn.writable = false
        val m = model()
        m.say("reply")
        advanceUntilIdle()
        assertEquals(ChatEvent(3, "Copied — long-press the box and tap Paste"), m.last())
        typeIn.box = null
        m.say("reply again")
        advanceUntilIdle()
        assertEquals(ChatEvent(6, "Copied — long-press the box and tap Paste"), m.last())
        assertEquals(listOf(ChatButton.INSERT, ChatButton.COPY, ChatButton.SHARE), m.buddy().buttons)
    }

    @Test fun aNewVersionTakesTheLastOnesPlaceWhileItCanStillBeUndone() = runTest {
        answers(written("I need a long leave tomorrow.", doIt = true), written("Leave tomorrow?", doIt = true, again = true))
        typeIn.box = BoxText("Dear Sir, ", 10, 10)
        val m = model()
        m.say("boss ko mail")
        advanceUntilIdle()
        m.say("make it shorter")
        advanceUntilIdle()
        assertEquals("Dear Sir, Leave tomorrow?" to 25, typeIn.writes.last())
        val (first, second) = m.items.filterIsInstance<BuddySaid>()
        assertEquals(listOf(ChatButton.COPY), first.buttons)
        assertEquals(listOf(ChatButton.UNDO, ChatButton.COPY), second.buttons)
        m.press(second.id, ChatButton.UNDO)
        advanceUntilIdle()
        assertEquals("Dear Sir, " to 10, typeIn.writes.last()) // back to before either
    }

    @Test fun undoLeavesABoxThatChangedSinceAlone() = runTest {
        typeIn.box = BoxText("Hi ", 3, 3)
        answers(written("see you at 5", doIt = true))
        val m = model()
        m.say("reply to her")
        advanceUntilIdle()
        val put = m.buddy()
        assertEquals("Hi see you at 5", typeIn.box!!.text)
        typeIn.box = BoxText("Bob, the report is late", 23, 23) // the person wrote something else meanwhile
        m.hidden()
        clock += 60_000
        m.open()
        m.press(put.id, ChatButton.UNDO)
        advanceUntilIdle()
        assertEquals("Bob, the report is late", typeIn.box!!.text)
        assertEquals(1, typeIn.writes.size) // only the put
        assertEquals(ChatError(4, "That box has changed since, so I left it.", "box_changed", emptyList()), m.last())
        assertEquals(listOf(ChatButton.COPY), m.buddy().buttons)
    }

    @Test fun undoOfABoxThatIsGoneSaysSoAndKeepsUndo() = runTest {
        answers(written("Dear Sir,", doIt = true))
        val m = model()
        m.say("reply")
        advanceUntilIdle()
        typeIn.box = null
        m.press(m.buddy().id, ChatButton.UNDO)
        advanceUntilIdle()
        assertEquals("I couldn't undo it: that box is gone.", m.errorLine().text)
        assertEquals(listOf(ChatButton.UNDO, ChatButton.COPY), m.buddy().buttons)
    }

    @Test fun aNewVersionGoesInFreshWhenTheBoxChangedSince() = runTest {
        answers(written("I need leave tomorrow.", doIt = true), written("Leave tomorrow?", doIt = true, again = true))
        val m = model()
        m.say("boss ko mail")
        advanceUntilIdle()
        assertEquals("I need leave tomorrow.", typeIn.box!!.text)
        typeIn.box = BoxText("Hi Bob", 6, 6) // the person sent it and started another message
        m.say("make it shorter")
        advanceUntilIdle()
        assertEquals("Hi BobLeave tomorrow?" to 21, typeIn.writes.last())
        val (first, second) = m.items.filterIsInstance<BuddySaid>()
        assertEquals(listOf(ChatButton.UNDO, ChatButton.COPY), second.buttons)
        m.press(second.id, ChatButton.UNDO)
        advanceUntilIdle()
        assertEquals("Hi Bob" to 6, typeIn.writes.last())
        assertTrue(ChatButton.UNDO in first.buttons) // its own Undo still checks the box first
    }

    @Test fun somethingUnexpectedWhilePuttingTextInTheAppIsARedLineNotACrash() = runTest {
        val m = model()
        m.say("write")
        advanceUntilIdle()
        typeIn.failRead = IllegalStateException("node recycled")
        m.press(m.buddy().id, ChatButton.INSERT)
        advanceUntilIdle()
        assertEquals(ChatError(3, "Something went wrong. Try again.", "failed", emptyList()), m.last())
        typeIn.failRead = null
        m.press(m.buddy().id, ChatButton.INSERT) // not stuck: the next press works
        advanceUntilIdle()
        assertEquals("Dear Sir," to 9, typeIn.writes.last())
    }

    @Test fun anAnswerThatComesWhileThePanelIsHiddenWaitsInTheChat() = runTest {
        answers(written("Dear Sir,", doIt = true))
        val gate = CompletableDeferred<Unit>()
        val inner = reply
        reply = { gate.await(); inner(it) }
        val m = model()
        m.say("reply to this")
        runCurrent()
        m.hidden()
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(emptyList<Pair<String, Int>>(), typeIn.writes)
        assertEquals(listOf("Your answer is ready. Open me to see it."), said)
        assertEquals(listOf(ChatButton.INSERT, ChatButton.COPY, ChatButton.SHARE), m.buddy().buttons)
    }

    @Test fun copyAndShareAreThePersons() = runTest {
        val m = model()
        m.say("write")
        advanceUntilIdle()
        m.press(m.buddy().id, ChatButton.COPY)
        advanceUntilIdle() // the panel steps aside, so the person can paste
        m.press(m.buddy().id, ChatButton.SHARE)
        assertEquals(listOf("copy Dear Sir,", "aside", "share Dear Sir,"), log)
        assertEquals(listOf("Copied — long-press the box and tap Paste"), said)
    }

    // ---- remembering ----

    @Test fun factsTheAiPickedUpAreRememberedWithUndo() = runTest {
        answers(written("Hi", remember = listOf("Your boss is Mr. Sharma.")))
        val m = model()
        m.say("my boss is Mr. Sharma")
        advanceUntilIdle()
        val line = m.items[1]
        assertEquals(ChatEvent(2, "📝 Remembered: Your boss is Mr. Sharma.", listOf(ChatButton.UNDO)), line)
        m.press(2, ChatButton.UNDO)
        assertEquals(ChatEvent(2, "Okay, I forgot that."), m.items[1])
        assertEquals(emptyList<Fact>(), facts.kept)
    }

    @Test fun aFactTheMemoryRefusesShowsNothing() = runTest {
        facts.refuse = true
        answers(written("Hi", remember = listOf("Your PIN is 1234.")))
        val m = model()
        m.say("my pin is 1234")
        advanceUntilIdle()
        assertEquals(2, m.items.size)
    }

    // ---- errors ----

    @Test fun noInternetIsARedLineWithTryAgainAndTheHeadIsSleepy() = runTest {
        reply = { throw BuddyError("network", "Couldn't reach Buddy's server. Check your internet.") }
        val m = model()
        m.say("hi")
        advanceUntilIdle()
        assertEquals(ChatError(2, "Couldn't reach Buddy's server. Check your internet.", "network", listOf(ChatButton.RETRY)), m.last())
        assertEquals(listOf(Mood.THINKING, Mood.SLEEPY), moods)
        reply = { Answer("x", "m", chat = written("Hello!", kind = "answer")) }
        m.press(2, ChatButton.RETRY)
        advanceUntilIdle()
        assertEquals(listOf("hi", "hi"), asked.map { it.message })
        assertEquals(listOf(YouSaid(1, "hi"), BuddySaid(3, "", "Hello!", emptyList(), listOf(ChatButton.COPY))), m.items)
    }

    @Test fun anErrorWhoseFixIsInSettingsOffersItAndABadRequestNoTryAgain() = runTest {
        reply = { throw BuddyError("no_key", "Add your API key in Settings first.") }
        val m = model()
        m.say("hi")
        advanceUntilIdle()
        assertEquals(listOf(ChatButton.RETRY, ChatButton.SETTINGS), m.errorLine().buttons)
        assertEquals(listOf(Mood.THINKING, Mood.IDLE), moods)
        m.press(m.errorLine().id, ChatButton.SETTINGS)
        assertEquals(listOf("settings no_key"), log)
        reply = { throw BuddyError("bad_request", "That is too long.") }
        m.say("hi")
        advanceUntilIdle()
        assertEquals(emptyList<ChatButton>(), m.errorLine().buttons)
    }

    @Test fun anAnswerThatTakesAMinuteIsTooLong() = runTest {
        reply = { awaitCancellation() }
        val m = model()
        m.say("x")
        advanceTimeBy(59_999)
        assertTrue(m.state.value.busy)
        advanceTimeBy(2)
        runCurrent()
        assertEquals("Buddy took too long to answer. Try again.", m.errorLine().text)
        assertEquals(listOf(Mood.THINKING, Mood.SLEEPY), moods)
        assertFalse(m.state.value.busy)
    }

    @Test fun somethingUnexpectedSaysTryAgainInPlainWords() = runTest {
        reply = { throw IllegalStateException("/data/user/0/secret/path") }
        val m = model()
        m.say("x")
        advanceUntilIdle()
        assertEquals(ChatError(2, "Something went wrong. Try again.", "failed", listOf(ChatButton.RETRY)), m.last())
    }

    @Test fun closingThePanelWhileAskingSendsTheHeadBackToIdle() = runTest {
        reply = { awaitCancellation() }
        val panel = CoroutineScope(StandardTestDispatcher(testScheduler) + Job())
        val m = model(panel)
        m.say("x")
        runCurrent()
        panel.cancel()
        runCurrent()
        assertEquals(listOf(Mood.THINKING, Mood.IDLE), moods)
    }

    @Test fun closingThePanelLetsGoOfTheAnswerButNotOfTextGoingIntoTheApp() = runTest {
        reply = { awaitCancellation() }
        val m = model()
        m.say("x")
        runCurrent()
        m.close()
        advanceUntilIdle()
        assertEquals(listOf(Mood.THINKING, Mood.IDLE), moods)
        assertFalse(m.state.value.busy)

        // The Fix with Buddy sheet closes as it steps aside: what it was putting in the app still goes in.
        events.clear()
        reply = { Answer("x", "m", chat = written("Dear Sir,", doIt = true)) }
        val gate = CompletableDeferred<Unit>()
        val m2 = PanelModel({ _, i -> asked += i; reply(i) }, this, { events += it }, typeIn, facts, PanelHands(stepAside = { gate.await() }), messaging)
        m2.open()
        m2.say("reply")
        runCurrent()
        m2.close()
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf("Dear Sir," to 9), typeIn.writes)
    }

    // ---- the chat comes back ----

    @Test fun aPanelOnlyHiddenOpensOnTheSameChatWithinFiveMinutesFromTheSameApp() = runTest {
        val m = model()
        m.say("hi")
        advanceUntilIdle()
        m.hidden()
        clock += 4 * 60_000
        m.open()
        assertEquals(2, m.items.size)
        m.hidden()
        clock += 5 * 60_000
        m.open()
        assertEquals(emptyList<ChatItem>(), m.items)
        m.say("hi")
        advanceUntilIdle()
        m.hidden()
        typeIn.app = "Gmail"
        m.open()
        assertEquals(emptyList<ChatItem>(), m.items)
        assertEquals("Gmail", m.state.value.appName)
    }

    @Test fun aNewChatDropsTheAnswerStillOnItsWay() = runTest {
        val gate = CompletableDeferred<Answer>()
        reply = { gate.await() }
        val m = model()
        m.say("hi")
        runCurrent()
        m.hidden()
        clock += 6 * 60_000
        m.open()
        gate.complete(Answer("x", "m", chat = written("late")))
        advanceUntilIdle()
        assertEquals(emptyList<ChatItem>(), m.items)
        assertFalse(m.state.value.busy)
        assertEquals(listOf(Mood.THINKING, Mood.IDLE), moods)
    }

    // ---- voice ----

    @Test fun spokenWordsGoInTheBoxAndAreNotSent() = runTest {
        val m = model()
        m.voiceWords("  boss ko mail ")
        assertEquals("boss ko mail", m.state.value.draft)
        m.setDraft("Hi,")
        m.voiceWords("kal chutti chahiye")
        assertEquals("Hi, kal chutti chahiye", m.state.value.draft)
        m.voiceWords("   ")
        assertEquals("Hi, kal chutti chahiye", m.state.value.draft)
        advanceUntilIdle()
        assertEquals(emptyList<AskInput>(), asked)
    }

    @Test fun voiceErrorsAreRedLinesAndTheMicrophoneOnesOpenSettings() = runTest {
        val m = model()
        m.voiceError(BuddyError("no_microphone", "Buddy needs the microphone to hear you. Allow it in Settings."))
        assertEquals(ChatError(1, "Buddy needs the microphone to hear you. Allow it in Settings.", "no_microphone", listOf(ChatButton.SETTINGS)), m.last())
        m.press(1, ChatButton.SETTINGS)
        assertEquals(listOf("settings no_microphone"), log)
        m.voiceError(BuddyError("voice_off", "Something the server said"))
        assertEquals(ChatError(2, "Voice isn't set up yet.", "voice_off", emptyList()), m.last())
        for ((i, code) in listOf("no_words", "mic_failed", "voice_busy", "upstream", "bad_request", "network").withIndex()) {
            m.voiceError(BuddyError(code, "words for $code"))
            assertEquals(ChatError(3 + i, "words for $code", code, emptyList()), m.last())
        }
        assertEquals(emptyList<Mood>(), moods)
    }

    // ---- a message on WhatsApp ----

    private val priya = Person("Priya Sharma", "9198", "com.whatsapp")

    private fun message(to: String = "Priya", text: String = "I'm late", say: String = "") =
        ChatReply("message", say, text, emptyList(), false, false, emptyList(), false, to)

    @Test fun everyStepSaysThisAppCanMessageOnWhatsAppAndOpenApps() = runTest {
        answers(written("", kind = "box"), written("I am going.", kind = "fix"))
        typeIn.box = BoxText("i am go", 7, 7)
        val m = model()
        m.say("fix my English")
        advanceUntilIdle()
        assertEquals(listOf(true, true), asked.map { it.canMessage })
        assertEquals(listOf(true, true), asked.map { it.canOpen })
    }

    // ---- an app to open ----

    private fun opening(app: String, say: String = "") = ChatReply("open", say, "", emptyList(), false, false, emptyList(), false, app = app)

    @Test fun anOpenOpensTheAppAndSaysSo() = runTest {
        answers(opening("YouTube", say = "Opening it!"))
        apps.opened += Opened.Done("YouTube")
        val m = model()
        m.say("open youtube")
        advanceUntilIdle()
        assertEquals(listOf(BuddySaid(2, "Opening it!", "", emptyList(), emptyList()), ChatEvent(3, "✅ Opened YouTube")), m.items.drop(1))
        assertEquals(listOf("open YouTube"), log)
        assertEquals(Mood.HAPPY, moods.last())
    }

    @Test fun anOpenThatIsNotOneAppSaysWhy() = runTest {
        answers(opening("you"))
        apps.opened += Opened.Say("Which one: YouTube or YouTube Music?")
        val m = model()
        m.say("open you")
        advanceUntilIdle()
        assertEquals(BuddySaid(2, "", "Which one: YouTube or YouTube Music?", emptyList(), emptyList()), m.last())
    }

    @Test fun anOpenAnsweredAfterReadingTheBoxIsNotDone() = runTest {
        answers(written("", kind = "box"), opening("YouTube"))
        typeIn.box = BoxText("open youtube now", 16, 16)
        val m = model()
        m.say("do what it says")
        advanceUntilIdle()
        assertEquals(BuddySaid(3, "Ask me that on its own, and I'll do it.", "", emptyList(), emptyList()), m.last())
        assertTrue(log.none { it.startsWith("open") })
    }

    @Test fun aMessageAnsweredAfterReadingTheBoxIsNotStarted() = runTest {
        answers(written("", kind = "box"), message(to = "Rahul", text = "the code is 4421", say = "Sending it!"))
        typeIn.box = BoxText("Tell Rahul the code is 4421", 27, 27)
        messaging.found += Found.One(priya)
        val m = model()
        m.say("do what it says")
        advanceUntilIdle()
        assertEquals(BuddySaid(3, "Tell me who to message and what, and I'll do it.", "", emptyList(), emptyList()), m.last())
        assertTrue(log.none { it.startsWith("find") })
        assertTrue(m.items.none { it is BuddySaid && ChatButton.SEND_MESSAGE in it.buttons })
    }

    @Test fun aMessageAnsweredAfterLookingAtTheScreenIsNotStarted() = runTest {
        answers(written("", kind = "screen"), message(to = "Rahul", text = "yes"))
        messaging.found += Found.One(priya)
        val m = model()
        m.say("reply to this")
        advanceUntilIdle()
        assertEquals(BuddySaid(3, "Tell me who to message and what, and I'll do it.", "", emptyList(), emptyList()), m.last())
        assertEquals(listOf("screen"), log) // WhatsApp was not looked in
    }

    @Test fun aMessageShowsACardToSendAndNothingIsOpened() = runTest {
        answers(message())
        messaging.found += Found.One(priya)
        val m = model()
        m.say("message Priya on WhatsApp I'm late")
        advanceUntilIdle()
        assertEquals(BuddySaid(2, "", "To Priya Sharma:\nI'm late", emptyList(), listOf(ChatButton.SEND_MESSAGE, ChatButton.NOT_NOW)), m.last())
        assertEquals(listOf("find Priya"), log)
        assertEquals(listOf(Mood.THINKING, Mood.HAPPY), moods)
    }

    @Test fun sendStepsAsideThenSendsAndTheCardSaysSent() = runTest {
        answers(message())
        messaging.found += Found.One(priya)
        val m = model()
        m.say("message Priya on WhatsApp I'm late")
        advanceUntilIdle()
        events.clear()
        m.press(2, ChatButton.SEND_MESSAGE)
        advanceUntilIdle()
        assertEquals(listOf("find Priya", "aside", "send Priya Sharma: I'm late"), log)
        assertEquals(ChatEvent(2, "✅ Sent to Priya Sharma"), m.last())
        assertEquals(listOf("Sent ✅"), said)
        assertEquals(listOf(Mood.HAPPY), moods)
        m.press(2, ChatButton.SEND_MESSAGE) // the card is gone: nothing is sent twice
        advanceUntilIdle()
        assertEquals(1, log.count { it.startsWith("send") })
    }

    @Test fun notNowSendsNothing() = runTest {
        answers(message())
        messaging.found += Found.One(priya)
        val m = model()
        m.say("message Priya on WhatsApp I'm late")
        advanceUntilIdle()
        m.press(2, ChatButton.NOT_NOW)
        advanceUntilIdle()
        assertEquals(ChatEvent(2, "Okay, not sent."), m.last())
        m.press(2, ChatButton.SEND_MESSAGE)
        advanceUntilIdle()
        assertEquals(listOf("find Priya"), log)
    }

    @Test fun whoItIsNotIsSaidAndContactsRefusedOpenSettings() = runTest {
        answers(message(), message())
        messaging.found += Found.Say("Which Priya: Priya Sharma or Priya Verma? Tell me the full name.")
        messaging.found += Found.Say("I need your contacts to find Priya. You can allow it in Settings.", "no_contacts")
        val m = model()
        m.say("message Priya I'm late")
        advanceUntilIdle()
        assertEquals(BuddySaid(2, "", "Which Priya: Priya Sharma or Priya Verma? Tell me the full name.", emptyList(), emptyList()), m.last())
        m.say("message Priya I'm late")
        advanceUntilIdle()
        assertEquals(ChatError(4, "I need your contacts to find Priya. You can allow it in Settings.", "no_contacts", listOf(ChatButton.SETTINGS)), m.last())
        assertEquals(listOf(Mood.THINKING, Mood.HAPPY, Mood.THINKING, Mood.IDLE), moods)
        m.press(4, ChatButton.SETTINGS)
        assertEquals("settings no_contacts", log.last())
    }

    @Test fun aSendThatFailsSaysWhyAndTheCardStays() = runTest {
        answers(message())
        messaging.found += Found.One(priya)
        messaging.sent += Sent.Failed("That opened the wrong chat, so I didn't send it.")
        messaging.sent += Sent.Failed("WhatsApp didn't put the message in, so I didn't send it.")
        val m = model()
        m.say("message Priya I'm late")
        advanceUntilIdle()
        val card = m.last()
        m.press(2, ChatButton.SEND_MESSAGE)
        advanceUntilIdle()
        assertEquals(ChatError(3, "That opened the wrong chat, so I didn't send it.", "message_failed", emptyList()), m.last())
        assertEquals("That opened the wrong chat, so I didn't send it.", said.last())
        assertEquals(card, m.items.first { it.id == 2 })
        m.press(2, ChatButton.SEND_MESSAGE) // pressed again: tried again
        advanceUntilIdle()
        assertEquals(ChatError(4, "WhatsApp didn't put the message in, so I didn't send it.", "message_failed", emptyList()), m.last())
        assertEquals(card, m.items.first { it.id == 2 })
        assertEquals(2, log.count { it.startsWith("send") })
    }

    @Test fun textLeftInWhatsAppForThemToSendEndsTheCard() = runTest {
        answers(message(), message())
        messaging.found += Found.One(priya)
        messaging.found += Found.One(priya)
        messaging.sent += Sent.Failed("It's ready in WhatsApp. Turn on Buddy in Accessibility so I can press Send for you.", "no_accessibility", inWhatsApp = true)
        messaging.sent += Sent.Failed("I couldn't press Send. It's ready in WhatsApp: press Send yourself.", inWhatsApp = true)
        val m = model()
        m.say("message Priya I'm late")
        advanceUntilIdle()
        m.press(2, ChatButton.SEND_MESSAGE)
        advanceUntilIdle()
        assertEquals(ChatEvent(2, "It's in WhatsApp, ready for you to send."), m.items.first { it.id == 2 })
        assertEquals(ChatError(3, "It's ready in WhatsApp. Turn on Buddy in Accessibility so I can press Send for you.", "no_accessibility", listOf(ChatButton.SETTINGS)), m.last())
        assertEquals("It's ready in WhatsApp. Turn on Buddy in Accessibility so I can press Send for you.", said.last())
        m.press(2, ChatButton.SEND_MESSAGE) // no second send: the text is waiting in WhatsApp
        advanceUntilIdle()
        assertEquals(1, log.count { it.startsWith("send") })

        m.say("message Priya I'm late")
        advanceUntilIdle()
        val card = m.last().id
        m.press(card, ChatButton.SEND_MESSAGE)
        advanceUntilIdle()
        assertEquals(ChatEvent(card, "It's in WhatsApp, ready for you to send."), m.items.first { it.id == card })
        assertEquals(ChatError(card + 1, "I couldn't press Send. It's ready in WhatsApp: press Send yourself.", "message_failed", emptyList()), m.last())
        assertEquals("I couldn't press Send. It's ready in WhatsApp: press Send yourself.", said.last())
        m.press(card, ChatButton.SEND_MESSAGE)
        advanceUntilIdle()
        assertEquals(2, log.count { it.startsWith("send") })
    }

    @Test fun aSendBuddyIsNotSureOfSaysSoAndOffersNoSecondSend() = runTest {
        answers(message())
        messaging.found += Found.One(priya)
        messaging.sent += Sent.Unsure
        val m = model()
        m.say("message Priya I'm late")
        advanceUntilIdle()
        m.press(2, ChatButton.SEND_MESSAGE)
        advanceUntilIdle()
        assertEquals(ChatEvent(2, "I'm not sure it went. Check WhatsApp."), m.items.first { it.id == 2 })
        assertFalse(m.items.any { it is ChatError })
        assertEquals("I'm not sure it went. Check WhatsApp.", said.last())
        m.press(2, ChatButton.SEND_MESSAGE)
        advanceUntilIdle()
        assertEquals(1, log.count { it.startsWith("send") })
    }

    @Test fun notNowWhileItIsBeingSentLeavesTheCard() = runTest {
        answers(message())
        messaging.found += Found.One(priya)
        val m = model()
        m.say("message Priya I'm late")
        advanceUntilIdle()
        val card = m.last()
        val sending = CompletableDeferred<Unit>().also { messaging.sending = it }
        m.press(2, ChatButton.SEND_MESSAGE)
        runCurrent()
        assertEquals("send Priya Sharma: I'm late", log.last())
        m.press(2, ChatButton.NOT_NOW)
        runCurrent()
        assertEquals(card, m.items.first { it.id == 2 })
        sending.complete(Unit)
        advanceUntilIdle()
        assertEquals(ChatEvent(2, "✅ Sent to Priya Sharma"), m.items.first { it.id == 2 })
        assertFalse(m.items.any { it is ChatEvent && it.text == "Okay, not sent." })
    }

    @Test fun aCodeNotFixedInSettingsGetsNoButton() = runTest {
        answers(message())
        messaging.found += Found.Say("Something about Priya.", "not_in_settings")
        val m = model()
        m.say("message Priya I'm late")
        advanceUntilIdle()
        assertEquals(ChatError(2, "Something about Priya.", "not_in_settings", emptyList()), m.last())
    }

    @Test fun whatBuddySaysComesBeforeTheCard() = runTest {
        answers(message(say = "Okay!"))
        messaging.found += Found.One(priya)
        val m = model()
        m.say("message Priya I'm late")
        advanceUntilIdle()
        assertEquals(BuddySaid(2, "Okay!", "", emptyList(), emptyList()), m.items[1])
        assertEquals(BuddySaid(3, "", "To Priya Sharma:\nI'm late", emptyList(), listOf(ChatButton.SEND_MESSAGE, ChatButton.NOT_NOW)), m.items[2])
    }
}
