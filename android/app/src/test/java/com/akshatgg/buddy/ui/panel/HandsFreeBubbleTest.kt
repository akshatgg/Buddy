package com.akshatgg.buddy.ui.panel

import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.ChatReply
import com.akshatgg.buddy.bubble.BubbleEvent
import com.akshatgg.buddy.message.Found
import com.akshatgg.buddy.message.Person
import com.akshatgg.buddy.voice.VoiceWords
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The hands-free chat off screen: what Buddy says shows in the speech bubble, held while said, let go of after. */
@OptIn(ExperimentalCoroutinesApi::class)
class HandsFreeBubbleTest {
    private val events = mutableListOf<BubbleEvent>()
    private val replies = ArrayDeque<ChatReply>()
    private val log = mutableListOf<String>()
    private val messaging = FakeMessaging(log)
    private val talk = FakeTalkBack(log)
    private val priya = Person("Priya Sharma", "9198", "com.whatsapp")

    private fun answer(say: String, text: String = "") = ChatReply("answer", say, text, emptyList(), false, false, emptyList(), false)
    private fun message() = ChatReply("message", "", "hi", emptyList(), false, false, emptyList(), false, "Priya")

    /** A chat as AppGraph makes the hands-free one (opened, then hidden: never on screen), or the panel's own. */
    private fun chat(scope: CoroutineScope, showSpoken: Boolean = true, onScreen: Boolean = false) = PanelModel(
        ask = { _, _ -> Answer("raw", "m", chat = replies.removeFirst()) },
        scope = scope,
        bubble = { events += it },
        typeIn = FakeTypeIn(),
        facts = FakeFacts(),
        hands = PanelHands(stepAside = { log += "aside" }),
        messaging = messaging,
        talkBack = talk,
        lock = FakeLock(),
        now = { 1_000_000L },
        showSpoken = showSpoken,
    ).apply { open(); if (!onScreen) hidden() }

    /** What the speech bubble was told: the words, "(hold)" for null, "done". */
    private val speech get() = events.mapNotNull {
        when (it) {
            is BubbleEvent.Speech -> it.text ?: "(hold)"
            BubbleEvent.SpeechDone -> "done"
            else -> null
        }
    }

    @Test fun theAnswerIsShownWhileSaidAndLetGoOfAfter() = runTest {
        replies += answer("Paris is the capital of France.")
        chat(this).sendSpoken("capital of france")
        advanceUntilIdle()
        assertEquals(listOf("Paris is the capital of France.", "done"), speech)
        assertTrue("say Paris is the capital of France." in log)
    }

    @Test fun aLongAnswerIsCutInTheBubbleAndKeptWholeInTheChat() = runTest {
        val long = "word ".repeat(60) + "end"
        replies += answer("Here it is.", long)
        val m = chat(this)
        m.sendSpoken("tell me something long")
        advanceUntilIdle()
        val shown = speech.first()
        assertTrue(shown, shown.startsWith("Here it is. word") && shown.endsWith("…") && shown.length <= VoiceWords.BUBBLE_MAX)
        assertEquals(long, m.state.value.items.filterIsInstance<BuddySaid>().last().text)
    }

    @Test fun aCardsQuestionIsShownAndNoYesSendsNothing() = runTest {
        replies += message()
        messaging.found += Found.One(priya)
        chat(this).sendSpoken("message Priya hi")
        advanceUntilIdle()
        assertEquals(listOf("To Priya Sharma: hi. Send it?", "Okay, not sent."), speech.filter { it != "done" && it != "(hold)" })
        assertTrue("the question stays up while the answer is heard", "(hold)" in speech)
        assertTrue(log.none { it.startsWith("send ") })
    }

    @Test fun onScreenNothingGoesToTheBubble() = runTest {
        replies += answer("Paris.")
        chat(this, onScreen = true).sendSpoken("capital of france")
        advanceUntilIdle()
        assertEquals(emptyList<String>(), speech)
    }

    @Test fun thePanelsOwnChatNeverUsesTheBubble() = runTest {
        replies += answer("Paris.")
        chat(this, showSpoken = false).sendSpoken("capital of france")
        advanceUntilIdle()
        assertEquals(emptyList<String>(), speech)
    }
}
