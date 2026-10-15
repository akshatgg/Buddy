package com.akshatgg.buddy.calls

import com.akshatgg.buddy.message.WhatsAppScreen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WhatsAppCallScreenTest {
    data class Node(val id: String = "", val text: String? = null, val desc: String? = null, val kids: List<Node> = emptyList())
    private fun all(n: Node): List<Node> = listOf(n) + n.kids.flatMap(::all)
    private val byId = { root: Node, id: String -> all(root).filter { it.id == id } }
    private val chat = WhatsAppScreen<Node>(byId, text = { it.text }, describe = { it.desc }, kids = { it.kids })
    private val screen = WhatsAppCallScreen(chat, byId, text = { it.text }, describe = { it.desc }, kids = { it.kids },
        voiceIds = listOf("voice_btn"), videoIds = listOf("video_btn"), idOf = { it.id })
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
}
