package com.akshatgg.buddy.message

private val SPACES = Regex("\\s+")

/** What WhatsApp's open chat shows: whose chat it is (its name at the top) and the text in its message box. */
data class ChatState(val name: String, val box: String)

/**
 * Whether the chat shows this person, with exactly this text in its box: the only time Buddy presses Send. Checked
 * while waiting for the chat and again at the press. Line breaks and spaces count as one space (WhatsApp may keep a
 * message's line breaks its own way); every other character must be the same.
 */
fun ChatState.readyFor(person: String, text: String): Boolean {
    val want = text.replace(SPACES, " ").trim()
    return sameName(name, person) && want.isNotEmpty() && box.replace(SPACES, " ").trim() == want
}

/**
 * Where things are on WhatsApp's chat screen, found by WhatsApp's own view ids (and Send also by its description,
 * should an update rename it). Generic over the node so that it can be tested without Android.
 */
class WhatsAppScreen<N>(
    private val byId: (N, String) -> List<N>,
    private val text: (N) -> String?,
    private val describe: (N) -> String?,
    private val kids: (N) -> List<N>,
    private val idOf: (N) -> String? = { null },
    private val hint: (N) -> Boolean = { false },
) {
    fun chatName(root: N, app: String): String? =
        byId(root, "$app:id/conversation_contact_name").firstNotNullOfOrNull { text(it)?.trim()?.takeIf(String::isNotEmpty) }

    /** The text in the chat's message box ("" while it only shows its hint), or null when there is no box. */
    fun boxText(root: N, app: String): String? =
        byId(root, "$app:id/entry").firstOrNull()?.let { if (hint(it)) "" else text(it).orEmpty() }

    /** The open chat, read from one root: its name and its box (empty when it has none). Null when no chat shows. */
    fun chat(root: N, app: String): ChatState? = chatName(root, app)?.let { ChatState(it, boxText(root, app).orEmpty()) }

    /** Send, only when this very screen still shows `person`'s chat with exactly `text` in its box; else null. */
    fun sendButtonFor(root: N, app: String, person: String, text: String): N? =
        if (chat(root, app)?.readyFor(person, text) == true) sendButton(root, app) else null

    fun sendButton(root: N, app: String): N? =
        byId(root, "$app:id/send").firstOrNull() ?: find(root) { describe(it).equals("send", ignoreCase = true) && !ofAnotherApp(it, app) }

    /** Whether the node has a view id of some other app (a lookalike's Send is not this app's). */
    private fun ofAnotherApp(node: N, app: String): Boolean {
        val id = idOf(node) ?: return false
        return ":id/" in id && !id.startsWith("$app:")
    }

    private fun find(node: N, depth: Int = 0, test: (N) -> Boolean): N? {
        if (test(node)) return node
        if (depth > 40) return null
        for (k in kids(node)) find(k, depth + 1, test)?.let { return it }
        return null
    }
}
