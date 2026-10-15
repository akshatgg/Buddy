package com.akshatgg.buddy.message

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
) {
    fun chatName(root: N, app: String): String? =
        byId(root, "$app:id/conversation_contact_name").firstNotNullOfOrNull { text(it)?.trim()?.takeIf(String::isNotEmpty) }

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
