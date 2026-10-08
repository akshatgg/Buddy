package com.akshatgg.buddy.ui.settings

import com.akshatgg.buddy.FakeHttp
import com.akshatgg.buddy.TestShared
import com.akshatgg.buddy.account.Account
import com.akshatgg.buddy.ai.MemoryRules
import com.akshatgg.buddy.cloud.CloudClient
import com.akshatgg.buddy.cloud.FreeSettings
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.net.HttpResponse
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.BuddySize
import com.akshatgg.buddy.store.Memory
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

    private val memory = Memory(kv, MemoryRules(TestShared.shared))

    private fun CoroutineScope.model() = SettingsModel(account, cloud, settings, memory, this)

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

    @Test fun lookWhereITypeShowsWhatAndroidSaysEachTimeSettingsComesBack() = runTest {
        var enabled = false
        val m = SettingsModel(account, cloud, settings, memory, this, lookEnabled = { enabled })
        assertFalse(m.state.value.lookOn)
        enabled = true // turned on in Android's Accessibility settings
        m.resumed(canFloat = true)
        assertTrue(m.state.value.lookOn)
        enabled = false
        m.reload()
        assertFalse(m.state.value.lookOn)
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

    // ---- Memory ----

    private fun texts(m: SettingsModel) = m.facts.value.map { it.text }

    @Test fun aFactTypedInIsSavedTheBoxEmptiesAndTheLineSaysSo() = runTest {
        val m = model()
        assertEquals(emptyList<String>(), texts(m))
        m.setNewFact("  My boss is Mr. Sharma. ")
        assertTrue(m.addFact())
        assertEquals(listOf("My boss is Mr. Sharma."), texts(m))
        assertEquals("", m.state.value.newFact)
        assertEquals(Status("Saved ✓", Tone.GOOD), m.state.value.lines[Line.MEMORY])
        advanceTimeBy(3001)
        runCurrent()
        assertNull("a success fades", m.state.value.lines[Line.MEMORY])
    }

    @Test fun aBlankBoxAddsNothingAndSaysNothing() = runTest {
        val m = model()
        m.setNewFact("   ")
        assertFalse(m.addFact())
        assertEquals(emptyList<String>(), texts(m))
        assertNull(m.state.value.lines[Line.MEMORY])
    }

    @Test fun aSecretOrAKnownFactIsRefusedInTheDesktopsWordsAndStaysInTheBox() = runTest {
        val m = model()
        m.setNewFact("My ATM PIN is 1234.")
        assertFalse(m.addFact())
        assertEquals(
            Status("I can't save that. Passwords, PINs, OTPs and long numbers are never saved.", Tone.ERROR),
            m.state.value.lines[Line.MEMORY],
        )
        assertEquals("the box keeps it to change", "My ATM PIN is 1234.", m.state.value.newFact)
        memory.add("My boss is Mr. Sharma.", "chat")
        m.setNewFact("my boss is mr. sharma.")
        assertFalse(m.addFact())
        assertEquals(Status("I already know that.", Tone.ERROR), m.state.value.lines[Line.MEMORY])
        assertEquals(listOf("My boss is Mr. Sharma."), texts(m))
    }

    @Test fun theAddBoxTakesNoMoreThanAFactCanHold() = runTest {
        val m = model()
        m.setNewFact("x".repeat(250))
        assertEquals(200, m.state.value.newFact.length)
    }

    @Test fun withLearningOffAFactTypedInIsStillSaved() = runTest {
        val m = model()
        m.setLearning(false)
        m.setNewFact("My city is Pune.")
        assertTrue(m.addFact())
        assertEquals(listOf("My city is Pune."), texts(m))
    }

    @Test fun whatTheChatLearnsShowsAtOnce() = runTest {
        val m = model()
        memory.add("My boss is Mr. Sharma.", "chat")
        assertEquals(listOf("My boss is Mr. Sharma."), texts(m))
    }

    @Test fun theCrossForgetsOneFact() = runTest {
        val m = model()
        val boss = memory.add("My boss is Mr. Sharma.", "chat")!!
        memory.add("My city is Pune.", "chat")
        m.forgetFact(boss.id)
        assertEquals(listOf("My city is Pune."), texts(m))
        m.forgetFact(boss.id) // gone already: nothing happens
        assertEquals(listOf("My city is Pune."), texts(m))
    }

    @Test fun forgetEverythingAsksFirst() = runTest {
        val m = model()
        m.askForgetAll()
        assertFalse("nothing to forget: nothing to ask", m.state.value.forgetAsked)
        memory.add("My boss is Mr. Sharma.", "chat")
        memory.add("My city is Pune.", "chat")
        m.askForgetAll()
        assertTrue(m.state.value.forgetAsked)
        m.cancelForgetAll()
        assertFalse(m.state.value.forgetAsked)
        assertEquals("Cancel forgets nothing", 2, texts(m).size)
        m.askForgetAll()
        m.forgetAll()
        assertFalse(m.state.value.forgetAsked)
        assertEquals(emptyList<String>(), texts(m))
        assertEquals(Status("Buddy forgot everything.", Tone.GOOD), m.state.value.lines[Line.MEMORY])
        assertTrue("the switch stays as it was", memory.learning)
    }

    @Test fun theQuestionSaysHowManyThings() {
        assertEquals("Forget the 1 thing?", forgetAllQuestion(1))
        assertEquals("Forget all 3 things?", forgetAllQuestion(3))
    }

    @Test fun learnAboutMeFromChatsIsOnByDefaultAndSaved() = runTest {
        val m = model()
        assertTrue(m.state.value.learning)
        m.setLearning(false)
        assertFalse(m.state.value.learning)
        assertFalse(memory.learning)
        assertEquals(Status("Saved ✓", Tone.GOOD), m.state.value.lines[Line.MEMORY])
        assertFalse("a new Settings shows it off", model().state.value.learning)
        memory.learning = true // as if changed elsewhere
        m.setNewFact("half typed")
        m.reload()
        assertTrue(m.state.value.learning)
        assertEquals("what is being typed stays", "half typed", m.state.value.newFact)
    }
}
