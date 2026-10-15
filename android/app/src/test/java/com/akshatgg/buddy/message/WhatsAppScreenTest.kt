package com.akshatgg.buddy.message

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WhatsAppScreenTest {
    data class Node(val id: String = "", val text: String? = null, val desc: String? = null, val kids: List<Node> = emptyList())
    private fun all(n: Node): List<Node> = listOf(n) + n.kids.flatMap(::all)
    private val screen = WhatsAppScreen<Node>(
        byId = { root, id -> all(root).filter { it.id == id } },
        text = { it.text }, describe = { it.desc }, kids = { it.kids }, idOf = { it.id },
    )

    @Test fun theChatNameIsTheHeadersText() {
        val root = Node(kids = listOf(Node("com.whatsapp:id/conversation_contact_name", text = "Priya Sharma")))
        assertEquals("Priya Sharma", screen.chatName(root, "com.whatsapp"))
    }
    @Test fun noHeaderNoName() = assertNull(screen.chatName(Node(), "com.whatsapp"))
    @Test fun sendIsFoundByItsIdInTheRightApp() {
        val send = Node("com.whatsapp.w4b:id/send", desc = "Send")
        assertEquals(send, screen.sendButton(Node(kids = listOf(send)), "com.whatsapp.w4b"))
        assertNull(screen.sendButton(Node(kids = listOf(send)), "com.whatsapp"))
    }
    @Test fun elseByItsDescription() {
        val send = Node("x", desc = "send")
        assertEquals(send, screen.sendButton(Node(kids = listOf(Node("y", desc = "Emoji"), send)), "com.whatsapp"))
    }
}
