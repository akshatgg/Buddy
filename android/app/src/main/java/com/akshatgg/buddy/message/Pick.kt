package com.akshatgg.buddy.message

import java.text.Normalizer

/** Who "Priya" is among the names found. A port of shared/message-pick.js, checked against pick-cases.json. */
sealed interface Pick {
    data class One(val name: String) : Pick
    data class Choose(val names: List<String>) : Pick
    data object None : Pick
    data object Many : Pick
}

private const val MAX_CHOICES = 4
private val MARKS = Regex("[\\u0300-\\u036f\\u200e\\u200f\\u202a-\\u202e]")
private val SPACES = Regex("\\s+")

private fun plain(name: String): String =
    Normalizer.normalize(name, Normalizer.Form.NFKD).replace(MARKS, "").lowercase().replace(SPACES, " ").trim()

fun sameName(a: String, b: String): Boolean = plain(a).isNotEmpty() && plain(a) == plain(b)

fun pickChat(asked: String, names: List<String>): Pick {
    val words = plain(asked).split(' ').filter { it.isNotEmpty() }
    if (words.isEmpty()) return Pick.None
    val seen = HashSet<String>()
    val found = mutableListOf<String>()
    for (name in names) {
        val key = plain(name)
        if (key in seen) continue
        val parts = key.split(' ')
        if (words.all { w -> parts.any { it.startsWith(w) } }) { seen += key; found += name }
    }
    val exact = found.filter { sameName(it, asked) }
    return when {
        exact.size == 1 -> Pick.One(exact[0])
        found.size == 1 -> Pick.One(found[0])
        found.isEmpty() -> Pick.None
        found.size > MAX_CHOICES -> Pick.Many
        else -> Pick.Choose(found)
    }
}

fun pickLine(asked: String, pick: Pick): String? = when (pick) {
    is Pick.One -> null
    Pick.None -> "I couldn't find $asked on WhatsApp."
    Pick.Many -> "I found lots of people called $asked. Tell me the full name."
    is Pick.Choose -> {
        val names = if (pick.names.size == 2) pick.names.joinToString(" or ")
        else pick.names.dropLast(1).joinToString(", ") + " or " + pick.names.last()
        "Which $asked: $names? Tell me the full name."
    }
}

/** A name as names are compared (lower case, no accents or marks, single spaces), for other WhatsApp screens. */
internal fun plainName(name: String): String = plain(name)
