package com.akshatgg.buddy.ui.panel

import android.Manifest
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PermissionsTest {
    private val call = Manifest.permission.CALL_PHONE

    @Test fun aYesThatCameBackDoesNotCountUnlessAndroidSaysTheNeededOneIsHeld() = runTest {
        for (permission in listOf(Manifest.permission.CALL_PHONE, Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG)) {
            val answer = PendingAnswer(none = false)
            val notes = mutableListOf<String>()
            val asked = mutableListOf<String>()
            // A late "yes" to another question (the contacts one, or another permission) arrives while this one waits.
            val wait = async { allowedAfterAsking(permission, held = { false }, answer, launch = { asked += it }, note = { notes += it }) }
            runCurrent()
            answer.answered(true)
            assertFalse(permission, wait.await())
            assertEquals(listOf(permission), asked)
            assertEquals(listOf(whyLine(permission)), notes)
        }
    }

    @Test fun whatAndroidHoldsAfterTheAnswerDecides() = runTest {
        val answer = PendingAnswer(none = false)
        var granted = false
        val wait = async { allowedAfterAsking(call, held = { it == call && granted }, answer, launch = { granted = true }, note = {}) }
        runCurrent()
        answer.answered(false) // a stale "no" from an earlier question: Android says it is allowed now
        assertTrue(wait.await())
    }

    @Test fun heldAlreadyOrNobodyToAsk() = runTest {
        val answer = PendingAnswer(none = false)
        assertTrue(allowedAfterAsking(call, held = { true }, answer, launch = { error("not asked") }, note = { error("no line") }))
        assertFalse(allowedAfterAsking(call, held = { false }, answer, launch = null, note = { error("no line") }))
    }

    @Test fun eachNewQuestionHasItsLine() {
        assertEquals("I need your OK to make calls.", whyLine(Manifest.permission.CALL_PHONE))
        assertEquals("I need your OK to see who is calling.", whyLine(Manifest.permission.READ_PHONE_STATE))
        assertEquals("I need your OK to see your calls.", whyLine(Manifest.permission.READ_CALL_LOG))
        assertNull(whyLine(Manifest.permission.READ_CONTACTS)) // asked as it was in the message work, with no line
    }
}
