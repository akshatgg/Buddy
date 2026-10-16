package com.akshatgg.buddy.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoiceRankTest {
    private fun v(name: String, lang: String, q: Int = VoiceRank.NORMAL, local: Boolean = true, features: Set<String> = emptySet()) =
        VoiceInfo(name, lang, q, network = !local, features = features)

    @Test fun `india beats us beats gb beats other english`() {
        val all = listOf(v("de", "de-DE", VoiceRank.VERY_HIGH), v("au", "en-AU"), v("gb", "en-GB"), v("us", "en-US"), v("in", "en-IN"))
        assertEquals(listOf("in", "us", "gb", "au"), VoiceRank.ranked(all).map { it.name })
        assertEquals("in", VoiceRank.best(all))
    }

    @Test fun `within a language higher quality first then local before network`() {
        val all = listOf(
            v("net-high", "en-US", VoiceRank.HIGH, local = false),
            v("local-high", "en-US", VoiceRank.HIGH),
            v("normal", "en-US", VoiceRank.NORMAL),
            v("very-high", "en-US", VoiceRank.VERY_HIGH),
        )
        assertEquals(listOf("very-high", "local-high", "net-high", "normal"), VoiceRank.ranked(all).map { it.name })
    }

    @Test fun `voices not installed are skipped`() {
        val all = listOf(v("gone", "en-IN", VoiceRank.VERY_HIGH, features = setOf("notInstalled")), v("here", "en-US"))
        assertEquals(listOf("here"), VoiceRank.ranked(all).map { it.name })
    }

    @Test fun `underscore locales and case are understood`() {
        assertEquals("a", VoiceRank.best(listOf(v("b", "en_US"), v("a", "EN_in"))))
    }

    @Test fun `no english voice gives null`() {
        assertNull(VoiceRank.best(listOf(v("de", "de-DE"))))
        assertNull(VoiceRank.best(emptyList()))
    }

    @Test fun `a chosen voice that is gone falls back to automatic`() {
        val all = listOf(v("in", "en-IN"), v("us", "en-US"))
        assertEquals("us", VoiceRank.resolve("us", all))
        assertEquals("in", VoiceRank.resolve("old", all))
        assertEquals("in", VoiceRank.resolve(null, all))
    }

    @Test fun `labels say the region and number the voices of a region`() {
        val all = listOf(v("a", "en-IN", VoiceRank.HIGH), v("b", "en-IN"), v("c", "en-US", local = false))
        assertEquals(listOf("India 1 (High quality)", "India 2", "US 1 (needs internet)"), VoiceRank.labels(VoiceRank.ranked(all)))
    }
}
