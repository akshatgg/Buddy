package com.akshatgg.buddy.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

/** The embedder is loaded once for the whole process, not for each check. */
class SharedEmbedderTest {
    private class Loaded : Embedder, AutoCloseable {
        var closed = false
        override fun embed(pcm: ShortArray): FloatArray? = null
        override fun close() { closed = true }
    }

    private var loads = 0
    private val made = ArrayList<Loaded>()
    private var ready = true
    private var generation = 0

    private fun shared() = SharedEmbedder({ ready }, { generation }, { loads++; Loaded().also { made += it } })

    @Test fun manyChecksLoadItOnce() {
        val s = shared()
        val first = s.get()
        repeat(9) { assertSame(first, s.get()) }
        assertEquals(1, loads)
    }

    @Test fun nothingIsLoadedWhileTheModelIsNotThere() {
        val s = shared()
        ready = false
        assertNull(s.get())
        assertEquals(0, loads)
        ready = true
        assertNotNull(s.get())
        assertEquals(1, loads)
    }

    @Test fun aReplacedFileClosesTheOldEmbedderAndLoadsTheNew() {
        val s = shared()
        s.get()
        generation++
        s.get(); s.get()
        assertEquals(2, loads)
        assertEquals(listOf(true, false), made.map { it.closed })
    }

    @Test fun warmingLoadsAheadAndCloseClosesIt() {
        val s = shared()
        s.warm(); s.get()
        assertEquals(1, loads)
        s.close()
        assertEquals(listOf(true), made.map { it.closed })
    }

    @Test fun aLoadThatFailsIsTriedAgainNextTime() {
        var fail = true
        var count = 0
        val s = SharedEmbedder({ true }, { 0 }, { count++; if (fail) throw IllegalStateException("model") else Loaded() })
        try { s.get() } catch (_: IllegalStateException) {}
        s.warm() // a failing warm-up is swallowed
        fail = false
        assertNotNull(s.get())
        assertEquals(3, count)
    }
}
