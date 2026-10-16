package com.akshatgg.buddy.voice

enum class Heard { YES, NO }

/** The short list the recognizer listens for, and the words of it the model does not know. */
data class Grammar(val phrases: List<String>, val missing: List<String>)

/** Whether the result began with a wake phrase: when its last word ended (seconds), whether more was said after it, and which phrase. */
data class Wake(val endSec: Float, val follows: Boolean, val phrase: String)

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
    val YES = listOf("yes", "yeah", "haan", "okay")
    val NO = listOf("no", "nahi", "na", "cancel", "don't", "stop", "not", "mat", "nope", "nah", "wait")

    // A yes is only these words (the yes words, the card's verb and these): any other word makes it a no.
    private val FILLERS = listOf("it", "please", "ji", "now", "do", "karo", "kar", "de")

    // The fillers the on-device model knows, so they are in its grammar too ("do" and "now" are left out: too close to "don't" and "not").
    private val GRAMMAR_FILLERS = listOf("it", "please", "ji", "de")

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

    /**
     * Whether an answer the device made out must be heard by the server instead of being judged here: a word not made out
     * ([unk]) next to a yes word or the card's verb (and no no word), or any word of this card's grammar missing from the
     * model (`someMissing`). The device alone never turns such an answer into a no.
     */
    fun wantsServer(text: String, verb: String, someMissing: Boolean = false): Boolean {
        val words = wordsOf(text)
        if (UNK !in words || words.all { it == UNK }) return false
        if (words.any { it in NO }) return false
        return someMissing || words.any { it in YES || it == verb }
    }

    fun grammar(verb: String, known: Set<String>?): Grammar {
        val all = YES + verb + (if (verb == "send") BHEJ else emptyList()) + GRAMMAR_FILLERS + NO
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


    // The wake phrases ("Hey Buddy", "Hey <name>"): the device listens for them all the time.
    const val WAKE_FLOOR = 0.6f // each word of the phrase must be at least this sure
    const val REQUEST_QUIET_MS = 1_200L
    const val REQUEST_NOTHING_MS = 8_000L
    const val REQUEST_MAX_MS = 20_000L

    /** "hey " and the name: lower case, accents gone, letters and spaces only, at most 3 words. Null when no name is left. */
    fun wakePhrase(name: String): String? {
        val words = java.text.Normalizer.normalize(name.trim(), java.text.Normalizer.Form.NFD)
            .replace(Regex("[\\u0300-\\u036f]"), "")
            .lowercase()
            .replace(Regex("[^a-z]+"), " ")
            .split(' ')
            .filter { it.isNotEmpty() }
            .take(3)
        return if (words.isEmpty()) null else "hey " + words.joinToString(" ")
    }

    /**
     * The name's words the model can't hear: the phrase's words in `missing` (the shared voiceModel.missing), and any word
     * with a digit in it (the phrase is letters only). Empty when Buddy can listen for the name.
     */
    fun wakeMissing(name: String, missing: Set<String>): List<String> {
        val folded = java.text.Normalizer.normalize(name.trim(), java.text.Normalizer.Form.NFD)
            .replace(Regex("[\\u0300-\\u036f]"), "").lowercase()
        val digits = folded.split(Regex("\\s+")).filter { t -> t.any { it in '0'..'9' } }.map { it.replace(Regex("[^a-z0-9]"), "") }
        return digits + (wakePhrase(name)?.split(' ')?.filter { it in missing } ?: emptyList())
    }

    /** Every phrase that wakes Buddy: "hey <name>", "<name>" (both only when the model can hear the name), "hey buddy", "buddy". */
    fun wakePhrases(name: String, missing: Set<String>): List<String> {
        val phrase = wakePhrase(name)
        // a name that starts with "hey" is not said as "hey hey ..."
        val said = phrase?.split(' ')?.drop(1)?.dropWhile { it == "hey" }?.joinToString(" ").orEmpty()
        val named = if (said.isNotEmpty() && said != "buddy" && wakeMissing(name, missing).isEmpty()) listOf("hey $said", said) else emptyList()
        return (named + listOf("hey buddy", "buddy")).distinct()
    }

    /** Whether "Hey <name>" wakes Buddy besides "Hey Buddy": the name can be heard, and it is not Buddy itself. */
    fun wakeNameHeard(name: String, missing: Set<String>): Boolean = wakePhrases(name, missing).size > 2

    /**
     * Whether the result starts with one of the phrases: its words first, in order, each at least `floor` sure. The longest
     * phrase that matches wins ("hey rahul" over "rahul").
     */
    fun wakeFrom(said: VoskSaid, phrases: List<String>, floor: Float): Wake? {
        val got = said.words
        for (phrase in phrases.sortedByDescending { p -> p.split(' ').count { it.isNotEmpty() } }) {
            val want = phrase.split(' ').filter { it.isNotEmpty() }
            if (want.isEmpty() || got.size < want.size) continue
            if (want.indices.all { i -> got[i].word == want[i] && got[i].conf >= floor }) {
                return Wake(got[want.size - 1].end, got.size > want.size, want.joinToString(" "))
            }
        }
        return null
    }

    /**
     * What Buddy says and shows around the wake phrases; `name` is as typed in Settings and `heard` whether "Hey <name>"
     * wakes it too (wakeNameHeard), else only "Hey Buddy" is named.
     */
    object WakeLines {
        private fun calls(name: String, heard: Boolean, q: String) =
            if (heard) "${q}Hey Buddy$q or ${q}Hey ${name.trim().replace(Regex("^(?i)hey\\s+"), "")}$q" else "${q}Hey Buddy$q"
        fun cantListen(name: String) = "Buddy can't hear '${name.trim()}'. Say \"Hey Buddy\" instead, or try another spelling."
        fun notCaught(name: String, heard: Boolean) = "I didn't catch that. Say ${calls(name, heard, "'")} and try again."
        fun sayNow(name: String, heard: Boolean) = "Say ${calls(name, heard, "\"")} now."
        const val HEARD = "Heard you ✓"
        fun notHeard(name: String, heard: Boolean) = "I didn't hear ${calls(name, heard, "\"")}. Try again."
        fun privacy(name: String, heard: Boolean) = "Your microphone stays on. Nothing leaves this device until you say ${calls(name, heard, "'")}."
        fun label(name: String, heard: Boolean) = "Listen for ${calls(name, heard, "\"")}"
        const val TAP_TO_LISTEN = "Tap me to listen again"
        fun listening(name: String, heard: Boolean) = "Listening for ${calls(name, heard, "\"")}"
        const val GETTING_EARS = "Getting Buddy's ears ready (36 MB)…"
        const val EARS_FAILED = "Couldn't get Buddy's ears ready. Check the internet and try again."
        const val SPELLING_HINT = "If Test it doesn't hear you, try another spelling of the name."
        const val SIGN_IN = "Sign in to talk to Buddy."
        const val MIC_NEEDED = "Buddy needs the microphone to hear you. Allow it in Settings."
        const val STILL_BUSY = "I'm still on the last one. Ask me again in a moment."
    }

    fun calling(name: String): String = "Calling $name."
}
