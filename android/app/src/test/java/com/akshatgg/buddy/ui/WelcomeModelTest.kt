package com.akshatgg.buddy.ui

import com.akshatgg.buddy.account.User
import com.akshatgg.buddy.cloud.FreeSettings
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.MemoryKeyValue
import com.akshatgg.buddy.ui.common.Status
import com.akshatgg.buddy.ui.common.Tone
import com.akshatgg.buddy.ui.welcome.Step
import com.akshatgg.buddy.ui.welcome.Step.AI
import com.akshatgg.buddy.ui.welcome.Step.BUDDY
import com.akshatgg.buddy.ui.welcome.Step.DONE
import com.akshatgg.buddy.ui.welcome.Step.FLOAT
import com.akshatgg.buddy.ui.welcome.Step.SIGN_IN
import com.akshatgg.buddy.ui.welcome.WelcomeModel
import com.akshatgg.buddy.ui.welcome.stepsFor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WelcomeModelTest {
    private val settings = AppSettings(MemoryKeyValue())
    private val asha = User("u1", "asha@example.com", "Asha Rao", "")

    private fun free(limitMode: String = "daily", allowOwnKey: Boolean = false, blocked: Boolean = false) =
        FreeSettings(freeOn = true, limitMode = limitMode, limit = 2, usedToday = 0, allowOwnKey = allowOwnKey, blocked = blocked, isAdmin = false)

    private fun CoroutineScope.model() = WelcomeModel(settings, this)

    private fun WelcomeModel.goTo(step: Step) {
        while (state.value.step != step) assertTrue("could not get to $step", next())
    }

    @Test fun connectAnAiIsAStepOnlyWhenThePersonMayNeedAKey() {
        assertEquals(listOf(SIGN_IN, BUDDY, FLOAT, AI, DONE), stepsFor(null))
        assertEquals(listOf(SIGN_IN, BUDDY, FLOAT, AI, DONE), stepsFor(free().copy(freeOn = false)))
        assertEquals(listOf(SIGN_IN, BUDDY, FLOAT, AI, DONE), stepsFor(free(allowOwnKey = true)))
        assertEquals(listOf(SIGN_IN, BUDDY, FLOAT, AI, DONE), stepsFor(free(blocked = true, allowOwnKey = true)))
        assertEquals(listOf(SIGN_IN, BUDDY, FLOAT, DONE), stepsFor(free(limitMode = "unlimited")))
        assertEquals(listOf(SIGN_IN, BUDDY, FLOAT, DONE), stepsFor(free()))
        assertEquals(listOf(SIGN_IN, BUDDY, FLOAT, DONE), stepsFor(free(blocked = true)))
    }

    @Test fun theStepsFollowTheFreeModeSettingsAsTheyArrive() = runTest {
        val m = model()
        assertEquals(listOf(SIGN_IN, BUDDY, FLOAT, AI, DONE), m.state.value.steps)
        m.setFree(free(limitMode = "unlimited"))
        assertEquals(listOf(SIGN_IN, BUDDY, FLOAT, DONE), m.state.value.steps)
        m.setUser(asha)
        m.goTo(FLOAT)
        m.setFree(null)
        assertEquals("the step shown stays", FLOAT, m.state.value.step)
        m.goTo(AI)
        m.setFree(free())
        assertEquals("a step that goes leaves the one after it", DONE, m.state.value.step)
    }

    @Test fun nextFromSignInIsRefusedWhileSignedOut() = runTest {
        val m = model()
        assertFalse(m.state.value.canGoNext)
        assertFalse(m.next())
        assertEquals(SIGN_IN, m.state.value.step)
        m.setUser(asha)
        assertTrue(m.state.value.canGoNext)
        assertTrue(m.next())
        assertEquals(BUDDY, m.state.value.step)
        m.back()
        assertEquals(SIGN_IN, m.state.value.step)
    }

    @Test fun signedOutOnALaterStepGoesBackToSignIn() = runTest {
        val m = model()
        m.setUser(asha)
        m.goTo(FLOAT)
        m.setUser(null)
        assertEquals(SIGN_IN, m.state.value.step)
        assertFalse(m.next())
    }

    @Test fun theNameFollowsTheBuddyUntilThePersonTypesOne() = runTest {
        val m = model()
        assertEquals("boy-1" to "Aarav", m.state.value.characterId to m.state.value.name)
        m.pick("girl-1")
        assertEquals("girl-1" to "Anaya", m.state.value.characterId to m.state.value.name)
        m.setName("Mitra")
        m.pick("boy-1")
        assertEquals("boy-1" to "Mitra", m.state.value.characterId to m.state.value.name)
        m.setName("x".repeat(40))
        assertEquals(24, m.state.value.name.length)
    }

    @Test fun finishingSetsOnboardedAndBuddyOnWithTheChosenBuddy() = runTest {
        val m = model()
        m.setUser(asha)
        m.pick("girl-1")
        m.setName("  Mitra ")
        m.goTo(DONE)
        assertTrue(m.finish())
        assertTrue(settings.onboarded)
        assertTrue(settings.buddyOn)
        assertEquals("girl-1", settings.characterId)
        assertEquals("Mitra", settings.buddyName)
    }

    @Test fun finishingIsRefusedToSomeoneSignedOut() = runTest {
        val m = model()
        assertFalse(m.finish())
        assertFalse(settings.onboarded)
        assertFalse(settings.buddyOn)
        assertEquals("Sign in with Google first.", m.state.value.finishError)
    }

    @Test fun aFailedSignInSaysWhyAndASignInClearsIt() = runTest {
        val m = model()
        m.signIn { throw BuddyError("sign_in_denied", "You didn't finish signing in with Google. Try again.") }
        testScheduler.advanceUntilIdle()
        assertEquals(Status("You didn't finish signing in with Google. Try again.", Tone.ERROR), m.state.value.signInStatus)
        assertFalse(m.state.value.signingIn)
        m.signIn { m.setUser(asha) }
        testScheduler.advanceUntilIdle()
        assertNull(m.state.value.signInStatus)
        assertEquals(asha, m.state.value.user)
    }

    @Test fun anUnexpectedFailureIsSaidInPlainWords() = runTest {
        val m = model()
        m.signIn { throw IllegalStateException("/data/user/0/secret path") }
        testScheduler.advanceUntilIdle()
        assertEquals(Status("Something went wrong. Try again.", Tone.ERROR), m.state.value.signInStatus)
    }
}
