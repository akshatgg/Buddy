package com.akshatgg.buddy.ui.panel

import com.akshatgg.buddy.cloud.RemoteFeed
import com.akshatgg.buddy.cloud.RemoteItem
import com.akshatgg.buddy.cloud.RemoteLook
import com.akshatgg.buddy.cloud.RemoteSession
import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class) // runTest's clock: runCurrent, advanceTimeBy
class ClaudeModelTest {
    private val buddy = RemoteSession("s-1", "buddy", "working", true)
    private val web = RemoteSession("s-2", "web", "waiting", false)
    private val gone = "That session is not running any more. Pick another one."

    // What the computer shares now, as the server tells it; `feed` the items it has sent of the session looked at.
    private var online = true
    private var sessions = listOf(buddy, web)
    private var items: List<RemoteItem>? = null
    private var lookFails: Exception? = null
    private var failOnce = false // only the next look fails
    private var sendFails: Exception? = null
    private var held: CompletableDeferred<Unit>? = null // a send waits for this, when there is one
    private val calls = mutableListOf<String>() // what the model asked the server, in turn

    private fun TestScope.model(scope: CoroutineScope = backgroundScope) = ClaudeModel(
        look = { id ->
            calls += "look ${id ?: "-"}"
            lookFails?.let {
                if (failOnce) lookFails = null
                throw it
            }
            val feed = items?.let { list -> sessions.firstOrNull { it.id == id }?.let { RemoteFeed(it, list) } }
            RemoteLook(online, if (online) sessions else emptyList(), feed)
        },
        send = { id, text ->
            calls += "send $id $text"
            held?.await()
            sendFails?.let { throw it }
        },
        stop = { calls += "stop" },
        scope = scope,
    )

    private val ClaudeModel.s get() = state.value

    private fun looks() = calls.count { it.startsWith("look s-") }

    /** Into Claude mode, the list asked for and answered. */
    private fun TestScope.listed(m: ClaudeModel = model()): ClaudeModel {
        m.toggle()
        runCurrent()
        return m
    }

    /** A session open, and its first look answered. */
    private fun TestScope.opened(id: String = "s-1"): ClaudeModel {
        val m = listed()
        m.open(id)
        runCurrent()
        return m
    }

    // ---- the list ----

    @Test fun theClaudeButtonListsTheComputersSessions() = runTest {
        val m = model()
        assertFalse(m.s.on)
        m.toggle()
        assertTrue(m.s.on)
        assertTrue("asked for", m.s.looking)
        runCurrent()
        assertEquals(listOf("look -"), calls)
        assertEquals(ClaudeState(on = true, online = true, sessions = listOf(buddy, web)), m.s)
    }

    @Test fun aComputerThatIsNotSharingOrHasNoSessionSaysSoAndLookAgainAsksAgain() = runTest {
        online = false
        val m = listed()
        assertEquals(false, m.s.online)
        assertEquals(emptyList<RemoteSession>(), m.s.sessions)
        online = true
        sessions = emptyList()
        m.list()
        runCurrent()
        assertEquals(true, m.s.online)
        assertEquals(emptyList<RemoteSession>(), m.s.sessions)
        sessions = listOf(web)
        m.list()
        assertTrue("the sessions shown stay while it looks again", m.s.looking)
        runCurrent()
        assertEquals(listOf(web), m.s.sessions)
        assertEquals(listOf("look -", "look -", "look -"), calls)
        assertFalse("nothing was watched: nothing to stop", "stop" in calls)
    }

    @Test fun aListThatCouldNotBeFetchedSaysWhy() = runTest {
        lookFails = BuddyError("network", "Couldn't reach Buddy's server. Check your internet.")
        val m = listed()
        assertEquals(ClaudeState(on = true, listError = "Couldn't reach Buddy's server. Check your internet."), m.s)
        lookFails = IllegalStateException("bug")
        m.list()
        runCurrent()
        assertEquals("Something went wrong. Try again.", m.s.listError)
        lookFails = null
        m.list()
        runCurrent()
        assertNull(m.s.listError)
        assertEquals(listOf(buddy, web), m.s.sessions)
    }

    @Test fun theClaudeButtonAgainGoesBackToTheChat() = runTest {
        val m = listed()
        m.toggle()
        assertEquals(ClaudeState(), m.s)
    }

