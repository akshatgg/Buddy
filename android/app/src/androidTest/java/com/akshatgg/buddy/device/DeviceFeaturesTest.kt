package com.akshatgg.buddy.device

import android.Manifest
import android.app.KeyguardManager
import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.ChatReply
import com.akshatgg.buddy.apps.AppOpener
import com.akshatgg.buddy.apps.Opened
import com.akshatgg.buddy.apps.PhoneLauncher
import com.akshatgg.buddy.calls.AndroidCallLog
import com.akshatgg.buddy.calls.AndroidNameLookup
import com.akshatgg.buddy.calls.AndroidPhoneBook
import com.akshatgg.buddy.calls.AndroidPhoneState
import com.akshatgg.buddy.calls.CallFound
import com.akshatgg.buddy.calls.CallInfo
import com.akshatgg.buddy.calls.Called
import com.akshatgg.buddy.calls.PhoneCaller
import com.akshatgg.buddy.calls.PhoneDialer
import com.akshatgg.buddy.calls.RingWatch
import com.akshatgg.buddy.calls.phoneFormat
import com.akshatgg.buddy.notify.NotifReader
import com.akshatgg.buddy.ui.panel.BuddySaid
import com.akshatgg.buddy.ui.panel.ChatButton
import com.akshatgg.buddy.ui.panel.ChatEvent
import com.akshatgg.buddy.ui.panel.ChatItem
import com.akshatgg.buddy.ui.panel.PanelHands
import com.akshatgg.buddy.ui.panel.PanelModel
import com.akshatgg.buddy.voice.KeyguardLock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Shell commands as the shell user (UiAutomation), and a poll loop. */
internal fun sh(cmd: String): String {
    val fd = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(cmd)
    return android.os.ParcelFileDescriptor.AutoCloseInputStream(fd).use { it.readBytes().decodeToString() }
}

internal fun waitFor(ms: Long = 15_000, what: String = "condition", check: () -> Boolean) {
    val end = System.currentTimeMillis() + ms
    while (System.currentTimeMillis() < end) { if (check()) return; Thread.sleep(200) }
    throw AssertionError("timed out waiting for $what")
}

