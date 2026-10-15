package com.akshatgg.buddy.notify

import com.akshatgg.buddy.calls.Told
import com.akshatgg.buddy.message.Pick
import com.akshatgg.buddy.message.pickChat

/** One notification as Buddy keeps it: which app, its title (usually who), its text on one line, and when. */
data class Notif(val key: String, val app: String, val title: String, val text: String, val at: Long)

private const val MAX_TEXT = 200
private const val SHOWN = 5
private val SPACES = Regex("\\s+")
// Notification.CATEGORY_CALL, CATEGORY_TRANSPORT (music), CATEGORY_PROGRESS (downloads): not what someone said.
private val SKIPPED = setOf("call", "transport", "progress")

private fun oneLine(text: String?) = text.orEmpty().replace(SPACES, " ").trim()

/**
 * A posted notification as Buddy keeps it, or null when it is not one to tell: Buddy's own, an ongoing one (music,
 * a call, a download, charging, USB), a group's summary (its messages come on their own too), a call, music or progress
 * one, or one with nothing in it.
 */
fun notifFrom(
    key: String, pkg: String, own: String, ongoing: Boolean, summary: Boolean, category: String?,
    app: String, title: String?, text: String?, at: Long,
): Notif? {
    if (pkg == own || ongoing || summary || category in SKIPPED) return null
    val who = oneLine(title)
    val said = oneLine(text).take(MAX_TEXT)
    if (who.isEmpty() && said.isEmpty()) return null
    return Notif(key, app.trim().ifEmpty { pkg }, who, said, at)
}

/**
 * The last 50 notifications, in memory only: never written down, synced or sent anywhere, and gone when Buddy's process
 * ends. Each goes after 24 hours, or when its app takes it away. The listener adds on its thread, the chat reads on
 * another: every call holds the store's lock.
 */
class NotifStore(
    private val now: () -> Long = System::currentTimeMillis,
    private val max: Int = 50,
    private val keepMs: Long = 24 * 60 * 60_000L,
) {
    private val kept = ArrayList<Notif>()

    /** A new notification, or a new version of one kept (the same key): it takes the old one's place. */
    @Synchronized fun add(n: Notif) {
        kept.removeAll { it.key == n.key }
        kept += n
        kept.sortByDescending { it.at }
        while (kept.size > max) kept.removeAt(kept.lastIndex)
    }

    /** Its app took it away (or the person swiped it): Buddy forgets it too. */
    @Synchronized fun remove(key: String) {
        kept.removeAll { it.key == key }
    }

    @Synchronized fun clear() = kept.clear()

    /** Newest first, none older than a day. */
    @Synchronized fun recent(): List<Notif> {
        val from = now() - keepMs
        kept.removeAll { it.at < from }
        return kept.toList()
    }
}

private fun told(n: Notif) = when {
    n.title.isEmpty() -> "${n.app}: \"${n.text}\""
    n.text.isEmpty() -> "${n.title} on ${n.app}."
    else -> "${n.title} on ${n.app}: \"${n.text}\""
}

/**
 * The line Buddy says, built here on the phone: up to five, newest first; only the app they named when they named one
 * (found by the same rule as people, shared/message-pick.js).
 */
fun notifsLine(recent: List<Notif>, app: String): String {
    val asked = app.trim()
    val list = if (asked.isEmpty()) recent else {
        val wanted = when (val pick = pickChat(asked, recent.map { it.app }.distinct())) {
            is Pick.One -> setOf(pick.name)
            is Pick.Choose -> pick.names.toSet()
            Pick.None, Pick.Many -> emptySet()
        }
        recent.filter { it.app in wanted }
    }
    if (list.isEmpty()) return if (asked.isEmpty()) "No new notifications." else "No new notifications from $asked."
    return list.take(SHOWN).joinToString(" ") { told(it) }
}

/** "Who messaged me?", as the chat asks it: `app` is the app they named, or "" for all of them. */
fun interface NotifReading {
    suspend fun read(app: String): Told
}

const val NOTIFS_OFF = "Turn on Notification access for Buddy so I can read your notifications."

/**
 * "Who messaged me?": the line from the kept notifications, or how to turn Notification access on (`on`: whether
 * Android lets Buddy's listener hear them).
 */
class NotifReader(private val on: () -> Boolean, private val recent: () -> List<Notif>) : NotifReading {
    override suspend fun read(app: String): Told =
        if (!on()) Told(NOTIFS_OFF, "no_notifs") else Told(notifsLine(recent(), app))
}
