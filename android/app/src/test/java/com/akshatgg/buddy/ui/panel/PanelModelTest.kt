package com.akshatgg.buddy.ui.panel

import com.akshatgg.buddy.TestShared
import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.AskInput
import com.akshatgg.buddy.ai.Prompts
import com.akshatgg.buddy.bubble.BubbleEvent
import com.akshatgg.buddy.bubble.Mood
import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
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

class PanelModelTest {
    private val asked = mutableListOf<Pair<Action, AskInput>>()
    private val events = mutableListOf<BubbleEvent>()
    private val moods get() = events.filterIsInstance<BubbleEvent.SetMood>().map { it.mood }
    private var reply: suspend (Action, AskInput) -> Answer = { _, _ -> Answer("done", "m") }

    private fun model(scope: CoroutineScope) = PanelModel({ action, input -> asked += action to input; reply(action, input) }, scope, { events += it })

    private fun TestScope.model() = model(this)

    @Test fun writeAsksWithTheInstructionAndToneAndTheHeadThinksThenIsHappy() = runTest {
        val m = model()
        m.setInstruction("x")
        m.setTone("friendly")
        m.submit()
        advanceUntilIdle()
        assertEquals(listOf(Action.WRITE to AskInput(instruction = "x", tone = "friendly")), asked)
        assertEquals(listOf(Mood.THINKING, Mood.HAPPY), moods)
        assertEquals(Answer("done", "m"), m.state.value.answer)
        assertNull(m.state.value.error)
    }

    @Test fun noInternetIsShownWithoutSettingsAndTheHeadIsSleepy() = runTest {
        reply = { _, _ -> throw BuddyError("network", "Couldn't reach Buddy's server. Check your internet.") }
        val m = model()
        m.setInstruction("x")
        m.submit()
        advanceUntilIdle()
        assertEquals(PanelError("Couldn't reach Buddy's server. Check your internet.", showSettings = false, code = "network"), m.state.value.error)
        assertEquals(listOf(Mood.THINKING, Mood.SLEEPY), moods)
        assertNull(m.state.value.answer)
    }

    @Test fun aMissingKeyOffersSettingsAndTheHeadGoesBackToIdle() = runTest {
        reply = { _, _ -> throw BuddyError("no_key", "Add your API key in Settings first.") }
        val m = model()
        m.setInstruction("x")
        m.submit()
        advanceUntilIdle()
        assertEquals(PanelError("Add your API key in Settings first.", showSettings = true, code = "no_key"), m.state.value.error)
        assertEquals(listOf(Mood.THINKING, Mood.IDLE), moods)
    }

    @Test fun fixSendsTheTextAndKeepsItAsTheBefore() = runTest {
        val m = model()
        m.select(Tab.FIX)
        m.setFixText("i am go to market")
        m.submit()
        advanceUntilIdle()
        assertEquals(listOf(Action.FIX to AskInput(text = "i am go to market")), asked)
        assertEquals("i am go to market", m.state.value.original)
    }

    @Test fun checkWithoutAPictureGetsTheRoutersOwnWords() = runTest {
        val prompts = Prompts(TestShared.shared)
        reply = { action, input -> prompts.build(action, input); Answer("ok", "m") }
        val m = model()
        m.select(Tab.CHECK)
        m.setQuestion("is this mail okay?")
        m.submit()
        advanceUntilIdle()
        assertEquals(PanelError("Take a screenshot first.", showSettings = false, code = "bad_request"), m.state.value.error)
    }

    @Test fun checkSendsThePictureAndTheQuestion() = runTest {
        val m = model()
        m.select(Tab.CHECK)
        m.setScreenshot("abc", null)
        m.setQuestion("is this mail okay?")
        m.submit()
        advanceUntilIdle()
        assertEquals(listOf(Action.CHECK to AskInput(image = "abc", instruction = "is this mail okay?")), asked)
    }

    @Test fun tryAgainRepeatsTheLastRequestEvenAfterTheFieldsChanged() = runTest {
        val m = model()
        m.setInstruction("first")
        m.submit()
        advanceUntilIdle()
        m.setInstruction("second")
        m.setTone("short")
        m.retry()
        advanceUntilIdle()
        val first = Action.WRITE to AskInput(instruction = "first", tone = "formal")
        assertEquals(listOf(first, first), asked)
    }

