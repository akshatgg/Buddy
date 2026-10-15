package com.akshatgg.buddy.calls

import com.akshatgg.buddy.message.WhatsAppScreen
import com.akshatgg.buddy.message.plainName
import com.akshatgg.buddy.message.sameName

/**
 * WhatsApp's own "Call …?" question, after the call button: not there, answered for this person, about someone else,
 * this person's but its Call is not there or did not take the press, or this person's and left as it is (Buddy has
 * answered it once already: never twice).
 */
enum class Confirm { NONE, PRESSED, OTHER, NOT_PRESSED, ASKING }

// The open chat's call buttons. Not yet read on the owner's phone (Task 6 Step 1, checked in Task 11): the id lists
// stay empty until then, and the buttons are found by their descriptions. Ids are suffixes under the app's package.
internal val VOICE_CALL_IDS: List<String> = listOf()
internal val VIDEO_CALL_IDS: List<String> = listOf()
private val VOICE_CALL_DESCRIPTIONS = listOf("Voice call", "Audio call")
private val VIDEO_CALL_DESCRIPTIONS = listOf("Video call")
// WhatsApp's question is an Android dialog: its text and its "Call" button (expected; checked on the device).
private const val QUESTION_ID = "android:id/message"
private const val YES_ID = "android:id/button1"

/**
 * Where the call controls are on WhatsApp's chat screen, found by id or description, and WhatsApp's own question
 * before a call. Generic over the node, like WhatsAppScreen, so that it is tested without Android.
 */
class WhatsAppCallScreen<N>(
    private val chat: WhatsAppScreen<N>,
    private val byId: (N, String) -> List<N>,
    private val text: (N) -> String?,
    private val describe: (N) -> String?,
    private val kids: (N) -> List<N>,
    private val voiceIds: List<String> = VOICE_CALL_IDS,
    private val videoIds: List<String> = VIDEO_CALL_IDS,
    private val idOf: (N) -> String? = { null },
    private val kind: (N) -> String? = { null },
) {
    /** The voice or video call button, only when this very screen shows `person`'s chat; else null. */
    fun callButtonFor(root: N, app: String, person: String, video: Boolean): N? {
        val name = chat.chatName(root, app) ?: return null
        if (!sameName(name, person)) return null
        (if (video) videoIds else voiceIds).firstNotNullOfOrNull { byId(root, "$app:id/$it").firstOrNull() }?.let { return it }
        val wanted = if (video) VIDEO_CALL_DESCRIPTIONS else VOICE_CALL_DESCRIPTIONS
        return find(root, skip = { isList(it, app) }) { n ->
            !ofAnotherApp(n, app) && wanted.any { describe(n)?.trim().equals(it, ignoreCase = true) }
        }
    }

    /** Whether WhatsApp is asking something (a dialog's text is on the screen). */
    fun asks(root: N): Boolean = question(root) != null

    /** The question's Call button when the question names `person` (their whole name); else null. */
    fun confirmButtonFor(root: N, person: String): N? {
        val asked = question(root) ?: return null
        if (!names(asked, person)) return null
        return byId(root, YES_ID).firstOrNull()
    }

    /**
     * WhatsApp's question on this screen, for `person`: its Call pressed (with `click`) only when `press`, that is the
     * first time Buddy sees it; after that, left as it is (ASKING). A question naming them with no Call, or whose Call
     * did not take the press, is NOT_PRESSED; one naming someone else is OTHER; none is NONE.
     */
    fun answer(root: N, person: String, press: Boolean, click: (N) -> Boolean): Confirm {
        val asked = question(root) ?: return Confirm.NONE
        if (!names(asked, person)) return Confirm.OTHER
        val yes = byId(root, YES_ID).firstOrNull() ?: return Confirm.NOT_PRESSED
        if (!press) return Confirm.ASKING
        return if (click(yes)) Confirm.PRESSED else Confirm.NOT_PRESSED
    }

    private fun question(root: N): String? = byId(root, QUESTION_ID).firstNotNullOfOrNull { text(it)?.takeIf(String::isNotBlank) }

    /**
     * Whether `said` holds `person`'s whole name as words of its own: not inside another word, and not only the start
     * of a longer name ("Prince" is not named by "Prince Sharma?", nor "Prince Sharma" by "Prince Sharma 2?").
     */
    private fun names(said: String, person: String): Boolean {
        val text = plainName(said)
        val name = plainName(person)
        if (name.isEmpty()) return false
        var at = text.indexOf(name)
        while (at >= 0) {
            val before = at == 0 || !text[at - 1].isLetterOrDigit()
            val after = text.getOrNull(at + name.length)
            val next = text.getOrNull(at + name.length + 1)
            val ends = after == null || !after.isLetterOrDigit() && !(after == ' ' && next?.isLetterOrDigit() == true)
            if (before && ends) return true
            at = text.indexOf(name, at + 1)
        }
        return false
    }

    /** Whether the node has a view id of some other app (a lookalike's button is not this app's). */
    private fun ofAnotherApp(node: N, app: String): Boolean {
        val id = idOf(node) ?: return false
        return ":id/" in id && !id.startsWith("$app:")
    }

    /**
     * Whether the node is the chat's list of messages (by its id, or any list's class): WhatsApp's own call-log bubbles
     * there say "Voice call" / "Video call" too, so the buttons are looked for outside it, in the toolbar.
     */
    private fun isList(node: N, app: String): Boolean {
        val id = idOf(node)
        if (id == "$app:id/conversation" || id == "android:id/list") return true
        val cls = kind(node) ?: return false
        return cls.endsWith("RecyclerView") || cls.endsWith("ListView")
    }

    private fun find(node: N, depth: Int = 0, skip: (N) -> Boolean, test: (N) -> Boolean): N? {
        if (skip(node)) return null
        if (test(node)) return node
        if (depth > 40) return null
        for (k in kids(node)) find(k, depth + 1, skip, test)?.let { return it }
        return null
    }
}
