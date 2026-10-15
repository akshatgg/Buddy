package com.akshatgg.buddy.voice

enum class Heard { YES, NO }

/** The short list the recognizer listens for, and the words of it the model does not know. */
data class Grammar(val phrases: List<String>, val missing: List<String>)

/** The card Buddy asks about out loud. */
sealed interface SpokenCard {
    data class Message(val name: String, val text: String) : SpokenCard
    data class Call(val name: String, val how: String) : SpokenCard // "phone", "whatsapp", "whatsapp_video"
}

/** One thing in the chat that may be spoken: a buddy line, an error or an event. */
data class SpokenItem(val type: String, val say: String = "", val text: String = "", val code: String = "")

/**
 * The words of Buddy's voice flow, a port of shared/voice-words.js (checked against voice-cases.json): what a spoken
 * answer means, what the recognizer listens for, and what Buddy says for a card and around it.
 */
object VoiceWords {
    val YES = listOf("yes", "yeah", "haan", "ha", "okay")
    val NO = listOf("no", "nahi", "na", "cancel", "don't", "stop", "not", "mat", "nope", "nah", "wait")

    // A yes is only these words (the yes words, the card's verb and these): any other word makes it a no.
    private val FILLERS = listOf("it", "please", "ji", "now", "do", "karo", "kar", "de")

    // The same word as a recognizer or Whisper may write it.
    private val BHEJ = listOf("bhej", "bhejo", "bhejdo", "bhejna", "bhejiye")
    private val SAME = mapOf("ok" to "okay", "dont" to "don't", "nahin" to "nahi", "haa" to "haan", "han" to "haan", "nope" to "no", "nah" to "no") +
        // The Hinglish ways to say "send".
        BHEJ.associateWith { "send" }
    private val DONE = Regex("^(✅|📞|📹)\\s*")
    private val NO_INTERNET_CODES = listOf("network", "timeout")

    private const val UNK = "unk" // a word the recognizer could not make out: never allowed, so never a yes
    const val SENT = "Sent."
    const val NOT_SENT = "Okay, not sent."
    const val NOT_NOW = "Okay, not now."
    const val NO_INTERNET = "I can't reach the internet right now."
    const val DIDNT_SEND = "I didn't send it."
    const val DIDNT_CALL = "I didn't call."
    const val ANSWER_MS = 8_000L
    const val UNLOCK_WAIT_MS = 60_000L
    const val MAX_FOLLOW_UPS = 2
    const val SPOKEN_MAX = 240

    /** The words said, lower case, punctuation gone, a word not made out ([unk], <unk>) kept as "unk", each as the lists write it. */
    private fun wordsOf(text: String): List<String> =
        text.lowercase()
            .replace('’', '\'').replace('‘', '\'')
            .replace(Regex("[\\[<]\\s*unk\\s*[\\]>]"), " unk ")
            .replace(Regex("[^a-z' ]+"), " ")
            .split(Regex("\\s+"))
            .map { it.trim('\'') }
            .filter { it.isNotEmpty() }
            .map { SAME[it] ?: it }

    /** Yes, no, or null when nothing decisive was said. Any other word, or any no word, is a no. */
    fun words(text: String, verb: String): Heard? {
        val words = wordsOf(text)
        if (words.isEmpty() || words.all { it == UNK }) return null // nothing made out yet
        if (words.any { it in NO }) return Heard.NO
        fun isYes(w: String) = w in YES || w == verb
        if (!words.all { isYes(it) || it in FILLERS }) return Heard.NO
        return if (words.any { isYes(it) }) Heard.YES else null
    }

    /** Anything unclear is a no. */
    fun heard(text: String, verb: String): Heard = words(text, verb) ?: Heard.NO

    fun grammar(verb: String, known: Set<String>?): Grammar {
        val all = YES + verb + (if (verb == "send") BHEJ else emptyList()) + NO
        val kept = if (known != null) all.filter { it in known } else all
        return Grammar(kept + "[unk]", all.filter { it !in kept })
    }

    fun question(card: SpokenCard): String = when (card) {
        is SpokenCard.Message -> {
            val text = card.text.trim()
            if (text.isEmpty()) "To ${card.name}. Send it?"
            else "To ${card.name}: ${if (Regex("[.!?…]$").containsMatchIn(text)) text else "$text."} Send it?"
        }
        is SpokenCard.Call -> when (card.how) {
            "whatsapp_video" -> "WhatsApp video call ${card.name}?"
            "whatsapp" -> "WhatsApp call ${card.name}?"
            else -> "Call ${card.name}?"
        }
    }

    fun spoken(items: List<SpokenItem>): List<String> {
        val out = ArrayList<String>()
        for (item in items) {
            val say = item.say.trim()
            val text = item.text.trim()
            when {
                item.type == "buddy" -> {
                    val line = say.ifEmpty { if (text.length <= SPOKEN_MAX) text else "" }
                    if (line.isNotEmpty()) out.add(line)
                }
                item.type == "error" -> out.add(if (item.code in NO_INTERNET_CODES) NO_INTERNET else text)
                item.type == "event" && DONE.containsMatchIn(text) -> out.add(text.replace(DONE, ""))
            }
        }
        return out
    }

    fun asksBack(line: String): Boolean {
        val text = line.trim()
        return text.contains('?') || text.endsWith("Tell me the full name.")
    }

    fun unlockLine(device: String, kind: String, name: String): String =
        if (device == "Mac") {
            if (kind == "call") "Unlock your Mac and I'll call $name." else "Unlock your Mac and I'll send it."
        } else {
            if (kind == "call") "Unlock your phone and I'll call $name." else "Unlock your phone and I'll send it to $name."
        }

    fun calling(name: String): String = "Calling $name."
}
