package com.akshatgg.buddy.message

import android.content.ActivityNotFoundException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class MessengerTest {
    private val priya = Person("Priya Sharma", "9198", "com.whatsapp")
    private class FakeWhatsApp(var on: Boolean = true, val list: List<Person> = emptyList()) : WhatsApp {
        val opened = mutableListOf<Pair<Person, String>>()
        var noApp = false // open() finds no app to open the link
        var noContacts = false // people() is refused by Android
        override fun installed() = on
        override suspend fun people(): List<Person> {
            if (noContacts) throw SecurityException("Permission Denial: reading contacts")
            return list
        }
        override fun open(person: Person, text: String) {
            if (noApp) throw ActivityNotFoundException("No Activity found")
            opened += person to text
        }
    }
    /** WhatsApp's chat as Buddy reads it, one read after another (the last one stays); `log` has the waits too. */
    private class FakeScreen(var on: Boolean = true, var chats: MutableList<ChatState?> = mutableListOf(ChatState("Priya Sharma", "hi")), var press: Boolean = true) : ChatScreen {
        val pressed = mutableListOf<String>()
        val log = mutableListOf<String>()
        override fun on() = on
        override suspend fun chat(app: String): ChatState? {
            log += "read"
            return if (chats.size > 1) chats.removeAt(0) else chats.firstOrNull()
        }
        override suspend fun pressSend(app: String, name: String, text: String): Boolean { pressed += "$app $name: $text"; return press }
    }
    private fun priyaWith(box: String) = ChatState("Priya Sharma", box)
    private fun messenger(w: WhatsApp, s: ChatScreen = FakeScreen(), allowed: Boolean = true) =
        Messenger(w, s, contactsAllowed = { allowed }, wait = { (s as? FakeScreen)?.log?.add("wait") })

    @Test fun findsOnePerson() = runTest {
        assertEquals(Found.One(priya), messenger(FakeWhatsApp(list = listOf(priya, Person("Rahul", "9197", "com.whatsapp")))).find("priya"))
    }
    @Test fun noWhatsApp() = runTest {
        assertEquals(Found.Say("WhatsApp isn't on this phone."), messenger(FakeWhatsApp(on = false)).find("Priya"))
    }
    @Test fun noContacts() = runTest {
        assertEquals(Found.Say("I need your contacts to find Priya. You can allow it in Settings.", "no_contacts"),
            messenger(FakeWhatsApp(list = listOf(priya)), allowed = false).find("Priya"))
    }
    @Test fun contactsRefusedWhileReadingThem() = runTest {
        val w = FakeWhatsApp(list = listOf(priya)).apply { noContacts = true }
        assertEquals(Found.Say("I need your contacts to find Priya. You can allow it in Settings.", "no_contacts"), messenger(w).find("Priya"))
    }
    @Test fun whichOne() = runTest {
        val two = listOf(priya, Person("Priya Verma", "9199", "com.whatsapp"))
        assertEquals(Found.Say("Which Priya: Priya Sharma or Priya Verma? Tell me the full name."), messenger(FakeWhatsApp(list = two)).find("Priya"))
    }
    @Test fun twoContactsWithTheSameNameAreNotGuessed() = runTest {
        val two = listOf(priya, Person("Priya Sharma", "9200", "com.whatsapp"))
        assertEquals(Found.Say("You have more than one contact called Priya Sharma. Rename one in your phone's contacts, then ask me again."),
            messenger(FakeWhatsApp(list = two)).find("Priya"))
    }
    @Test fun thePersonOnBothWhatsAppsIsOnePersonOnWhatsApp() = runTest {
        val business = Person("Priya Sharma", "9198", "com.whatsapp.w4b")
        assertEquals(Found.One(priya), messenger(FakeWhatsApp(list = listOf(business, priya))).find("Priya"))
        assertEquals(Found.One(business), messenger(FakeWhatsApp(list = listOf(business))).find("Priya"))
    }
    @Test fun sendsAfterTheRightChatOpens() = runTest {
        val w = FakeWhatsApp(); val s = FakeScreen(chats = mutableListOf(null, null, priyaWith("I'm late")))
        assertEquals(Sent.Done, messenger(w, s).send(priya, "I'm late"))
        assertEquals(listOf(priya to "I'm late"), w.opened)
        assertEquals(listOf("com.whatsapp Priya Sharma: I'm late"), s.pressed)
    }
    @Test fun whatsAppGoneAtSendIsSaid() = runTest {
        val w = FakeWhatsApp().apply { noApp = true }; val s = FakeScreen()
        assertEquals(Sent.Failed("WhatsApp isn't on this phone."), messenger(w, s).send(priya, "hi"))
        assertEquals(emptyList<String>(), s.pressed)
    }
    @Test fun wrongChatIsNotSent() = runTest {
        val s = FakeScreen(chats = mutableListOf(ChatState("Rahul", "hi")))
        assertEquals(Sent.Failed("That opened the wrong chat, so I didn't send it."), messenger(FakeWhatsApp(), s).send(priya, "hi"))
        assertEquals(emptyList<String>(), s.pressed)
    }
    @Test fun theChatOpenBeforeIsWaitedPast() = runTest {
        val s = FakeScreen(chats = mutableListOf(ChatState("Rahul", "hi"), null, priyaWith("hi")))
        assertEquals(Sent.Done, messenger(FakeWhatsApp(), s).send(priya, "hi"))
        assertEquals(listOf("com.whatsapp Priya Sharma: hi"), s.pressed)
    }
    @Test fun chatThatNeverOpens() = runTest {
        val s = FakeScreen(chats = mutableListOf(null))
        assertEquals(Sent.Failed("WhatsApp didn't open Priya Sharma's chat, so I didn't send it."), messenger(FakeWhatsApp(), s).send(priya, "hi"))
        assertEquals(emptyList<String>(), s.pressed)
    }
    @Test fun anOldDraftInTheirChatIsNotSent() = runTest {
        val s = FakeScreen(chats = mutableListOf(priyaWith("see you at 5")))
        assertEquals(Sent.Failed("WhatsApp didn't put the message in, so I didn't send it."), messenger(FakeWhatsApp(), s).send(priya, "I'm late"))
        assertEquals(emptyList<String>(), s.pressed)
        assertEquals(32, s.log.count { it == "read" }) // looked for the whole 8 s
    }
    @Test fun theTextIsWaitedForPastAnOldDraft() = runTest {
        val s = FakeScreen(chats = mutableListOf(priyaWith("see you at 5"), priyaWith("see you at 5"), priyaWith("I'm late")))
        assertEquals(Sent.Done, messenger(FakeWhatsApp(), s).send(priya, "I'm late"))
        assertEquals(listOf("com.whatsapp Priya Sharma: I'm late"), s.pressed)
    }
    @Test fun lineBreaksWhatsAppKeptItsOwnWayStillMatch() = runTest {
        val s = FakeScreen(chats = mutableListOf(priyaWith("I'm late\nsorry")))
        assertEquals(Sent.Done, messenger(FakeWhatsApp(), s).send(priya, "I'm late\n\nsorry "))
        assertEquals(listOf("com.whatsapp Priya Sharma: I'm late\n\nsorry "), s.pressed)
    }
    @Test fun theChatIsFirstReadAfterAWait() = runTest {
        val s = FakeScreen()
        assertEquals(Sent.Done, messenger(FakeWhatsApp(), s).send(priya, "hi"))
        assertEquals(listOf("wait", "read"), s.log)
    }
    @Test fun accessibilityOff() = runTest {
        val w = FakeWhatsApp(); val s = FakeScreen(on = false)
        assertEquals(Sent.Failed("It's ready in WhatsApp. Turn on Buddy in Accessibility so I can press Send for you.", "no_accessibility", inWhatsApp = true),
            messenger(w, s).send(priya, "hi"))
        assertEquals(1, w.opened.size) // the text is still put in, for them to send
        assertEquals(emptyList<String>(), s.pressed)
        assertEquals(emptyList<String>(), s.log)
    }
    @Test fun sendNotTaken() = runTest {
        assertEquals(Sent.Failed("I couldn't press Send. It's ready in WhatsApp: press Send yourself.", inWhatsApp = true),
            messenger(FakeWhatsApp(), FakeScreen(press = false)).send(priya, "hi"))
    }
}
