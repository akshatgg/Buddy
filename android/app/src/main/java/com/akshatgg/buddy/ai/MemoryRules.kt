package com.akshatgg.buddy.ai

import com.akshatgg.buddy.core.Shared
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * What Buddy may remember about a person, as the desktop's shared/memory-rules.js decides it: short facts such as
 * "Your boss is Mr. Sharma.", trimmed and on one line, at most maxFactChars long, and never a secret (a password,
 * passcode, PIN, OTP or CVV, or a long number such as a card's, a bank account's or an Aadhaar). A "PIN code" is kept
 * only when it is plainly the postal code in India.
 *
 * The limits and the patterns come from shared.json (memoryRules), copied there from shared/memory-rules.js, so the
 * two cannot drift apart; cleanFact here follows cleanFact there step by step.
 */
class MemoryRules(shared: Shared) {
    private val rules = shared.memoryRules
    private fun int(name: String) = rules.getValue(name).jsonPrimitive.int
    private val patterns = rules.getValue("patterns").jsonObject
    private fun pattern(name: String): Regex {
        val p = patterns.getValue(name).jsonObject
        return jsRegex(p.getValue("source").jsonPrimitive.content, p.getValue("flags").jsonPrimitive.content)
    }

    val maxFacts: Int = int("maxFacts")
    val maxFactChars: Int = int("maxFactChars")
    private val nearChars = int("nearChars")
    private val maxPhoneDigits = int("maxPhoneDigits")

    private val secretWords = pattern("secretWords")
    private val pinCode = pattern("pinCode")
    private val moneyWords = pattern("moneyWords")
    private val number = pattern("number")
    private val postalCode = pattern("postalCode")
    private val longNumber = pattern("longNumber")
    private val numberGaps = pattern("numberGaps")
    private val phone = pattern("phone")

    /** The fact trimmed and on one line, or null when it is empty, too long, or a secret. */
    fun cleanFact(text: String?): String? {
        if (text == null) return null
        val fact = text.replace(JS_SPACES, " ").trim(' ')
        if (fact.isEmpty() || fact.length > maxFactChars) return null
        if (secretWords.containsMatchIn(fact) || (pinCode.containsMatchIn(fact) && !isPostalCode(fact))) return null
        if (longNumber.containsMatchIn(withoutPhones(fact).replace(numberGaps, ""))) return null
        return fact
    }

    /** The fact without its phone numbers, which may be long but are no secret. */
    private fun withoutPhones(fact: String): String =
        phone.replace(fact) { m -> if (m.value.count { it in '0'..'9' } <= maxPhoneDigits) " " else m.value }

    /**
     * Whether the PIN code a fact names is the postal code: the fact says nothing of a card, an ATM, a bank or UPI, and
     * every number after the words is six digits; with none after them, the one just before them is ("411001 is your
     * PIN code"). A number earlier in the fact, such as an address's house number, does not matter.
     */
    private fun isPostalCode(fact: String): Boolean {
        if (moneyWords.containsMatchIn(fact)) return false
        val words = pinCode.find(fact) ?: return false
        val wordsEnd = words.range.last + 1
        val numbers = number.findAll(fact).toList()
        fun isPostal(n: MatchResult) = postalCode.containsMatchIn(n.value.replace(numberGaps, ""))
        val after = numbers.filter { it.range.first >= wordsEnd }
        if (after.isNotEmpty()) return after.all(::isPostal)
        val before = numbers.lastOrNull { val end = it.range.last + 1; end <= words.range.first && words.range.first - end <= nearChars }
        return before == null || isPostal(before)
    }

    companion object {
        /** JavaScript's \s, which the desktop folds into one space: Java's own is ASCII only. */
        private val JS_SPACES = Regex("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+")
        private const val WORD = "[A-Za-z0-9_]"

        /** JavaScript's \b: between one of its word characters (ASCII letters, digits and _) and anything else. */
        private const val BOUNDARY = "(?:(?<=$WORD)(?!$WORD)|(?<!$WORD)(?=$WORD))"

        /**
         * A JavaScript pattern as Java reads it the same way: \d is 0-9 only and \b goes by ASCII word characters, as in
         * JavaScript (Java's, and Android's ICU, see letters and digits of every script). "g" only means every match,
         * which is how each is used here; any other flag is one this does not know, and is an error.
         */
        internal fun jsRegex(source: String, flags: String): Regex {
            val options = mutableSetOf<RegexOption>()
            for (flag in flags) {
                when (flag) {
                    'i' -> options += RegexOption.IGNORE_CASE
                    'g' -> {}
                    else -> error("memoryRules: the flag $flag is not known")
                }
            }
            val out = StringBuilder()
            var inClass = false
            var i = 0
            while (i < source.length) {
                val c = source[i]
                when {
                    c == '\\' && i + 1 < source.length -> {
                        val next = source[i + 1]
                        when {
                            next == 'd' -> out.append(if (inClass) "0-9" else "[0-9]")
                            next == 'b' && !inClass -> out.append(BOUNDARY)
                            else -> out.append(c).append(next)
                        }
                        i += 2
                        continue
                    }
                    c == '[' && !inClass -> inClass = true
                    c == ']' && inClass -> inClass = false
                    // Inside a class Java reads "[" as a class within it and "&&" as "and": JavaScript reads both as themselves.
                    inClass && (c == '[' || c == '&') -> out.append('\\')
                }
                out.append(c)
                i++
            }
            return Regex(out.toString(), options)
        }
    }
}
