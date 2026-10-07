package com.akshatgg.buddy.ai.providers

import com.akshatgg.buddy.FakeHttp
import com.akshatgg.buddy.TestShared
import com.akshatgg.buddy.ai.Prompt
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.net.HttpResponse
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.SocketTimeoutException

class ProvidersTest {
    private val ask = Prompt(system = "SYS", user = "hello", image = null)
    private val look = Prompt(system = "SYS", user = "check", image = "IMG")
    private fun providers(handler: (com.akshatgg.buddy.net.HttpRequest) -> HttpResponse): Pair<Providers, FakeHttp> {
        val http = FakeHttp(handler)
        return Providers(TestShared.shared, http) to http
    }
    private suspend fun error(block: suspend () -> Unit): BuddyError = try { block(); throw AssertionError("no error") } catch (e: BuddyError) { e }

    @Test fun aKeyNamesItsAi() {
        val (p, _) = providers { HttpResponse(200, "{}") }
        assertEquals("anthropic", p.forKey("sk-ant-abc"))
        assertEquals("openai", p.forKey("sk-proj-abc"))
        assertEquals("gemini", p.forKey("AIzaXYZ"))
        assertEquals("groq", p.forKey("gsk_123"))
        assertNull(p.forKey("hello"))
        assertNull(p.forKey(null))
        assertEquals(listOf("anthropic", "openai", "gemini", "groq"), p.ids)
    }

    @Test fun claudeSendsTheMessagesShapeAndReadsTheText() = runTest {
        val (p, http) = providers { HttpResponse(200, """{"model":"claude-x","content":[{"type":"text","text":" Hi "},{"type":"tool_use"}]}""") }
        val out = p.get("anthropic").complete("sk-ant-k", "claude-haiku-4-5-20251001", look, 1024)
        assertEquals("Hi", out.text); assertEquals("claude-x", out.model)
        val req = http.requests.single()
        assertEquals("https://api.anthropic.com/v1/messages", req.url)
        assertEquals("sk-ant-k", req.headers["x-api-key"]); assertEquals("2023-06-01", req.headers["anthropic-version"])
        val body = Json.parseToJsonElement(req.body!!).jsonObject
        assertEquals("SYS", body["system"].toString().trim('"'))
        assertTrue(req.body!!.contains("\"media_type\":\"image/jpeg\"") && req.body!!.contains("\"data\":\"IMG\""))
    }

    @Test fun geminiLeavesOutThoughtsAndGivesThinkingRoom() = runTest {
        val (p, http) = providers { HttpResponse(200, """{"candidates":[{"content":{"parts":[{"text":"plan","thought":true},{"text":"Answer"}]}}],"modelVersion":"gemini-2.5-flash"}""") }
        assertEquals("Answer", p.get("gemini").complete("AIzaK", "gemini-flash-latest", ask, 1024).text)
        val req = http.requests.single()
        assertEquals("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent", req.url)
        assertEquals("AIzaK", req.headers["x-goog-api-key"])
        assertTrue(req.body!!.contains("\"maxOutputTokens\":4096"))
    }

    @Test fun openAiAsksReasoningModelsToKeepItShort() = runTest {
        val (p, http) = providers { HttpResponse(200, """{"model":"gpt-5","choices":[{"message":{"content":"Done"}}]}""") }
        p.get("openai").complete("sk-k", "gpt-5", ask, 1024)
        assertTrue(http.requests.single().body!!.contains("\"reasoning_effort\":\"low\""))
        assertEquals("Bearer sk-k", http.requests.single().headers["Authorization"])
        val (g, ghttp) = providers { HttpResponse(200, """{"choices":[{"message":{"content":"Done"}}]}""") }
        g.get("groq").complete("gsk_k", "llama-3.3-70b-versatile", ask, 1024)
        assertEquals("https://api.groq.com/openai/v1/chat/completions", ghttp.requests.single().url)
        assertFalse(ghttp.requests.single().body!!.contains("reasoning_effort"))
    }

    @Test fun failuresSayWhatToDoInTheMacsWords() = runTest {
        suspend fun code(status: Int, body: String = "{}") = error { providers { HttpResponse(status, body) }.first.get("openai").complete("sk-k", "gpt-4.1", ask, 1024) }
        assertEquals("Your OpenAI key was rejected. Check it in Settings.", code(401).message)
        assertEquals("no_credit", code(429, """{"error":{"message":"You exceeded your current quota"}}""").code)
        assertEquals("OpenAI is busy right now. Try again in a minute.", code(429).message)
        assertEquals("bad_model", code(404).code)
        assertEquals("OpenAI had a problem. Try again in a moment.", code(500).message)
        val offline = error { providers { throw IOException("down") }.first.get("gemini").listModels("AIzaK") }
        assertEquals("Couldn't reach Gemini. Check your internet.", offline.message)
        val slow = error { providers { throw SocketTimeoutException() }.first.get("anthropic").listModels("sk-ant-k") }
        assertEquals("Claude took too long to answer. Try again.", slow.message)
        val empty = error { providers { HttpResponse(200, """{"content":[]}""") }.first.get("anthropic").complete("k", "m", ask, 1) }
        assertEquals("empty", empty.code)
    }

    @Test fun modelListsAreFilteredAndNewestFirst() = runTest {
        val (g, _) = providers { HttpResponse(200, """{"models":[{"name":"models/gemini-2.0-flash","supportedGenerationMethods":["generateContent"]},{"name":"models/gemini-10-pro","supportedGenerationMethods":["generateContent"]},{"name":"models/gemini-embedding-001","supportedGenerationMethods":["embedContent"]},{"name":"models/gemini-2.5-flash-image","supportedGenerationMethods":["generateContent"]}]}""") }
        assertEquals(listOf("gemini-10-pro", "gemini-2.0-flash"), g.get("gemini").listModels("AIzaK"))
        val (o, _) = providers { HttpResponse(200, """{"data":[{"id":"gpt-4.1"},{"id":"whisper-1"},{"id":"gpt-5"},{"id":"text-embedding-3"}]}""") }
        assertEquals(listOf("gpt-5", "gpt-4.1"), o.get("openai").listModels("sk-k"))
        val (p, _) = providers { HttpResponse(200, "{}") }
        assertTrue(p.get("openai").isVisionModel("gpt-4.1-mini")); assertFalse(p.get("openai").isVisionModel("o3-mini"))
        assertTrue(p.get("groq").isVisionModel("meta-llama/llama-4-scout-17b-16e-instruct")); assertFalse(p.get("groq").isVisionModel("llama-3.3-70b-versatile"))
    }
}
