package com.akshatgg.buddy.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/** The Vosk model is loaded once for the whole process, not for each question. */
class SharedSpottersTest {
    private class Loaded : LoadedSpotters {
        var closed = false
        override fun make(grammar: List<String>): Spotter = throw UnsupportedOperationException()
        override fun close() { closed = true }
    }

    private var loads = 0
    private val made = ArrayList<Loaded>()
    private var ready = true
    private var generation = 0

    private fun shared() = SharedSpotters(ready = { ready }, generation = { generation }, load = { loads++; Loaded().also { made += it } })

    @Test fun tenQuestionsLoadTheModelOnce() {
        val s = shared()
        val first = s.get()
        repeat(9) { assertSame(first, s.get()) }
        assertEquals(1, loads)
    }

    @Test fun nothingIsLoadedUntilTheModelIsReady() {
        val s = shared()
        ready = false
        assertNull(s.get())
        assertEquals(0, loads)
        ready = true
        assertNotNull(s.get())
        assertEquals(1, loads)
    }

    @Test fun warmingLoadsItAheadAndTheQuestionReusesIt() {
        val s = shared()
        s.warm()
        s.get()
        assertEquals(1, loads)
    }

    @Test fun aReplacedModelFolderClosesTheOldModelAndLoadsTheNew() {
        val s = shared()
        s.get()
        generation++
        s.get()
        s.get()
        assertEquals(2, loads)
        assertEquals(listOf(true, false), made.map { it.closed })
    }

    @Test fun aLoadThatFailsIsTriedAgainNextTime() {
        var fail = true
        var count = 0
        val s = SharedSpotters({ true }, { 0 }, { count++; if (fail) throw IllegalStateException("model") else Loaded() })
        try { s.get() } catch (_: IllegalStateException) {}
        fail = false
        assertNotNull(s.get())
        assertEquals(2, count)
    }
}
