package com.akshatgg.buddy.calls

import android.content.ActivityNotFoundException
import com.akshatgg.buddy.message.ChatState
import com.akshatgg.buddy.message.Person
import com.akshatgg.buddy.message.WhatsApp
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class WhatsAppCallerTest {
    private val prince = Person("Prince Sharma", "919812345678", "com.whatsapp")
    private class FakeWhatsApp(val noApp: Boolean = false) : WhatsApp {
        val opened = mutableListOf<Pair<Person, String>>()
        override fun installed() = true
        override suspend fun people() = emptyList<Person>()
        override fun open(person: Person, text: String) { if (noApp) throw ActivityNotFoundException("x"); opened += person to text }
    }
    /** Reads come one after another (the last one stays); `questions` likewise; a press that works ends the chat screen. */
    private class FakeScreen(
        var on: Boolean = true,
        var chats: MutableList<ChatState?> = mutableListOf(ChatState("Prince Sharma", "")),
        var questions: MutableList<Confirm> = mutableListOf(Confirm.NONE),
        var press: Boolean = true,
        var starts: Boolean = true,
        var fails: Exception? = null,
        var failsAfter: Exception? = null,
    ) : CallScreen {
        val pressed = mutableListOf<String>()
        override fun on() = on
        override suspend fun chat(app: String) = if (chats.size > 1) chats.removeAt(0) else chats.firstOrNull()
        override suspend fun pressCall(app: String, name: String, video: Boolean): Boolean {
            pressed += "$name ${if (video) "video" else "voice"}"
            fails?.let { throw it }
            if (press && starts) chats = mutableListOf(null)
            return press
        }
        override suspend fun question(app: String, name: String): Confirm {
            failsAfter?.let { throw it }
            return if (questions.size > 1) questions.removeAt(0) else questions.first()
        }
    }
    private fun caller(w: WhatsApp = FakeWhatsApp(), s: CallScreen = FakeScreen()) = WhatsAppCaller(w, s, wait = {})

    @Test fun opensTheChatWithNoTextChecksItAndPressesCall() = runTest {
        val w = FakeWhatsApp(); val s = FakeScreen(chats = mutableListOf(null, ChatState("Prince Sharma", "")))
        assertEquals(Called.Done, caller(w, s).call(prince, video = true))
        assertEquals(listOf(prince to ""), w.opened)
        assertEquals(listOf("Prince Sharma video"), s.pressed)
    }
    @Test fun anOldChatFirstThenTheirs() = runTest {
        val s = FakeScreen(chats = mutableListOf(ChatState("Rahul", ""), ChatState("Prince Sharma", "")))
        assertEquals(Called.Done, caller(s = s).call(prince, false))
        assertEquals(listOf("Prince Sharma voice"), s.pressed)
    }
    @Test fun wrongChatIsNotCalled() = runTest {
        val s = FakeScreen(chats = mutableListOf(ChatState("Rahul", "")))
        assertEquals(Called.Failed("That opened the wrong chat, so I didn't call."), caller(s = s).call(prince, false))
        assertEquals(emptyList<String>(), s.pressed)
    }
    @Test fun aChatThatNeverOpens() = runTest {
        val s = FakeScreen(chats = mutableListOf(null))
        assertEquals(Called.Failed("WhatsApp didn't open Prince Sharma's chat, so I didn't call."), caller(s = s).call(prince, false))
        assertEquals(emptyList<String>(), s.pressed)
    }
    @Test fun accessibilityOff() = runTest {
        val s = FakeScreen(on = false)
        assertEquals(Called.Failed("It's open in WhatsApp. Turn on Buddy in Accessibility so I can press Call for you.", "no_accessibility"),
            caller(s = s).call(prince, false))
        assertEquals(emptyList<String>(), s.pressed)
    }
    @Test fun noWhatsAppAnyMore() = runTest {
        val s = FakeScreen()
        assertEquals(Called.Failed("WhatsApp isn't on this phone."), caller(w = FakeWhatsApp(noApp = true), s = s).call(prince, false))
        assertEquals(emptyList<String>(), s.pressed)
    }
    @Test fun noCallButton() = runTest {
        assertEquals(Called.Failed("I couldn't press Call. Call from WhatsApp yourself."), caller(s = FakeScreen(press = false)).call(prince, false))
    }
    @Test fun whatsAppsQuestionForThisPersonIsAnsweredThenTheCallStarts() = runTest {
        val s = FakeScreen(questions = mutableListOf(Confirm.PRESSED, Confirm.NONE))
        assertEquals(Called.Done, caller(s = s).call(prince, false))
        assertEquals(1, s.pressed.size)
    }
    @Test fun aQuestionAboutSomeoneElseIsNotAnswered() = runTest {
        val s = FakeScreen(questions = mutableListOf(Confirm.OTHER), starts = false)
        assertEquals(Called.Failed("WhatsApp asked to call someone else, so I didn't."), caller(s = s).call(prince, false))
    }
    @Test fun aQuestionWhoseCallWouldNotTakeThePress() = runTest {
        val s = FakeScreen(questions = mutableListOf(Confirm.NOT_PRESSED), starts = false)
        assertEquals(Called.Failed("I couldn't press Call. Call from WhatsApp yourself."), caller(s = s).call(prince, false))
    }
    @Test fun aPressWhoseCallIsNotSeenIsUnsure() = runTest {
        val s = FakeScreen(starts = false)
        assertEquals(Called.Unsure, caller(s = s).call(prince, false))
        assertEquals(1, s.pressed.size)
        val t = FakeScreen(fails = IllegalStateException("gone"))
        assertEquals(Called.Unsure, caller(s = t).call(prince, false))
        assertEquals(1, t.pressed.size)
    }
    @Test fun aReadThatThrowsAfterThePressIsUnsure() = runTest {
        // Pressed: whatever goes wrong after, Buddy cannot tell, and never offers a second call.
        val s = FakeScreen(failsAfter = IllegalStateException("gone"))
        assertEquals(Called.Unsure, caller(s = s).call(prince, false))
        assertEquals(1, s.pressed.size)
    }
    @Test fun onlyOneReadWithoutTheChatIsNotEnough() = runTest {
        // The chat goes for one read (WhatsApp redrawing), then is back: not started.
        val s = FakeScreen(starts = false)
        s.chats = mutableListOf(ChatState("Prince Sharma", ""))
        val flicker = object : CallScreen by s {
            var reads = 0
            override suspend fun chat(app: String): ChatState? { reads += 1; return if (reads == 2) null else s.chat(app) }
        }
        assertEquals(Called.Unsure, caller(s = flicker).call(prince, false))
    }
}
