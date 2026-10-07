package com.akshatgg.buddy.ui.settings

import com.akshatgg.buddy.FakeHttp
import com.akshatgg.buddy.account.Account
import com.akshatgg.buddy.cloud.CloudClient
import com.akshatgg.buddy.cloud.FreeSettings
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.net.HttpResponse
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.BuddySize
import com.akshatgg.buddy.store.MemoryKeyValue
import com.akshatgg.buddy.store.MemorySecrets
import com.akshatgg.buddy.ui.common.Status
import com.akshatgg.buddy.ui.common.Tone
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class) // runTest's clock: advanceTimeBy, runCurrent
class SettingsModelTest {
    private val kv = MemoryKeyValue().apply {
        putString("account.user", """{"uid":"u1","email":"asha@example.com","name":"Asha Rao","photo":""}""")
        putString("cloud", FreeSettings(true, "unlimited", null, 0, false, false, false).toJson())
    }
    private val secrets = MemorySecrets().apply { set("account.refresh", "refresh-token") }
    private val settings = AppSettings(kv)
    private val account = Account(kv, secrets, null)
    private val cloud = CloudClient(FakeHttp { HttpResponse(500, "") }, "", account, settings)

    private fun CoroutineScope.model() = SettingsModel(account, cloud, settings, this)

    @Test fun buddyOnWaitsForDisplayOverOtherAppsThenComesOnByItself() = runTest {
        val m = model()
        assertFalse(m.setBuddyOn(true, canFloat = false))
        assertFalse(settings.buddyOn)
        assertEquals(Status("Let Buddy float: allow Display over other apps.", Tone.ERROR), m.state.value.lines[Line.BUDDY])
        assertFalse("still not allowed", m.resumed(canFloat = false))
        assertTrue("allowed in the phone's settings meanwhile", m.resumed(canFloat = true))
        assertTrue(settings.buddyOn)
        assertTrue(m.state.value.buddyOn)
        assertNull(m.state.value.lines[Line.BUDDY])
        assertFalse("only once", m.resumed(canFloat = true))
        assertTrue(m.setBuddyOn(false, canFloat = true))
        assertFalse(settings.buddyOn)
    }

    @Test fun comingBackShowsBuddyTurnedOffElsewhereAndKeepsTheNameBeingTyped() = runTest {
        settings.buddyOn = true
        val m = model()
        m.setName("Mit")
        settings.buddyOn = false // "Turn off" in the notification
        m.resumed(canFloat = true)
        assertFalse(m.state.value.buddyOn)
        assertEquals("Mit", m.state.value.name)
        assertEquals("Mit", settings.buddyName)
    }

    @Test fun aChangeIsSavedAndSaysSoForAFewSeconds() = runTest {
        val m = model()
        assertFalse("the buddy already chosen", m.pick("boy-1"))
        assertTrue(m.pick("girl-1"))
        assertEquals("girl-1", settings.characterId)
        assertEquals(Status("Saved ✓", Tone.GOOD), m.state.value.lines[Line.BUDDY])
        m.setSize(BuddySize.LARGE)
        assertEquals(BuddySize.LARGE, settings.size)
        advanceTimeBy(3001)
        runCurrent()
        assertNull("a success fades", m.state.value.lines[Line.BUDDY])
    }

    @Test fun signingOutForgetsTheFreeModeSettingsToo() = runTest {
        val m = model()
        m.signOut()
        assertNull(account.user.value)
        assertNull(settings.cloud)
        assertNull(cloud.free.value)
        assertEquals(Status("Signed out."), m.state.value.lines[Line.ACCOUNT])
    }

    @Test fun aSignInSaysHowItWent() = runTest {
        val m = model()
        m.signIn { throw BuddyError("sign_in_denied", "You didn't finish signing in with Google. Try again.") }
        runCurrent()
        assertEquals(Status("You didn't finish signing in with Google. Try again.", Tone.ERROR), m.state.value.lines[Line.ACCOUNT])
        assertFalse(m.state.value.signingIn)
        m.signIn {}
        runCurrent()
        assertEquals(Status("Signed in ✓", Tone.GOOD), m.state.value.lines[Line.ACCOUNT])
    }
}
