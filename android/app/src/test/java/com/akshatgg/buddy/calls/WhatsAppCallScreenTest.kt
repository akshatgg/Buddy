package com.akshatgg.buddy.calls

import com.akshatgg.buddy.message.WhatsAppScreen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WhatsAppCallScreenTest {
    data class Node(val id: String = "", val text: String? = null, val desc: String? = null, val kids: List<Node> = emptyList(), val kind: String? = null)
    private fun all(n: Node): List<Node> = listOf(n) + n.kids.flatMap(::all)
    private val byId = { root: Node, id: String -> all(root).filter { it.id == id } }
    private val chat = WhatsAppScreen<Node>(byId, text = { it.text }, describe = { it.desc }, kids = { it.kids })
    private val screen = WhatsAppCallScreen(chat, byId, text = { it.text }, describe = { it.desc }, kids = { it.kids },
        voiceIds = listOf("voice_btn"), videoIds = listOf("video_btn"), idOf = { it.id }, kind = { it.kind })
    private val header = Node("com.whatsapp:id/conversation_contact_name", text = "Prince Sharma")

    @Test fun theCallButtonByIdOnlyInThatPersonsChat() {
        val voice = Node("com.whatsapp:id/voice_btn", desc = "Voice call")
        val video = Node("com.whatsapp:id/video_btn", desc = "Video call")
        val root = Node(kids = listOf(header, voice, video))
        assertEquals(voice, screen.callButtonFor(root, "com.whatsapp", "Prince Sharma", video = false))
        assertEquals(video, screen.callButtonFor(root, "com.whatsapp", "prince  sharma", video = true))
        assertNull(screen.callButtonFor(root, "com.whatsapp", "Rahul", video = false))
    }
    @Test fun elseByItsDescription() {
        val voice = Node("x", desc = "Voice call")
        val root = Node(kids = listOf(header, Node("y", desc = "Video call"), voice))
        assertEquals(voice, screen.callButtonFor(root, "com.whatsapp", "Prince Sharma", video = false))
    }
    @Test fun noChatOnScreenNoButton() {
        val root = Node(kids = listOf(Node("com.whatsapp:id/voice_btn", desc = "Voice call")))
        assertNull(screen.callButtonFor(root, "com.whatsapp", "Prince Sharma", video = false))
    }
    @Test fun anotherAppsButtonIsNotWhatsApps() {
        val lookalike = Node("com.other:id/call", desc = "Voice call")
        assertNull(screen.callButtonFor(Node(kids = listOf(header, lookalike)), "com.whatsapp", "Prince Sharma", video = false))
    }
    @Test fun whatsAppsOwnQuestionIsAnsweredOnlyForThatPerson() {
        val call = Node("android:id/button1", text = "CALL")
        val asking = Node(kids = listOf(Node("android:id/message", text = "Start a voice call with ‎Prince Sharma?"), call))
        assertTrue(screen.asks(asking))
        assertEquals(call, screen.confirmButtonFor(asking, "Prince Sharma"))
        assertNull(screen.confirmButtonFor(asking, "Prince")) // a longer name in the question is not "Prince"
        assertNull(screen.confirmButtonFor(asking, "Rahul"))
        assertFalse(screen.asks(Node(kids = listOf(header))))
    }
    @Test fun aNameInsideAnotherWordIsNotNamed() {
        val asking = Node(kids = listOf(Node("android:id/message", text = "Call Raprince?"), Node("android:id/button1", text = "CALL")))
        assertNull(screen.confirmButtonFor(asking, "Prince"))
    }

    @Test fun aCallLogBubbleInTheMessagesIsNotTheCallButton() {
        // WhatsApp's own "Voice call" bubbles in the chat say what the toolbar's button says: only the toolbar counts.
        val bubble = Node("com.whatsapp:id/call_bubble", desc = "Voice call")
        val messages = Node("android:id/list", kids = listOf(bubble))
        val voice = Node("x", desc = "Voice call")
        val root = Node(kids = listOf(header, messages, Node("toolbar", kids = listOf(voice))))
        assertEquals(voice, screen.callButtonFor(root, "com.whatsapp", "Prince Sharma", video = false))
        val conversation = Node("com.whatsapp:id/conversation", kids = listOf(bubble))
        assertNull(screen.callButtonFor(Node(kids = listOf(header, conversation)), "com.whatsapp", "Prince Sharma", video = false))
    }

    @Test fun noButtonIsLookedForInAListOfAnyKind() {
        val bubble = Node(desc = "Video call")
        val list = Node(kids = listOf(bubble), kind = "androidx.recyclerview.widget.RecyclerView")
        val video = Node(desc = "Video call")
        assertEquals(video, screen.callButtonFor(Node(kids = listOf(header, list, video)), "com.whatsapp", "Prince Sharma", video = true))
        val old = Node(kids = listOf(bubble), kind = "android.widget.ListView")
        assertNull(screen.callButtonFor(Node(kids = listOf(header, old)), "com.whatsapp", "Prince Sharma", video = true))
    }
    private val pressed = mutableListOf<Node>()
    private val click = { n: Node -> pressed += n; true }
    private fun asking(said: String, vararg more: Node) = Node(kids = listOf(Node("android:id/message", text = said)) + more)
    private val yes = Node("android:id/button1", text = "CALL")

    @Test fun theQuestionIsAnsweredOnlyWhenBuddyMayPress() {
        val q = asking("Start a voice call with Prince Sharma?", yes)
        assertEquals(Confirm.ASKING, screen.answer(q, "Prince Sharma", press = false, click = click))
        assertEquals(emptyList<Node>(), pressed)
        assertEquals(Confirm.PRESSED, screen.answer(q, "Prince Sharma", press = true, click = click))
        assertEquals(listOf(yes), pressed)
    }
    @Test fun theQuestionAboutSomeoneElseOrNoneAtAll() {
        assertEquals(Confirm.OTHER, screen.answer(asking("Call Rahul?", yes), "Prince Sharma", press = true, click = click))
        assertEquals(Confirm.NONE, screen.answer(Node(kids = listOf(header)), "Prince Sharma", press = true, click = click))
        assertEquals(emptyList<Node>(), pressed)
    }
    @Test fun aQuestionForThemWithNoCallButtonOrOneThatWontTakeThePressIsNotPressed() {
        assertEquals(Confirm.NOT_PRESSED, screen.answer(asking("Call Prince Sharma?"), "Prince Sharma", press = true, click = click))
        assertEquals(Confirm.NOT_PRESSED, screen.answer(asking("Call Prince Sharma?", yes), "Prince Sharma", press = true, click = { false }))
    }
}
