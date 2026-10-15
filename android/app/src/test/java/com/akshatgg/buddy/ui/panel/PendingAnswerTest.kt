package com.akshatgg.buddy.ui.panel

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PendingAnswerTest {
    @Test fun theAnswerEndsTheWait() = runTest {
        val pending = PendingAnswer(none = false)
        var asked = 0
        val wait = async { pending.ask { asked++ } }
        runCurrent()
        assertEquals(1, asked)
        pending.answered(true)
        assertTrue(wait.await())
    }

    @Test fun nobodyLeftToAnswerEndsTheWaitWithNo() = runTest {
        val pending = PendingAnswer(none = false)
        val wait = async { pending.ask {} }
        runCurrent()
        pending.giveUp()
        assertFalse(wait.await())
        pending.answered(true) // too late: nobody is waiting
    }

    @Test fun aNewQuestionEndsTheOneBeforeWithNo() = runTest {
        val pending = PendingAnswer(none = false)
        val first = async { pending.ask {} }
        runCurrent()
        val second = async { pending.ask {} }
        runCurrent()
        assertFalse(first.await())
        pending.answered(true)
        assertTrue(second.await())
    }

    @Test fun aQuestionThatCannotBeAskedWaitsForNothing() = runTest {
        val pending = PendingAnswer(none = false)
        val failed = runCatching { pending.ask { throw IllegalStateException("no launcher") } }
        assertTrue(failed.isFailure)
        val next = async { pending.ask {} }
        runCurrent()
        pending.answered(true)
        assertTrue(next.await())
    }
}
