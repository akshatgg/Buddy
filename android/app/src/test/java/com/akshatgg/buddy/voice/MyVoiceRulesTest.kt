package com.akshatgg.buddy.voice

import com.akshatgg.buddy.TestShared
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.float
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The "Only my voice" rules (shared/my-voice.js) on the phone: every case in my-voice-cases.json. */
class MyVoiceRulesTest {
    private val cases = Json.parseToJsonElement(File("src/test/resources/my-voice-cases.json").readText()).jsonObject
    private fun JsonElement.floats() = jsonArray.map { it.jsonPrimitive.float }.toFloatArray()
    private val model = cases.getValue("model").jsonObject.let { m ->
        SpeakerModelSpec(
            m.getValue("name").jsonPrimitive.content, m.getValue("file").jsonPrimitive.content, m.getValue("url").jsonPrimitive.content,
            m.getValue("sha256").jsonPrimitive.content, m.getValue("bytes").jsonPrimitive.long, m.getValue("dim").jsonPrimitive.int,
        )
    }

    @Test fun numbersMatchShared() {
        val n = cases.getValue("numbers").jsonObject
        assertEquals(n.getValue("match").jsonPrimitive.float, MyVoiceRules.MATCH)
        assertEquals(n.getValue("agree").jsonPrimitive.float, MyVoiceRules.AGREE)
        assertEquals(n.getValue("takes").jsonPrimitive.int, MyVoiceRules.TAKES)
        assertEquals(n.getValue("extraTakes").jsonPrimitive.int, MyVoiceRules.EXTRA_TAKES)
        assertEquals(n.getValue("minPhraseMs").jsonPrimitive.int, MyVoiceRules.MIN_PHRASE_MS)
        assertEquals(n.getValue("maxPhraseMs").jsonPrimitive.int, MyVoiceRules.MAX_PHRASE_MS)
        assertEquals(n.getValue("padMs").jsonPrimitive.int, MyVoiceRules.PAD_MS)
        assertEquals(n.getValue("setupMs").jsonPrimitive.long, MyVoiceRules.SETUP_MS)
        assertEquals(n.getValue("checkMs").jsonPrimitive.long, MyVoiceRules.CHECK_MS)
    }

    @Test fun isMeAsShared() {
        assertTrue(cases.getValue("isMe").jsonArray.size >= 3)
        cases.getValue("isMe").jsonArray.forEach { c ->
            val o = c.jsonObject
            assertEquals(o.toString(), o.getValue("me").jsonPrimitive.boolean, MyVoiceRules.isMe(o.getValue("profile").floats(), o.getValue("embedding").floats()))
        }
    }

    @Test fun spansAsShared() = cases.getValue("spans").jsonArray.forEach { c ->
        val o = c.jsonObject
        val want = (o["span"] as? JsonObject)?.let { Span(it.getValue("from").jsonPrimitive.int, it.getValue("to").jsonPrimitive.int) }
        assertEquals(o.toString(), want, MyVoiceRules.phraseSpan(o.getValue("startSec").jsonPrimitive.float, o.getValue("endSec").jsonPrimitive.float))
    }

    @Test fun setupsAsShared() = cases.getValue("setups").jsonArray.forEach { c ->
        val o = c.jsonObject
        val setup = Setup()
        o.getValue("takes").jsonArray.zip(o.getValue("steps").jsonArray).forEach { (take, want) ->
            val got = setup.add((take as? JsonArray)?.floats())
            assertEquals(o.toString(), want.jsonObject.getValue("step").jsonPrimitive.content, got.step)
            assertEquals(o.toString(), want.jsonObject.getValue("count").jsonPrimitive.int, got.count)
            assertEquals(want.jsonObject.containsKey("profile"), got.profile != null)
        }
    }

    @Test fun profilesAsShared() = cases.getValue("profiles").jsonArray.forEach { c ->
        val o = c.jsonObject
        val json = o["json"]?.takeIf { it !is JsonNull }?.toString()
        assertEquals(o.toString().take(200), o.getValue("ok").jsonPrimitive.boolean, MyVoiceRules.readProfile(json, model) != null)
    }

    @Test fun aProfileSurvivesBeingWrittenAndRead() {
        val p = FloatArray(model.dim).also { it[3] = 1f }
        val back = MyVoiceRules.readProfile(MyVoiceRules.profileJson(p, model.sha256, "2026-10-16T00:00:00Z"), model)
        assertNotNull(back); assertTrue(p.contentEquals(back!!))
        assertNull(MyVoiceRules.readProfile("not json", model))
    }

    @Test fun phrasesAsShared() = cases.getValue("phrases").jsonArray.forEach { c ->
        val o = c.jsonObject
        val missing = o.getValue("missing").jsonArray.map { it.jsonPrimitive.content }.toSet()
        assertEquals(o.toString(), o.getValue("phrase").jsonPrimitive.content, MyVoiceRules.setupPhrase(o.getValue("name").jsonPrimitive.content, missing))
    }

    @Test fun linesAsShared() {
        val l = cases.getValue("lines").jsonObject
        fun s(k: String) = l.getValue(k).jsonPrimitive.content
        val L = MyVoiceRules.Lines
        assertEquals(s("label"), L.LABEL); assertEquals(s("about"), L.ABOUT)
        assertEquals(s("gettingModel"), L.GETTING_MODEL); assertEquals(s("modelFailed"), L.MODEL_FAILED)
        assertEquals(s("start"), L.start("Rahul")); assertEquals(s("got"), L.got(2))
        assertEquals(s("again"), L.again("Rahul")); assertEquals(s("odd"), L.odd("Rahul"))
        assertEquals(s("done"), L.DONE); assertEquals(s("failed"), L.FAILED); assertEquals(s("timedOut"), L.TIMED_OUT)
        assertEquals(s("on"), L.ON); assertEquals(s("setUpAgain"), L.SET_UP_AGAIN)
        assertEquals(s("notYou"), L.NOT_YOU); assertEquals(s("redo"), L.REDO)
    }

    @Test fun modelSpecFromSharedJson() = assertEquals(model, TestShared.shared.speakerModel)
}