    // ---- a session ----

    @Test fun aSessionOpensWaitingForTheComputerAndIsLookedAtEvery1500msUntilItemsCome() = runTest {
        val m = listed()
        m.open("s-1")
        assertEquals(buddy, m.s.session)
        assertNull("waiting for the computer", m.s.items)
        assertEquals("Message Claude in buddy…", m.s.placeholder)
        runCurrent()
        assertEquals(1, looks())
        assertNull(m.s.items)
        advanceTimeBy(1_499)
        assertEquals("not yet", 1, looks())
        items = listOf(RemoteItem(1, "you", "fix the tests"))
        sessions = listOf(buddy.copy(status = "done"), web)
        advanceTimeBy(2)
        assertEquals(2, looks())
        assertEquals(listOf(RemoteItem(1, "you", "fix the tests")), m.s.items)
        assertEquals("the bar follows the session", "done", m.s.session?.status)
        items = items!! + RemoteItem(2, "claude", "Fixed.")
        advanceTimeBy(1_500)
        assertEquals(3, looks())
        assertEquals(2, m.s.items?.size)
        assertEquals(listOf("look -", "look s-1", "look s-1", "look s-1"), calls)
    }

    @Test fun aSessionTheListDoesNotHaveDoesNotOpen() = runTest {
        val m = listed()
        m.open("s-9")
        runCurrent()
        assertNull(m.s.session)
        assertEquals(0, looks())
    }

    @Test fun aLookThatFailsSaysWhyAndTheNextOneTriesAgain() = runTest {
        items = listOf(RemoteItem(1, "claude", "hi"))
        val m = opened()
        lookFails = BuddyError("timeout", "Buddy's server took too long to answer. Try again.")
        advanceTimeBy(1_501)
        assertEquals("Buddy's server took too long to answer. Try again.", m.s.problem)
        assertEquals("what was there stays", 1, m.s.items?.size)
        lookFails = null
        advanceTimeBy(1_500)
        assertNull(m.s.problem)
        assertEquals(3, looks())
    }

    @Test fun aSessionThatEndedGoesBackToTheListSayingSo() = runTest {
        val m = opened()
        lookFails = BuddyError("not_found", gone)
        failOnce = true
        sessions = listOf(web)
        advanceTimeBy(1_501)
        runCurrent()
        assertNull(m.s.session)
        assertEquals(listOf(web), m.s.sessions)
        assertEquals(gone, m.s.listError)
        assertTrue("the computer stops sending", "stop" in calls)
        val before = looks()
        advanceTimeBy(5_000)
        assertEquals("no more looks", before, looks())
    }

    @Test fun aComputerThatStopsSharingShowsTheListSayingSo() = runTest {
        val m = opened()
        online = false
        advanceTimeBy(1_501)
        assertNull(m.s.session)
        assertEquals(false, m.s.online)
        val before = looks()
        advanceTimeBy(5_000)
        assertEquals(before, looks())
    }

    @Test fun sessionsGoesBackToTheListAndTheComputerStopsSending() = runTest {
        val m = opened()
        m.list()
        runCurrent()
        assertNull(m.s.session)
        assertEquals(listOf("look -", "look s-1", "stop", "look -"), calls)
        advanceTimeBy(5_000)
        assertEquals("no more looks at it", 1, looks())
    }

    @Test fun theClaudeButtonFromASessionStopsItToo() = runTest {
        val m = opened()
        m.toggle()
        runCurrent()
        assertEquals(ClaudeState(), m.s)
        assertEquals("stop", calls.last())
        advanceTimeBy(5_000)
        assertEquals(1, looks())
    }

    @Test fun aHiddenPanelStopsLookingAndLooksAgainWhenShown() = runTest {
        val m = opened()
        m.hidden()
        runCurrent()
        assertEquals("stop", calls.last())
        advanceTimeBy(10_000)
        assertEquals("no looks while hidden", 1, looks())
        assertEquals("the session waits", buddy, m.s.session)
        m.shown()
        runCurrent()
        assertEquals(2, looks())
        advanceTimeBy(1_501)
        assertEquals(3, looks())
    }

