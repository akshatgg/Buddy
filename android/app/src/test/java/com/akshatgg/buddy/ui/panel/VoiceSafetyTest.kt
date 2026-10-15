package com.akshatgg.buddy.ui.panel

import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.AskInput
import com.akshatgg.buddy.ai.ChatReply
import com.akshatgg.buddy.bubble.BubbleEvent
import com.akshatgg.buddy.calls.CallFound
import com.akshatgg.buddy.calls.Callee
import com.akshatgg.buddy.message.Found
import com.akshatgg.buddy.message.Person
import com.akshatgg.buddy.typing.BoxText
import com.akshatgg.buddy.voice.Heard
import com.akshatgg.buddy.voice.VoiceWords
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The hard rules of the spoken yes, pinned in one place: Buddy never sends a message or places a call without a yes,
 * and a spoken yes counts once, for the card asked, and only after the question. Over the fakes of PanelModelTest.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class VoiceSafetyTest {
    private val asked = mutableListOf<AskInput>()
    private val events = mutableListOf<BubbleEvent>()
    private val replies = ArrayDeque<ChatReply>()
    private val log = mutableListOf<String>()
    private val messaging = FakeMessaging(log)
    private val phone = FakePhone(log)
    private val talk = FakeTalkBack(log)
    private val lock = FakeLock()
    private val typeIn = FakeTypeIn()
    private val priya = Person("Priya Sharma", "9198", "com.whatsapp")
    private val prince = Callee("Prince Sharma", "100")

    private fun written(text: String, kind: String = "write") = ChatReply(kind, "", text, emptyList(), false, false, emptyList(), false)
    private fun message(to: String = "Priya", text: String = "hi") = ChatReply("message", "", text, emptyList(), false, false, emptyList(), false, to)
    private fun calling() = ChatReply("call", "", "", emptyList(), false, false, emptyList(), false, to = "Prince", how = "phone")

    private fun model(scope: CoroutineScope) = PanelModel(
        ask = { action, input -> assertEquals(Action.CHAT, action); asked += input; Answer("raw", "m", chat = replies.removeFirstOrNull() ?: written("ok")) },
        scope = scope,
        bubble = { events += it },
        typeIn = typeIn,
        facts = FakeFacts(),
        hands = PanelHands(
            stepAside = { log += "aside" },
            copy = { log += "copy $it" },
            share = { log += "share $it" },
            screen = { log += "screen"; "IMG" },
            replace = { log += "replace $it" },
            openSettings = { log += "settings $it" },
        ),
        messaging = messaging,
        apps = FakeApps(log),
        phone = phone,
        whatsAppCalls = FakeWhatsAppCalls(log),
        callInfo = FakeCallInfo(log),
        notifs = FakeNotifs(log),
        talkBack = talk,
        lock = lock,
        firstName = { "Akshat" },
        now = { 1_000_000L },
    ).apply { open() }

    private fun PanelModel.sent() = log.count { it.startsWith("send ") }
    private fun PanelModel.called() = log.count { it.startsWith("call ") || it.startsWith("wa call ") }
    private fun PanelModel.item(id: Int) = state.value.items.first { it.id == id }
    private fun ChatItem.buttonList() = when (this) {
        is BuddySaid -> buttons
        is ChatEvent -> buttons
        is ChatError -> buttons
        else -> emptyList()
    }

    private fun TestScope.askedCard(text: String = "hi"): PanelModel {
        replies += message(text = text)
        messaging.found += Found.One(priya)
        val m = model(this)
        m.sendSpoken("message Priya $text")
        advanceUntilIdle()
        return m
    }

    // 1
    @Test fun aYesHeardForCardAAfterCardBWasShownDoesNothingToA() = runTest {
        talk.stopCompletes = false
        val a = CompletableDeferred<Heard>()
        talk.hearing = a
        val m = askedCard("first") // card A (id 2) is asked
        talk.hearing = null
        replies += message(text = "second")
        messaging.found += Found.One(priya)
        m.sendSpoken("message Priya second") // card B is shown and asked: A's ear is stale
        advanceUntilIdle()
        assertEquals(2, log.count { it.startsWith("hear ") })
        a.complete(Heard.YES)
        advanceUntilIdle()
        assertTrue("send Priya Sharma: first" !in log)
        assertEquals(listOf(ChatButton.SEND_MESSAGE, ChatButton.NOT_NOW), m.item(2).buttonList())
    }

    // 2
    @Test fun aYesAfterTheCardWasPressedOrAfterNotNowSendsOrCallsNothingMore() = runTest {
        talk.stopCompletes = false
        val gate = CompletableDeferred<Heard>()
        talk.hearing = gate
        val m = askedCard()
        m.press(2, ChatButton.NOT_NOW)
        advanceUntilIdle()
        gate.complete(Heard.YES)
        advanceUntilIdle()
        assertEquals(0, m.sent())
        assertEquals(0, m.called())
        m.press(2, ChatButton.SEND_MESSAGE) // the card shows no button any more
        advanceUntilIdle()
        assertEquals(0, m.sent())
    }

    @Test fun aYesAfterTheSendButtonSendsOnlyOnce() = runTest {
        talk.stopCompletes = false
        val gate = CompletableDeferred<Heard>()
        talk.hearing = gate
        val m = askedCard()
        m.press(2, ChatButton.SEND_MESSAGE)
        advanceUntilIdle()
        gate.complete(Heard.YES)
        advanceUntilIdle()
        m.press(2, ChatButton.SEND_MESSAGE)
        advanceUntilIdle()
        assertEquals(1, m.sent())
    }

    @Test fun aYesAfterNotNowOnACallCardCallsNobody() = runTest {
        talk.stopCompletes = false
        val gate = CompletableDeferred<Heard>()
        talk.hearing = gate
        replies += calling()
        phone.found += CallFound.One(prince)
        val m = model(this)
        m.sendSpoken("call Prince")
        advanceUntilIdle()
        m.press(2, ChatButton.NOT_NOW)
        advanceUntilIdle()
        gate.complete(Heard.YES)
        advanceUntilIdle()
        assertEquals(0, m.called())
    }

    // 3
    @Test fun hearIsNeverCalledBeforeSayOfTheQuestionHasReturned() = runTest {
        talk.gateText = "To Priya Sharma: hi. Send it?"
        talk.sayGate = CompletableDeferred()
        talk.answers += Heard.YES
        val m = askedCard()
        assertTrue("say To Priya Sharma: hi. Send it?" in log)
        assertTrue(log.none { it.startsWith("hear ") })
        talk.sayGate!!.complete(Unit)
        advanceUntilIdle()
        assertTrue(log.indexOf("hear send") > log.indexOf("say To Priya Sharma: hi. Send it?"))
        assertEquals(1, m.sent())
    }

    // 4
    @Test fun aTypedChatAfterASpokenOneDoesNotSpeak() = runTest {
        val m = model(this)
        m.sendSpoken("hello")
        advanceUntilIdle()
        val said = log.count { it.startsWith("say ") }
        assertTrue(said > 0)
        m.setDraft("and typed")
        m.send()
        advanceUntilIdle()
        assertEquals(said, log.count { it.startsWith("say ") })
        assertTrue(log.none { it.startsWith("hear ") })
    }

    // 5
    @Test fun aSecondStepsMessageIsSpokenAsALineAndNeverAskedAsACard() = runTest {
        replies += written("", kind = "box")
        replies += message(to = "Rahul", text = "the code")
        messaging.found += Found.One(priya)
        typeIn.box = BoxText("Tell Rahul the code", 19, 19)
        talk.answers += Heard.YES
        val m = model(this)
        m.sendSpoken("do what it says")
        advanceUntilIdle()
        val line = "Tell me who to message and what, and I'll do it."
        assertTrue("say $line" in log)
        assertEquals(line, (m.state.value.items.last() as BuddySaid).say)
        assertTrue(log.none { it.startsWith("hear ") || it.startsWith("find ") })
        assertEquals(0, m.sent())
    }

    // 6 and 7
    private val cases = Json.parseToJsonElement(File("src/test/resources/voice-cases.json").readText()).jsonObject
        .getValue("heard").jsonArray.map { it.jsonObject }

    @Test fun everyHeardCaseWhoseWordsIncludeANoWordIsNo() {
        val withNo = cases.filter { it["words"].let { w -> w != null && w !is JsonNull && w.jsonPrimitive.content == "no" } }
        assertTrue(withNo.size >= 10)
        for (c in withNo) assertEquals(c.getValue("text").jsonPrimitive.content, Heard.NO, VoiceWords.heard(c.getValue("text").jsonPrimitive.content, c.getValue("verb").jsonPrimitive.content))
    }

    @Test fun unkAnywhereInAHeardAnswerIsNeverYes() {
        val unk = cases.filter { it.getValue("text").jsonPrimitive.content.contains("unk", ignoreCase = true) }
        assertTrue(unk.size >= 5)
        for (c in unk) {
            val text = c.getValue("text").jsonPrimitive.content
            assertEquals(text, Heard.NO, VoiceWords.heard(text, c.getValue("verb").jsonPrimitive.content))
        }
        for (said in listOf("yes [unk]", "[unk] yes", "yes [unk] send", "haan <unk>")) assertEquals(said, Heard.NO, VoiceWords.heard(said, "send"))
    }

    // 8
    private fun TestScope.waitingAtTheUnlock(call: Boolean): PanelModel {
        talk.answers += Heard.YES
        lock.isLocked = true
        lock.gate = CompletableDeferred()
        val m: PanelModel
        if (call) {
            replies += calling()
            phone.found += CallFound.One(prince)
            m = model(this)
            m.sendSpoken("call Prince")
        } else {
            replies += message()
            messaging.found += Found.One(priya)
            m = model(this)
            m.sendSpoken("message Priya hi")
        }
        advanceUntilIdle()
        assertTrue(log.any { it.startsWith("say Unlock your phone") })
        return m
    }

    @Test fun theUnlockWaitIsCancelledByNotNowANewMessageAndClose() = runTest {
        for (call in listOf(false, true)) {
            for (how in listOf("not-now", "message", "close")) {
                log.clear()
                replies.clear()
                val m = waitingAtTheUnlock(call)
                when (how) {
                    "not-now" -> m.press(2, ChatButton.NOT_NOW)
                    "message" -> { replies += written("ok"); m.sendSpoken("hello") }
                    else -> m.close()
                }
                advanceUntilIdle()
                lock.gate!!.complete(true)
                advanceUntilIdle()
                assertEquals("$how call=$call", 0, m.sent())
                assertEquals("$how call=$call", 0, m.called())
            }
        }
    }

    @Test fun notNowOnAnotherCardLeavesTheUnlockWaitOfThisOneAlone() = runTest {
        talk.stopCompletes = false
        val unanswered = CompletableDeferred<Heard>()
        talk.hearing = unanswered // card B (id 2) is asked and not answered yet
        val m = askedCard("first")
        talk.hearing = null
        talk.answers += Heard.YES
        lock.isLocked = true
        lock.gate = CompletableDeferred()
        replies += message(text = "second")
        messaging.found += Found.One(priya)
        m.sendSpoken("message Priya second") // card A (id 4) is asked, a yes presses Send, and it waits for the unlock
        advanceUntilIdle()
        assertTrue(log.any { it.startsWith("say Unlock your phone") })
        m.press(2, ChatButton.NOT_NOW) // B's Not now, not A's
        advanceUntilIdle()
        assertEquals(emptyList<ChatButton>(), m.item(2).buttonList())
        lock.gate!!.complete(true)
        advanceUntilIdle()
        assertEquals("A still went after the unlock", listOf("send Priya Sharma: second"), log.filter { it.startsWith("send ") })
        unanswered.complete(Heard.NO) // B's old question ends, late and for nothing
        advanceUntilIdle()
    }

    @Test fun notNowOnTheCardWaitingForTheUnlockStillCancelsItsWaitOnly() = runTest {
        val m = waitingAtTheUnlock(call = false)
        m.press(2, ChatButton.NOT_NOW)
        advanceUntilIdle()
        lock.gate!!.complete(true)
        advanceUntilIdle()
        assertEquals(0, m.sent())
        assertEquals(emptyList<ChatButton>(), m.item(2).buttonList())
    }

    // 6
    @Test fun theMicOrTypingWhileBuddyAsksHushesBuddyAndALateYesPressesNothing() = runTest {
        for (how in listOf("mic", "typing")) {
            log.clear()
            talk.stopCompletes = false
            val gate = CompletableDeferred<Heard>()
            talk.hearing = gate
            val m = askedCard()
            val stops = log.count { it == "stop" }
            if (how == "mic") m.hushVoice() else m.setDraft("h")
            assertTrue(how, log.count { it == "stop" } > stops)
            gate.complete(Heard.YES)
            advanceUntilIdle()
            assertEquals(how, 0, m.sent())
            assertEquals(how, listOf(ChatButton.SEND_MESSAGE, ChatButton.NOT_NOW), m.item(2).buttonList())
        }
    }

    // 9
    @Test fun aSpokenYesGoesThroughTheSamePressAsTheButton() = runTest {
        // Spoken
        talk.answers += Heard.YES
        val spoken = askedCard()
        val spokenLog = log.filter { it.startsWith("send ") || it == "aside" }
        val spokenCard = spoken.item(2)
        spoken.press(2, ChatButton.SEND_MESSAGE) // once: nothing more
        advanceUntilIdle()
        assertEquals(1, spoken.sent())
        // The button
        log.clear()
        talk.hearing = CompletableDeferred()
        val pressed = askedCard()
        pressed.press(2, ChatButton.SEND_MESSAGE)
        advanceUntilIdle()
        assertEquals(spokenLog, log.filter { it.startsWith("send ") || it == "aside" })
        assertEquals(spokenCard, pressed.item(2))
    }
}