    @Test fun busyWhileAskingAndASecondPressDoesNothing() = runTest {
        val gate = CompletableDeferred<Answer>()
        reply = { _, _ -> gate.await() }
        val m = model()
        m.setInstruction("x")
        m.submit()
        runCurrent()
        assertTrue(m.state.value.busy)
        m.submit()
        runCurrent()
        assertEquals(1, asked.size)
        gate.complete(Answer("done", "m"))
        advanceUntilIdle()
        assertFalse(m.state.value.busy)
    }

    @Test fun anAnswerClearsAnErrorShownWhileAsking() = runTest {
        val gate = CompletableDeferred<Answer>()
        reply = { _, _ -> gate.await() }
        val m = model()
        m.select(Tab.FIX)
        m.setFixText("i am go")
        m.submit()
        runCurrent()
        m.showError(PanelError("Copy some text first, then tap Paste.", showSettings = false))
        gate.complete(Answer("I am going.", "m"))
        advanceUntilIdle()
        assertNull(m.state.value.error)
        assertEquals("I am going.", m.state.value.answer?.text)
    }

    @Test fun aNewOpeningEmptiesTheBoxesAndKeepsTheTabAndTone() = runTest {
        val gate = CompletableDeferred<Answer>()
        reply = { _, _ -> gate.await() }
        val m = model()
        m.setTone("short")
        m.setFixText("old text")
        m.select(Tab.CHECK)
        m.setScreenshot("old picture", null)
        m.setQuestion("old question")
        m.submit()
        runCurrent()
        m.reset()
        gate.complete(Answer("an answer for the last opening", "m"))
        advanceUntilIdle()
        assertEquals(PanelState(tab = Tab.CHECK, tone = "short"), m.state.value)
        assertEquals(listOf(Mood.THINKING, Mood.IDLE), moods)
        m.retry() // nothing to repeat: Try again belongs to the last opening too
        m.submit() // and its picture is gone
        advanceUntilIdle()
        assertEquals(AskInput(image = null, instruction = ""), asked.last().second)
    }

    @Test fun anAnswerThatTakesAMinuteIsTooLong() = runTest {
        reply = { _, _ -> awaitCancellation() }
        val m = model()
        m.setInstruction("x")
        m.submit()
        advanceTimeBy(59_999)
        assertTrue(m.state.value.busy)
        advanceTimeBy(2)
        runCurrent()
        assertEquals(PanelError("Buddy took too long to answer. Try again.", showSettings = false, code = "timeout"), m.state.value.error)
        assertEquals(listOf(Mood.THINKING, Mood.SLEEPY), moods)
        assertFalse(m.state.value.busy)
    }

    @Test fun somethingUnexpectedSaysTryAgainInPlainWords() = runTest {
        reply = { _, _ -> throw IllegalStateException("/data/user/0/secret/path") }
        val m = model()
        m.setInstruction("x")
        m.submit()
        advanceUntilIdle()
        assertEquals(PanelError("Something went wrong. Try again.", showSettings = false, code = "failed"), m.state.value.error)
        assertEquals(listOf(Mood.THINKING, Mood.IDLE), moods)
    }

    @Test fun closingThePanelWhileAskingSendsTheHeadBackToIdle() = runTest {
        reply = { _, _ -> awaitCancellation() }
        val panel = CoroutineScope(StandardTestDispatcher(testScheduler) + Job())
        val m = model(panel)
        m.setInstruction("x")
        m.submit()
        runCurrent()
        panel.cancel()
        runCurrent()
        assertEquals(listOf(Mood.THINKING, Mood.IDLE), moods)
    }

    @Test fun anotherTabHidesTheAnswerAndTheError() = runTest {
        val m = model()
        m.setInstruction("x")
        m.submit()
        advanceUntilIdle()
        m.showError(PanelError("Check screen needs a picture of your screen. Try again and allow it.", showSettings = false))
        m.select(Tab.FIX)
        assertNull(m.state.value.answer)
        assertNull(m.state.value.error)
        assertEquals(Tab.FIX, m.state.value.tab)
    }
}
