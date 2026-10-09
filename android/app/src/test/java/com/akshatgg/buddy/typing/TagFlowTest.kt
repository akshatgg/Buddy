package com.akshatgg.buddy.typing

import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.AskInput
import com.akshatgg.buddy.bubble.Mood
import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The box the person types in: what the app has, and what Buddy set in it. */
private class FakeBox(var box: BoxText?) : TypeIn {
    val writes = mutableListOf<Pair<String, Int>>()
    var reads = 0
    var writable = true
    override fun on() = true
    override fun appName() = "WhatsApp"
    override suspend fun read(): BoxText? {
        reads++
        return box
    }
    override suspend fun write(text: String, cursor: Int): Boolean {
        writes += text to cursor
        if (writable) box = BoxText(text, cursor, cursor)
        return writable
    }

    /** The person types: the box has `text`, the cursor at its end. */
    fun type(text: String) {
        box = BoxText(text, text.length, text.length)
    }
}

private class FakeShow : TagShow {
    val moods = mutableListOf<Mood>()
    val said = mutableListOf<String>()
    var tap: (() -> Unit)? = null
    override fun mood(mood: Mood) {
        moods += mood
    }
    override fun say(text: String, onTap: (() -> Unit)?) {
        said += text
        tap = onTap
    }
}

@OptIn(ExperimentalCoroutinesApi::class) // runTest's clock: advanceTimeBy, runCurrent, advanceUntilIdle
class TagFlowTest {
    private val box = FakeBox(null)
    private val show = FakeShow()
    private val asked = mutableListOf<Pair<Action, AskInput>>()
    private var on = true
    private var answer: suspend (AskInput) -> Answer = { Answer("Hi sir, I am not coming tomorrow.", "m") }

    private fun CoroutineScope.flow() = TagFlow(
        scope = this,
        box = box,
        ask = { action, input ->
            asked += action to input
            answer(input)
        },
        wanted = { on },
        names = { Tag.tagNames("Aarav") },
        show = show,
    )

    /** The person types `text` into the box, and the service tells the flow. */
    private fun TagFlow.typed(text: String) {
        box.type(text)
        onTyped(text)
    }

    private fun TestScope.pause() {
        advanceTimeBy(TAG_PAUSE_MS)
        runCurrent()
    }

    @Test fun aTagAndAPauseRewriteTheParagraphInPlace() = runTest {
        val f = flow()
        f.typed("Dear team,\ni not coming tomorow @buddy")
        advanceTimeBy(TAG_PAUSE_MS - 1)
        runCurrent()
        assertTrue("not before the pause", asked.isEmpty())
        pause()
        assertEquals(listOf(Action.TAG to AskInput(text = "i not coming tomorow", instruction = "")), asked)
        val fixed = "Dear team,\nHi sir, I am not coming tomorrow."
        assertEquals(listOf(fixed to fixed.length), box.writes)
        assertEquals(listOf(Mood.THINKING, Mood.HAPPY), show.moods)
        assertEquals(listOf(TAG_FIXING, TAG_FIXED), show.said)
        assertNotNull("Fixed ✅ can be tapped", show.tap)
    }

    @Test fun eachKeystrokeStartsThePauseAgainAndTheInstructionGoesWithIt() = runTest {
        val f = flow()
        f.typed("kal chutti @aarav")
        advanceTimeBy(1000)
        f.typed("kal chutti @aarav pol")
        advanceTimeBy(1000)
        f.typed("kal chutti @aarav polite")
        advanceTimeBy(1000)
        runCurrent()
        assertTrue(asked.isEmpty())
        pause()
        assertEquals(listOf(Action.TAG to AskInput(text = "kal chutti", instruction = "polite")), asked)
    }

    @Test fun theCursorStaysAfterTheNewTextAndWhatCameAfterTheTagsLineStays() = runTest {
        val f = flow()
        box.box = BoxText("Thanks.\ncan u send it @buddy polite\nBye", 35, 35) // the cursor at the end of the tag's line
        f.onTyped(box.box!!.text)
        pause()
        assertEquals(listOf(Action.TAG to AskInput(text = "can u send it", instruction = "polite")), asked)
        val fixed = "Thanks.\nHi sir, I am not coming tomorrow.\nBye"
        assertEquals(listOf(fixed to "Thanks.\nHi sir, I am not coming tomorrow.".length), box.writes)
    }

    @Test fun allRewritesTheWholeBox() = runTest {
        answer = { Answer("```\nOne line, and another.\n```", "m") }
        val f = flow()
        f.typed("one line\nand another @aarav all formal")
        pause()
        assertEquals(listOf(Action.TAG to AskInput(text = "one line\nand another", instruction = "formal")), asked)
        assertEquals("the answer is cleaned", "One line, and another.", box.box?.text)
    }

    @Test fun keptTypingWhileTheAiAnsweredLeavesTheBoxAlone() = runTest {
        val gate = CompletableDeferred<Answer>()
        answer = { gate.await() }
        val f = flow()
        f.typed("i not coming @buddy")
        pause()
        f.typed("i not coming @buddy and also") // while the AI answers: one at a time, nothing new starts
        gate.complete(Answer("I am not coming.", "m"))
        advanceUntilIdle()
        assertEquals(1, asked.size)
        assertTrue(box.writes.isEmpty())
        assertEquals("i not coming @buddy and also", box.box?.text)
        assertEquals(listOf(Mood.THINKING, Mood.IDLE), show.moods)
        assertEquals(TAG_KEPT_TYPING, show.said.last())
    }