/** The device pieces of the phone-call, open-app, notification and lock features, on a real Android runtime. */
@RunWith(AndroidJUnit4::class)
class DeviceFeaturesTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
    private val allow: suspend (String) -> Boolean = { context.checkSelfPermission(it) == android.content.pm.PackageManager.PERMISSION_GRANTED }

    private fun caller() = PhoneCaller(AndroidPhoneBook(context), PhoneDialer(context), { allow(Manifest.permission.READ_CONTACTS) }, { allow(Manifest.permission.CALL_PHONE) })

    // ---- contacts and phone calls ----

    @Test fun contactsWithNumbersAreRead(): Unit = runBlocking {
        val rows = AndroidPhoneBook(context).rows()
        assertTrue("rows: $rows", rows.any { it.name == "Prince Sharma" && it.number == "5550100" && it.mobile })
    }

    @Test fun findPicksOnePersonAndRefusesTwoWithTheSameName(): Unit = runBlocking {
        val one = caller().find("Prince")
        assertTrue("$one", one is CallFound.One && one.callee.name == "Prince Sharma" && one.callee.number == "5550100")
        val twin = caller().find("Twin Dup")
        assertTrue("$twin", twin is CallFound.Say && twin.line.contains("more than one contact"))
        val nobody = caller().find("Zzyzx Nobody")
        assertTrue("$nobody", nobody is CallFound.Say)
    }

    @Test fun theDialerCanCallOnAPhoneWithTelephony() {
        assertTrue(PhoneDialer(context).canCall())
    }

    @Test fun actionCallStartsARealCallToTheEmulatorsOwnNumberAndItEnds(): Unit = runBlocking {
        val telecom = context.getSystemService(android.telecom.TelecomManager::class.java)
        val result = caller().call(com.akshatgg.buddy.calls.Callee("Emu", "5556"))
        assertEquals(Called.Done, result)
        try {
            waitFor(20_000, "a call to be in progress") { telecom.isInCall }
        } finally {
            sh("input keyevent KEYCODE_ENDCALL")
            sh("cmd telecom cleanup-stuck-calls")
        }
        waitFor(20_000, "the call to end") { !telecom.isInCall }
    }

    /** Phase 2 (emulator-device-tests.sh revokes CALL_PHONE first: revoking kills the app, so it cannot be done in a test). */
    @Test fun revokedCallPhoneIsRefusedAndNoCallStarts(): Unit = runBlocking {
        val r = caller().call(com.akshatgg.buddy.calls.Callee("Emu", "5556"))
        assertTrue("$r", r is Called.Failed && r.code == "no_calls")
        assertFalse(context.getSystemService(android.telecom.TelecomManager::class.java).isInCall)
    }

    // ---- who is calling, missed calls ----

    private fun callInfo(watch: RingWatch) = CallInfo(
        AndroidPhoneState(context), { watch.now }, AndroidCallLog(context), AndroidNameLookup(context),
        allowed = allow, format = phoneFormat(context),
    )

    @Test fun nobodyIsCallingWhenThePhoneIsQuiet(): Unit = runBlocking {
        val watch = RingWatch(context).also { it.start() }
        try {
            assertEquals("Nobody is calling right now.", callInfo(watch).ringing().line)
        } finally { watch.stop() }
    }

    /** Needs the host: `adb emu gsm call 5551234` while this waits, then `adb emu gsm cancel 5551234` (emulator-device-tests.sh). */
    @Test fun aRingingCallIsNamedThenBecomesAMissedCall(): Unit = runBlocking {
        val watch = RingWatch(context).also { it.start() }
        try {
            val info = callInfo(watch)
            waitFor(60_000, "the phone to ring (host: adb emu gsm call 5551234)") { AndroidPhoneState(context).ringing() }
            waitFor(10_000, "the number") { watch.now.number != null }
            assertEquals("5551234", watch.now.number)
            assertEquals("Ringer Test is calling.", info.ringing().line)
            waitFor(60_000, "the call to end (host: adb emu gsm cancel 5551234)") { !AndroidPhoneState(context).ringing() }
            assertEquals("Nobody is calling right now.", info.ringing().line)
            waitFor(10_000, "the call log row") { runBlocking { info.missed().line.contains("Ringer Test") } }
            val line = info.missed().line
            assertTrue(line, line.startsWith("1 missed call today: Ringer Test at ") || line.contains("missed calls today"))
        } finally { watch.stop() }
    }

    /** Phase 2 (READ_CALL_LOG revoked by the host). */
    @Test fun revokedCallLogGivesTheSettingsFixNotACrash(): Unit = runBlocking {
        val watch = RingWatch(context)
        assertEquals("no_call_log", callInfo(watch).missed().code)
        assertEquals("no_call_log", callInfo(watch).ringing().code)
    }

    // ---- opening apps ----

    @Test fun theLauncherListsAppsAndOpeningSettingsReallyOpensIt(): Unit = runBlocking {
        val apps = PhoneLauncher(context).apps()
        assertTrue("apps: ${apps.map { it.label }}", apps.any { it.label == "Settings" })
        assertFalse(apps.any { it.pkg == context.packageName })
        sh("cmd statusbar collapse"); sh("input keyevent KEYCODE_HOME"); Thread.sleep(1000)
        val r = AppOpener(PhoneLauncher(context)).open("settings")
        assertEquals(Opened.Done("Settings"), r)
        waitFor(15_000, "Settings on top") { sh("dumpsys activity activities").lines().any { it.contains("ResumedActivity") && it.contains("com.android.settings") } }
        sh("input keyevent KEYCODE_HOME")
    }

    @Test fun anAppThatDoesNotExistIsSaid(): Unit = runBlocking {
        val r = AppOpener(PhoneLauncher(context)).open("Zzyzx Nothing")
        assertTrue("$r", r is Opened.Say)
    }

    // ---- notifications ----

    @Test fun notificationAccessIsOnAndAPostedNotificationIsHeard(): Unit = runBlocking {
        waitFor(10_000, "notification access") { NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName) }
        Thread.sleep(2000) // the listener (re)connects after access is (re)allowed
        val store = AppGraph.instance.notifs
        val tag = "emu${System.currentTimeMillis()}"
        sh("cmd notification post -t Prince_Sharma $tag Dinner_at_eight")
        waitFor(20_000, "the listener to hear it") { store.recent().any { it.text == "Dinner_at_eight" } }
        val reader = NotifReader(on = { NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName) }, recent = store::recent)
        val all = reader.read("")
        assertTrue(all.line, all.line.contains("Prince_Sharma") && all.line.contains("Dinner_at_eight"))
        // the app the notification came from is the shell's
        val app = store.recent().first { it.text == "Dinner_at_eight" }.app
        assertTrue(reader.read(app).line.contains("Dinner_at_eight"))
    }

    /** Layout dependent (taps "Clear all" in the Pixel_7 shade), so not in emulator-device-tests.sh: run it alone, on a quiet emulator. */
    @Test fun aNotificationTakenAwayInTheShadeIsForgotten(): Unit = runBlocking {
        val store = AppGraph.instance.notifs
        val tag = "gone${System.currentTimeMillis()}"
        sh("cmd notification post -t Gone_title $tag Gone_text")
        waitFor(20_000, "the listener to hear it") { store.recent().any { it.text == "Gone_text" } }
        sh("cmd statusbar expand-notifications"); Thread.sleep(2500)
        sh("input tap 876 2128")
        waitFor(20_000, "the removal") { store.recent().none { it.text == "Gone_text" } }
    }

    @Test fun withNotificationAccessOffTheReaderSaysHowToTurnItOn(): Unit = runBlocking {
        val cn = "${context.packageName}/${context.packageName}.notify.BuddyNotifications"
        sh("cmd notification disallow_listener $cn")
        try {
            waitFor(10_000, "access off") { !NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName) }
            val r = NotifReader(on = { NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName) }, recent = AppGraph.instance.notifs::recent).read("")
            assertEquals("no_notifs", r.code)
            waitFor(10_000, "the store to be cleared on disconnect") { AppGraph.instance.notifs.recent().isEmpty() }
        } finally { sh("cmd notification allow_listener $cn") }
    }

    // ---- lock ----

    @Test fun keyguardLockSeesLockedAndUnlocked(): Unit = runBlocking {
        val km = context.getSystemService(KeyguardManager::class.java)
        sh("input keyevent KEYCODE_WAKEUP"); sh("wm dismiss-keyguard")
        waitFor(10_000, "unlocked") { !km.isKeyguardLocked }
        val lock = KeyguardLock(context)
        assertFalse(lock.locked())
        assertTrue(lock.unlocked(1_000))
        sh("locksettings set-pin 1234")
        try {
            sh("input keyevent KEYCODE_SLEEP")
            waitFor(10_000, "locked") { km.isKeyguardLocked }
            assertTrue(lock.locked())
            assertFalse(lock.unlocked(1_500)) // still locked: gives up
            // unlocked() must see ACTION_USER_PRESENT when the person types the PIN
            val waiting = kotlinx.coroutines.GlobalScope.async { lock.unlocked(30_000) }
            Thread.sleep(500)
            sh("input keyevent KEYCODE_WAKEUP"); Thread.sleep(1000)
            sh("input swipe 540 2000 540 600"); Thread.sleep(800)
            sh("input text 1234"); sh("input keyevent KEYCODE_ENTER")
            val got = kotlinx.coroutines.withTimeoutOrNull(35_000) { waiting.await() }
            assertTrue("unlocked() after the PIN: $got, keyguardLocked=${km.isKeyguardLocked}", got == true)
            assertFalse(lock.locked())
        } finally {
            sh("locksettings clear --old 1234")
            sh("input keyevent KEYCODE_WAKEUP"); sh("wm dismiss-keyguard")
        }
    }

    // ---- the chat panel with the real device parts and a fake AI ----

    private class Box : com.akshatgg.buddy.typing.TypeIn {
        override fun on() = true
        override fun appName(): String? = "Notes"
        override suspend fun read() = com.akshatgg.buddy.typing.BoxText("", 0, 0)
        override suspend fun write(text: String, cursor: Int) = true
    }

    private val noFacts = object : com.akshatgg.buddy.store.Facts {
        override fun facts() = emptyList<com.akshatgg.buddy.store.Fact>()
        override fun add(text: String, source: String): com.akshatgg.buddy.store.Fact? = null
        override fun remove(id: String) = false
        override val learning = false
    }

    private val noMessaging = object : com.akshatgg.buddy.message.Messaging {
        override suspend fun find(asked: String) = com.akshatgg.buddy.message.Found.Say("no")
        override suspend fun send(person: com.akshatgg.buddy.message.Person, text: String) = com.akshatgg.buddy.message.Sent.Done
    }

    private fun panel(reply: ChatReply, scope: CoroutineScope): PanelModel {
        val watch = RingWatch(context)
        return PanelModel(
            ask = { _, _ -> Answer("raw", "m", chat = reply) },
            scope = scope, bubble = {}, typeIn = Box(), facts = noFacts,
            hands = PanelHands(contacts = { true }, allow = allow), messaging = noMessaging,
            apps = AppOpener(PhoneLauncher(context)), phone = caller(),
            callInfo = callInfo(watch),
            notifs = NotifReader(on = { true }, recent = AppGraph.instance.notifs::recent),
        ).apply { open() }
    }

    private fun reply(kind: String, to: String = "", how: String = "", app: String = "", what: String = "") =
        ChatReply(kind, "", "", emptyList(), false, false, emptyList(), false, to = to, how = how, app = app, what = what)

    private fun lastOf(m: PanelModel): ChatItem? = m.state.value.items.lastOrNull()

    private fun chat(r: ChatReply, ask: String, check: (PanelModel) -> Unit) {
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        try {
            val m = panel(r, scope)
            m.setDraft(ask); m.send()
            check(m)
        } finally { scope.coroutineContext[kotlinx.coroutines.Job]?.cancel() }
    }

    @Test fun chatCallShowsACardWithCallAndNotNowAndPressingCallRingsTheEmulator() {
        chat(reply("call", to = "Prince", how = "phone"), "call prince") { m ->
            waitFor(15_000, "the call card") { (lastOf(m) as? BuddySaid)?.text == "Call Prince Sharma?" }
            val card = lastOf(m) as BuddySaid
            assertEquals(listOf(ChatButton.CALL, ChatButton.NOT_NOW), card.buttons)
            m.press(card.id, ChatButton.CALL)
            waitFor(15_000, "calling") { (lastOf(m) as? ChatEvent)?.text == "📞 Calling Prince Sharma" }
            sh("input keyevent KEYCODE_ENDCALL"); sh("cmd telecom cleanup-stuck-calls")
        }
    }

    @Test fun chatOpenOpensTheAppAndSaysSo() {
        chat(reply("open", app = "Settings"), "open settings") { m ->
            waitFor(15_000, "opened") { (lastOf(m) as? ChatEvent)?.text == "✅ Opened Settings" }
            sh("input keyevent KEYCODE_HOME")
        }
    }

    @Test fun chatWhoIsCallingAnswersNobodyWhenQuiet() {
        chat(reply("calls", what = "now"), "who is calling") { m ->
            waitFor(15_000, "answer") { (lastOf(m) as? BuddySaid)?.text == "Nobody is calling right now." }
        }
    }

    @Test fun chatMissedCallsAnswersALine() {
        chat(reply("calls", what = "missed"), "any missed calls") { m ->
            waitFor(15_000, "answer") { (lastOf(m) as? BuddySaid)?.text?.let { it.contains("missed call") } == true }
        }
    }

    @Test fun chatNotifsAnswersWithAPostedNotification() {
        val tag = "chat${System.currentTimeMillis()}"
        sh("cmd notification post -t Priya $tag Running_late")
        waitFor(20_000, "the listener to hear it") { AppGraph.instance.notifs.recent().any { it.text == "Running_late" } }
        chat(reply("notifs"), "who messaged me") { m ->
            waitFor(15_000, "answer") { (lastOf(m) as? BuddySaid)?.text?.contains("Priya") == true }
            assertTrue((lastOf(m) as BuddySaid).text.contains("Running_late"))
        }
        sh("cmd statusbar collapse")
    }
}
