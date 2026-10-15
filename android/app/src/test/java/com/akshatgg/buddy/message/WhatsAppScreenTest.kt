package com.akshatgg.buddy.message

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WhatsAppScreenTest {
    data class Node(val id: String = "", val text: String? = null, val desc: String? = null, val kids: List<Node> = emptyList(), val hint: Boolean = false)
    private fun all(n: Node): List<Node> = listOf(n) + n.kids.flatMap(::all)
    private val screen = WhatsAppScreen<Node>(
        byId = { root, id -> all(root).filter { it.id == id } },
        text = { it.text }, describe = { it.desc }, kids = { it.kids }, idOf = { it.id }, hint = { it.hint },
    )
    private val send = Node("com.whatsapp:id/send", desc = "Send")
    private fun chat(name: String, box: String?, hint: Boolean = false) = Node(kids = listOfNotNull(
        Node("com.whatsapp:id/conversation_contact_name", text = name),
        box?.let { Node("com.whatsapp:id/entry", text = it, hint = hint) },
        send,
    ))

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

    @Test fun theBoxIsTheEntrysText() {
        assertEquals("I'm late", screen.boxText(chat("Priya Sharma", "I'm late"), "com.whatsapp"))
        assertNull(screen.boxText(chat("Priya Sharma", null), "com.whatsapp"))
        assertEquals("", screen.boxText(chat("Priya Sharma", "Message", hint = true), "com.whatsapp")) // only its hint
    }
    @Test fun theChatIsItsNameAndItsBox() {
        assertEquals(ChatState("Priya Sharma", "I'm late"), screen.chat(chat("Priya Sharma", "I'm late"), "com.whatsapp"))
        assertEquals(ChatState("Priya Sharma", ""), screen.chat(chat("Priya Sharma", null), "com.whatsapp"))
        assertNull(screen.chat(Node(kids = listOf(Node("com.whatsapp:id/entry", text = "hi"))), "com.whatsapp"))
    }
    @Test fun readyOnlyForThatPersonAndThatText() {
        assertTrue(ChatState("priya  sharma", "I'm late").readyFor("Priya Sharma", "I'm late"))
        assertTrue(ChatState("Priya Sharma", "I'm late\nsorry ").readyFor("Priya Sharma", "I'm late\n\nsorry")) // line breaks as WhatsApp keeps them
        assertFalse(ChatState("Priya Sharma", "old draft").readyFor("Priya Sharma", "I'm late"))
        assertFalse(ChatState("Priya Sharma", "I'm late, old draft").readyFor("Priya Sharma", "I'm late"))
        assertFalse(ChatState("Priya Sharma", "i'm late").readyFor("Priya Sharma", "I'm late"))
        assertFalse(ChatState("Rahul", "I'm late").readyFor("Priya Sharma", "I'm late"))
        assertFalse(ChatState("Priya Sharma", "").readyFor("Priya Sharma", " "))
    }
    @Test fun sendIsGivenOnlyWhenTheChatStillShowsThePersonAndTheText() {
        assertEquals(send, screen.sendButtonFor(chat("Priya Sharma", "I'm late"), "com.whatsapp", "Priya Sharma", "I'm late"))
        assertNull(screen.sendButtonFor(chat("Rahul", "I'm late"), "com.whatsapp", "Priya Sharma", "I'm late"))
        assertNull(screen.sendButtonFor(chat("Priya Sharma", "old draft"), "com.whatsapp", "Priya Sharma", "I'm late"))
        assertNull(screen.sendButtonFor(Node(kids = listOf(send)), "com.whatsapp", "Priya Sharma", "I'm late"))
    }
}
