package com.akshatgg.buddy.message

/**
 * What Buddy says when "Prince" or "YouTube" is not one contact or one app. A port of shared/pick-lines.js, checked
 * against line-cases.json.
 */
fun contactLine(asked: String, pick: Pick): String? =
    if (pick == Pick.None) "I couldn't find $asked in your contacts." else pickLine(asked, pick)

fun appLine(asked: String, pick: Pick, where: String): String? = when (pick) {
    is Pick.One -> null
    Pick.None -> "I couldn't find $asked on this $where."
    Pick.Many -> "I found lots of apps called $asked. Tell me the full name."
    is Pick.Choose -> {
        val names = if (pick.names.size == 2) pick.names.joinToString(" or ")
        else pick.names.dropLast(1).joinToString(", ") + " or " + pick.names.last()
        "Which one: $names?"
    }
}