    @Test fun aClosedPanelStopsAndEndsClaudeMode() = runTest {
        val m = opened()
        m.close()
        runCurrent()
        assertEquals(ClaudeState(), m.s)
        assertEquals("stop", calls.last())
        advanceTimeBy(10_000)
        assertEquals(1, looks())
    }

    @Test fun shownWithTheListAsksForTheSessionsAgainAndOutsideClaudeModeDoesNothing() = runTest {
        val m = model()
        m.hidden()
        m.shown()
        runCurrent()
        assertEquals(emptyList<String>(), calls)
        listed(m)
        m.hidden()
        m.shown()
        runCurrent()
        assertEquals(listOf("look -", "look -"), calls)
    }

    // ---- the box ----

    @Test fun theBoxSendsToTheSessionAndEmpties() = runTest {
        val m = opened()
        assertFalse("nothing to send", m.s.canSend)
        m.setDraft("  run the tests ")
        assertTrue(m.s.canSend)
        held = CompletableDeferred()
        m.send()
        assertEquals("", m.s.draft)
        assertTrue(m.s.sending)
        assertFalse("one at a time", m.s.canSend)
        runCurrent()
        assertEquals("send s-1 run the tests", calls.last())
        held!!.complete(Unit)
        runCurrent()
        assertFalse(m.s.sending)
        assertEquals("", m.s.draft)
        assertNull(m.s.boxError)
    }

    @Test fun nothingIsSentWithoutASessionOrWords() = runTest {
        val m = listed()
        m.setDraft("hi")
        assertFalse(m.s.canSend)
        m.send()
        m.open("s-1")
        m.setDraft("   ")
        m.send()
        runCurrent()
        assertFalse(calls.any { it.startsWith("send") })
    }

    @Test fun wordsThatCouldNotBeSentComeBackWithTheServersWords() = runTest {
        val m = opened()
        sendFails = BuddyError("mac_offline", "Your computer isn't sharing right now.")
        m.setDraft("run the tests")
        m.send()
        runCurrent()
        assertEquals("run the tests", m.s.draft)
        assertEquals("Your computer isn't sharing right now.", m.s.boxError)
        assertFalse(m.s.sending)
        m.setDraft("run the tests!")
        assertNull("typing clears it", m.s.boxError)
    }

    @Test fun wordsTypedWhileSendingAreNotWrittenOver() = runTest {
        val m = opened()
        sendFails = BuddyError("not_found", gone)
        held = CompletableDeferred()
        m.setDraft("first")
        m.send()
        runCurrent()
        m.setDraft("second")
        held!!.complete(Unit)
        runCurrent()
        assertEquals("second", m.s.draft)
        assertEquals(gone, m.s.boxError)
    }

    @Test fun aSendThatEndsAfterClaudeModeIsLeftChangesNothing() = runTest {
        val m = opened()
        sendFails = BuddyError("mac_offline", "Your computer isn't sharing right now.")
        held = CompletableDeferred()
        m.setDraft("hi")
        m.send()
        runCurrent()
        m.toggle()
        held!!.complete(Unit)
        runCurrent()
        assertEquals(ClaudeState(), m.s)
    }

    @Test fun voiceWordsGoInTheBoxAndItsErrorsUnderIt() = runTest {
        val m = opened()
        m.setDraft("run")
        m.voiceWords(" the tests ")
        assertEquals("run the tests", m.s.draft)
        m.voiceError(BuddyError("voice_off", "x"))
        assertEquals("Voice isn't set up yet.", m.s.boxError)
        m.voiceError(BuddyError("no_microphone", "Buddy needs the microphone to hear you. Allow it in Settings."))
        assertEquals("Buddy needs the microphone to hear you. Allow it in Settings.", m.s.boxError)
    }

    @Test fun aStopThatFailsIsNotTheAppsProblem() = runTest {
        // A failure that escaped would fail the test through backgroundScope.
        val m = ClaudeModel(
            look = { RemoteLook(true, listOf(buddy), null) },
            send = { _, _ -> },
            stop = { throw BuddyError("network", "Couldn't reach Buddy's server. Check your internet.") },
            scope = backgroundScope,
        )
        m.toggle()
        runCurrent()
        m.open("s-1")
        runCurrent()
        m.list()
        runCurrent()
        assertNull(m.s.session)
        m.toggle()
        m.toggle()
        runCurrent()
        assertTrue(m.s.on)
    }
}
