package com.akshatgg.buddy.cloud

import com.akshatgg.buddy.TestShared
import com.akshatgg.buddy.account.User
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.store.Fact
import com.akshatgg.buddy.store.Memory
import com.akshatgg.buddy.store.MemoryKeyValue
import com.akshatgg.buddy.store.MemoryOp
import com.akshatgg.buddy.store.MemorySync
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MemorySyncerTest {
    private val kv = MemoryKeyValue()
    private var ids = 0
    private val memory = Memory(kv, MemorySync(TestShared.shared), now = { 5L }, newId = { "f${++ids}" })
    private val user = MutableStateFlow<User?>(User("u1", "a@b.c", "A", ""))
    private var clock = 1_000_000L

    // What the server answers each sync, in turn: the account's facts, an exception, or a deferred to wait for. With
    // none left, the facts the phone sent as adds are answered back (the account had none).
    private val answers = ArrayDeque<Any>()
    private val sent = mutableListOf<List<MemoryOp>>()
    private val send: suspend (List<MemoryOp>) -> List<Fact> = { ops ->
        sent += ops
        @Suppress("UNCHECKED_CAST")
        when (val next = answers.removeFirstOrNull()) {
            null -> ops.filterIsInstance<MemoryOp.Add>().map { Fact(it.id, it.text, it.at) }
            is Exception -> throw next
            is CompletableDeferred<*> -> next.await() as List<Fact>
            else -> next as List<Fact>
        }
    }
    private fun syncer(scope: CoroutineScope) = MemorySyncer(memory, user, send, scope, now = { clock })
    private val tea = Fact("x1", "You like tea.", 9)
    private fun texts() = memory.facts().map { it.text }

    @Test fun signedOutNothingIsSentAndTheChangesWait() = runTest {
        user.value = null
        memory.add("Your boss is Mr. Sharma.", "chat")
        assertFalse(syncer(backgroundScope).sync())
        assertEquals(emptyList<List<MemoryOp>>(), sent)
        assertEquals(1, memory.outbox().size)
    }

    @Test fun theFirstSyncSendsWhatThePhoneKnewAndKeepsTheAccountsFacts() = runTest {
        memory.add("Your boss is Mr. Sharma.", "chat")
        answers.add(listOf(Fact("f1", "Your boss is Mr. Sharma.", 5), tea))
        assertTrue(syncer(backgroundScope).sync())
        assertEquals(listOf(listOf<MemoryOp>(MemoryOp.Add("f1", "Your boss is Mr. Sharma.", 5))), sent)
        assertEquals("u1", memory.linked)
        assertEquals(emptyList<MemoryOp>(), memory.outbox())
        assertEquals(listOf("Your boss is Mr. Sharma.", "You like tea."), memory.changes.value.map { it.text })
    }

    @Test fun aFailureIsQuietAndTheChangesGoWithTheNextSync() = runTest {
        kv.putString("memoryUid", "u1")
        memory.add("Your boss is Mr. Sharma.", "chat")
        val s = syncer(backgroundScope)
        for (failure in listOf(BuddyError("network", "offline"), BuddyError("signed_out", ""), IllegalStateException("odd"))) {
            answers.add(failure)
            assertFalse(s.sync())
            assertEquals(1, memory.outbox().size)
            assertEquals(listOf("Your boss is Mr. Sharma."), texts())
        }
        assertTrue(s.sync())
        assertEquals("the same change each time", 1, sent.distinct().size)
        assertEquals(emptyList<MemoryOp>(), memory.outbox())
    }

    @Test fun aChangeMadeDuringASyncStaysForTheNextAndIsKeptOnTop() = runTest {
        kv.putString("memoryUid", "u1")
        memory.add("Your boss is Mr. Sharma.", "chat")
        val answer = CompletableDeferred<List<Fact>>()
        answers.add(answer)
        val s = syncer(backgroundScope)
        val first = async { s.sync() }
        runCurrent()
        memory.clear() // "Forget everything" while the sync is on its way
        answer.complete(listOf(Fact("f1", "Your boss is Mr. Sharma.", 5), tea))
        assertTrue(first.await())
        assertEquals(listOf<MemoryOp>(MemoryOp.Clear), memory.outbox())
        assertEquals(emptyList<String>(), texts())
    }

    @Test fun oneSyncAtATimeAndOneThatBeganAfterAnotherWasAskedCoversIt() = runTest {
        kv.putString("memoryUid", "u1")
        val answer = CompletableDeferred<List<Fact>>()
        answers.add(answer)
        val s = syncer(backgroundScope)
        val first = async { s.sync() }
        runCurrent()
        memory.add("Your boss is Mr. Sharma.", "chat") // after the first sync took the outbox
        val second = async { s.sync() }
        val third = async { s.sync() }
        runCurrent()
        assertEquals("the others wait", 1, sent.size)
        answer.complete(emptyList())
        assertTrue(first.await() && second.await() && third.await())
        assertEquals("the second sends the change, and covers the third", listOf(emptyList(), listOf<MemoryOp>(MemoryOp.Add("f1", "Your boss is Mr. Sharma.", 5))), sent)
    }

    @Test fun anAnswerForSomeoneWhoIsNoLongerSignedInIsNotKept() = runTest {
        kv.putString("memoryUid", "u1")
        memory.add("Your boss is Mr. Sharma.", "chat")
        val answer = CompletableDeferred<List<Fact>>()
        answers.add(answer)
        val s = syncer(backgroundScope)
        val first = async { s.sync() }
        runCurrent()
        user.value = User("u2", "b@b.c", "B", "")
        answer.complete(listOf(tea))
        assertFalse(first.await())
        assertEquals(listOf("Your boss is Mr. Sharma."), texts())
        assertEquals("u1", memory.linked)
        assertEquals(1, memory.outbox().size)
    }

    @Test fun itSyncsAtStartAtASignInAndASecondAfterChanges() = runTest {
        kv.putString("memoryUid", "u1")
        syncer(backgroundScope).start()
        runCurrent()
        assertEquals("at start, signed in", 1, sent.size)

        memory.add("Your boss is Mr. Sharma.", "chat")
        advanceTimeBy(500)
        memory.add("Your city is Pune.", "chat")
        advanceTimeBy(999)
        runCurrent()
        assertEquals("not yet", 1, sent.size)
        advanceTimeBy(2)
        runCurrent()
        assertEquals("both changes in one sync", 2, sent.size)
        assertEquals(2, sent.last().size)

        user.value = null
        runCurrent()
        memory.remove("f1")
        advanceTimeBy(1_001)
        runCurrent()
        assertEquals("signed out: nothing sent", 2, sent.size)
        user.value = User("u1", "a@b.c", "A", "")
        runCurrent()
        assertEquals("signed in again: the change goes", listOf<MemoryOp>(MemoryOp.Forget("f1")), sent.last())
        assertEquals(emptyList<MemoryOp>(), memory.outbox())
    }

    @Test fun thePanelSyncsOnlyWhenTheLastSyncIsOverTwoMinutesOld() = runTest {
        val s = syncer(backgroundScope)
        s.requestIfStale()
        runCurrent()
        assertEquals("never synced in this run", 1, sent.size)
        clock += 120_000 - 1
        s.requestIfStale()
        runCurrent()
        assertEquals(1, sent.size)
        clock += 1
        s.requestIfStale()
        runCurrent()
        assertEquals(2, sent.size)
        s.request()
        runCurrent()
        assertEquals("Settings always syncs", 3, sent.size)
    }

    @Test fun thePanelDoesNotQueueASyncBehindOneRunning() = runTest {
        val answer = CompletableDeferred<List<Fact>>()
        answers.add(answer)
        val s = syncer(backgroundScope)
        s.request()
        runCurrent()
        s.requestIfStale()
        answer.complete(emptyList())
        runCurrent()
        assertEquals(1, sent.size)
        assertNull("nothing was changed here", kv.getString("memoryOutbox"))
    }
}