    @Test fun anAiErrorIsSaidInItsOwnWords() = runTest {
        answer = { throw BuddyError("no_key", "Add your API key in Settings first.") }
        val f = flow()
        f.typed("i not coming @buddy")
        pause()
        assertTrue(box.writes.isEmpty())
        assertEquals(listOf(Mood.THINKING, Mood.IDLE), show.moods)
        assertEquals("Add your API key in Settings first.", show.said.last())
    }

    @Test fun noInternetMakesTheBuddySleepyAndAnEmptyAnswerIsAFailure() = runTest {
        answer = { throw BuddyError("network", "Couldn't reach Buddy's server. Check your internet.") }
        val f = flow()
        f.typed("i not coming @buddy")
        pause()
        assertEquals(Mood.SLEEPY, show.moods.last())
        answer = { Answer("  \"\"  ", "m") }
        f.typed("i not coming @buddy fix")
        pause()
        assertEquals(TAG_NOTHING, show.said.last())
        assertTrue(box.writes.isEmpty())
    }

    @Test fun aBoxThatCannotBeSetIsSaid() = runTest {
        box.writable = false
        val f = flow()
        f.typed("i not coming @buddy")
        pause()
        assertEquals(TAG_CANT_PUT, show.said.last())
        assertEquals(Mood.IDLE, show.moods.last())
    }

    @Test fun noTagNothingBeforeItOffOrTheTagDeletedAskNothing() = runTest {
        val f = flow()
        f.typed("mail me at sam@buddy.com")
        f.typed("see @buddyx")
        pause()
        f.typed("@buddy fix") // nothing to rewrite
        pause()
        f.typed("i not coming @buddy")
        advanceTimeBy(500)
        f.typed("i not coming @budd") // deleted again
        pause()
        on = false
        f.typed("i not coming @buddy")
        pause()
        assertTrue(asked.isEmpty())
        assertTrue(show.said.isEmpty())
    }

    @Test fun anOldTagAwayFromTheCursorIsLeftAlone() = runTest {
        val f = flow()
        box.box = BoxText("a @buddy\nnow typing here", 24, 24)
        f.onTyped(box.box!!.text)
        pause()
        assertTrue(asked.isEmpty())
        assertTrue("the last step shown in Settings", TagTrace.last.value!!.endsWith(TagTrace.ELSEWHERE))
        box.box = BoxText("a @buddy\nnow typing here", -1, -1) // the cursor is not known: the tag counts
        f.onTyped(box.box!!.text)
        pause()
        assertEquals(1, asked.size)
        // Some apps' own boxes say the cursor is at 0 whatever it is: taken as not known either.
        box.box = BoxText("hi there @buddy", 0, 0)
        f.onTyped(box.box!!.text)
        pause()
        assertEquals(2, asked.size)
    }

    @Test fun settingsShowsHowFarItGot() = runTest {
        val f = flow()
        TagTrace.typedIn("Telegram")
        f.onTyped("no tag here")
        assertEquals("Telegram · ${TagTrace.TYPING}", TagTrace.last.value)
        f.onTyped("i not coming @buddy") // seen in the event, but the box itself cannot be read
        assertEquals("Telegram · ${TagTrace.SAW_TAG}", TagTrace.last.value)
        pause()
        assertEquals("Telegram · ${TagTrace.NO_BOX}", TagTrace.last.value)
        f.typed("i not coming @buddy")
        pause()
        assertEquals("Telegram · ${TagTrace.FIXED}", TagTrace.last.value)
    }

    @Test fun buddysOwnChangeDoesNotStartItAgain() = runTest {
        answer = { Answer("B.", "m") }
        val f = flow()
        f.typed("a @buddy one\nb @buddy")
        pause()
        assertEquals("a @buddy one\nB.", box.box?.text)
        f.onTyped("a @buddy one\nB.") // the text change Buddy's own write makes
        pause()
        assertEquals(1, asked.size)
    }

    @Test fun aTapOnFixedPutsTheOldTextBackOnlyWhileItIsBuddysAndInTime() = runTest {
        val f = flow()
        f.typed("i not coming @buddy")
        pause()
        show.tap!!.invoke()
        runCurrent()
        assertEquals("i not coming @buddy", box.box?.text)
        assertEquals(TAG_UNDONE, show.said.last())
        f.onTyped("i not coming @buddy") // the change the Undo makes does not start it again
        pause()
        assertEquals(1, asked.size)

        // Changed since: left alone.
        f.typed("i not coming @buddy formal")
        pause()
        val tap = show.tap!!
        box.type(box.box!!.text + " ok")
        tap()
        runCurrent()
        assertEquals(TAG_CHANGED_SINCE, show.said.last())
        assertTrue(box.box!!.text.endsWith(" ok"))

        // Too late: nothing happens.
        f.typed("i not coming @buddy shorter")
        pause()
        val late = show.tap!!
        val writes = box.writes.size
        advanceTimeBy(TAG_UNDO_MS + 1)
        late()
        runCurrent()
        assertEquals(writes, box.writes.size)
        assertEquals(TAG_FIXED, show.said.last())
    }
}
