package com.akshatgg.buddy.notify

import com.akshatgg.buddy.calls.Told
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotifsTest {
    private val hour = 60 * 60_000L
    private fun n(key: String, app: String, title: String, text: String, at: Long) = Notif(key, app, title, text, at)
    private fun from(pkg: String = "com.whatsapp", ongoing: Boolean = false, summary: Boolean = false, category: String? = "msg",
                     title: String? = "Prince", text: String? = "Where are you?") =
        notifFrom("k", pkg, "com.akshatgg.buddy", ongoing, summary, category, "WhatsApp", title, text, 1L)

    @Test fun aMessageIsKeptOnOneLineAtMost200Characters() {
        assertEquals(Notif("k", "WhatsApp", "Prince", "Where are you?", 1L), from())
        assertEquals("a b", from(text = " a\n\n b ")!!.text)
        assertEquals(200, from(text = "x".repeat(300))!!.text.length)
    }
    @Test fun buddysOwnOngoingSummariesCallsMusicProgressAndEmptyOnesAreSkipped() {
        assertNull(from(pkg = "com.akshatgg.buddy"))
        assertNull(from(ongoing = true))
        assertNull(from(summary = true))
        for (category in listOf("call", "transport", "progress")) assertNull(category, from(category = category))
        assertNull(from(title = " ", text = null))
    }
    @Test fun anAppWithNoLabelIsItsPackage() {
        assertEquals("com.x", notifFrom("k", "com.x", "com.akshatgg.buddy", false, false, null, " ", "T", "t", 1L)!!.app)
    }

    @Test fun theStoreKeepsTheLast50NewestFirstFor24Hours() {
        var now = 100 * hour
        val store = NotifStore(now = { now })
        for (i in 1..55) store.add(n("k$i", "A", "t$i", "x", now - (55 - i) * 1000L))
        assertEquals(50, store.recent().size)
        assertEquals("t55", store.recent().first().title)
        now += 25 * hour
        assertEquals(emptyList<Notif>(), store.recent())
    }
    @Test fun anUpdateReplacesAndARemovalForgets() {
        val store = NotifStore(now = { 10 * hour })
        store.add(n("a", "WhatsApp", "Prince", "1 message", 1L))
        store.add(n("a", "WhatsApp", "Prince", "2 messages", 2L))
        assertEquals(listOf("2 messages"), store.recent().map { it.text })
        store.remove("a")
        assertEquals(emptyList<Notif>(), store.recent())
    }

    @Test fun theLineNamesUpToFiveNewestFirst() {
        val list = listOf(n("1", "WhatsApp", "Prince", "Where are you?", 9L), n("2", "WhatsApp", "Mom", "Call me.", 8L))
        assertEquals("Prince on WhatsApp: \"Where are you?\" Mom on WhatsApp: \"Call me.\"", notifsLine(list, ""))
        val seven = (1..7).map { n("$it", "A", "T$it", "x", (10 - it).toLong()) }
        assertEquals(5, Regex("on A:").findAll(notifsLine(seven, "")).count())
    }
    @Test fun noTitleOrNoText() {
        assertEquals("Instagram: \"New follower\"", notifsLine(listOf(n("1", "Instagram", "", "New follower", 1L)), ""))
        assertEquals("Prince on WhatsApp.", notifsLine(listOf(n("1", "WhatsApp", "Prince", "", 1L)), ""))
    }
    @Test fun onlyTheAppTheyNamed() {
        val list = listOf(n("1", "WhatsApp", "Prince", "hi", 9L), n("2", "Instagram", "", "New follower", 8L))
        assertEquals("Instagram: \"New follower\"", notifsLine(list, "instagram"))
        assertEquals("No new notifications from Gmail.", notifsLine(list, "Gmail"))
        assertEquals("No new notifications.", notifsLine(emptyList(), ""))
    }
    @Test fun theReaderSaysWhenAccessIsOff() = runTest {
        assertEquals(Told(NOTIFS_OFF, "no_notifs"), NotifReader(on = { false }, recent = { error("not read") }).read(""))
        assertEquals(Told("No new notifications."), NotifReader(on = { true }, recent = { emptyList() }).read(""))
        assertEquals("Turn on Notification access for Buddy so I can read your notifications.", NOTIFS_OFF)
    }
}
