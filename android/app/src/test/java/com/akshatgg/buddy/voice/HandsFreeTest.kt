package com.akshatgg.buddy.voice

import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class HandsFreeTest {
    private val log = ArrayList<String>()
    private val said = ArrayList<String>()
    private var transcribed: suspend (ByteArray, String) -> String = { _, _ -> "call Mom" }

    private val chat = object : SpokenChat {
        override fun open() { log += "open" }
        override fun hidden() { log += "hidden" }
        override fun sendSpoken(text: String) { log += "send $text" }
        override var busy = false
    }
    private val talk = object : TalkBack {
        override suspend fun say(text: String) { said += text }
        override suspend fun hear(verb: String) = Heard.NO
        override suspend fun listen(): String? = null
        override fun stop() {}
    }
    private val shown = ArrayList<String>()

    private fun handsFree() = HandsFree(chat, talk, { audio, mime -> transcribed(audio, mime) }, { "Rahul" }, { shown += it })

    @Test fun noRecordingStaysSilent() = runTest {
        handsFree().request(null)
        handsFree().request(ByteArray(0))
        assertEquals(emptyList<String>(), said)
        assertEquals(emptyList<String>(), shown)
        assertEquals(emptyList<String>(), log)
    }

    @Test fun nothingWrittenDownByTheServerStaysSilent() = runTest {
        transcribed = { _, _ -> "  " }
        handsFree().request(ByteArray(10))
        assertEquals(emptyList<String>(), said)
        assertEquals(emptyList<String>(), shown)
        assertEquals(emptyList<String>(), log)
    }

    @Test fun noInternetSaysSo() = runTest {
        transcribed = { _, _ -> throw BuddyError("network", "x") }
        handsFree().request(ByteArray(10))
        transcribed = { _, _ -> throw BuddyError("timeout", "x") }
        handsFree().request(ByteArray(10))
        assertEquals(listOf(VoiceWords.NO_INTERNET, VoiceWords.NO_INTERNET), said)
        assertEquals(emptyList<String>(), log)
    }

    @Test fun anotherErrorSaysItsMessage() = runTest {
        transcribed = { _, _ -> throw BuddyError("rate_limited", "Too many tries. Wait a minute.") }
        handsFree().request(ByteArray(10))
        assertEquals(listOf("Too many tries. Wait a minute."), said)
        assertEquals(emptyList<String>(), log)
    }

    @Test fun aRequestWhileTheChatIsBusyIsNotWrittenDownAndSaysSo() = runTest {
        chat.busy = true
        var sent = 0
        transcribed = { _, _ -> sent++; "call Mom" }
        handsFree().request(ByteArray(10))
        val line = "I'm still on the last one. Ask me again in a moment."
        assertEquals(listOf(line), said)
        assertEquals(listOf(line), shown)
        assertEquals(0, sent)
        assertEquals(emptyList<String>(), log)
    }

    @Test fun wordsGoToTheChatOnce() = runTest {
        handsFree().request(ByteArray(10))
        assertEquals(listOf("open", "hidden", "send call Mom"), log)
        assertEquals(emptyList<String>(), said)
    }

    @Test fun aSecondRequestOpensTheChatAgainSoItCanResume() = runTest {
        val h = handsFree()
        h.request(ByteArray(10))
        transcribed = { _, _ -> "Priya Sharma" }
        h.request(ByteArray(10))
        assertEquals(listOf("open", "hidden", "send call Mom", "open", "hidden", "send Priya Sharma"), log)
    }
}
