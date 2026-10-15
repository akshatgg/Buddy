package com.akshatgg.buddy.voice

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The words of the voice flow (shared/voice-words.js) on the phone: every case in voice-cases.json. */
class VoiceWordsTest {
    private val root = Json.parseToJsonElement(File("src/test/resources/voice-cases.json").readText()).jsonObject

    private fun cases(name: String) = root.getValue(name).jsonArray.map { it.jsonObject }
    private fun JsonObject.str(key: String) = getValue(key).jsonPrimitive.content
    private fun JsonArray.strings() = map { it.jsonPrimitive.content }
    private fun heard(s: String?) = when (s) { "yes" -> Heard.YES; "no" -> Heard.NO; else -> null }

    @Test fun everyHeardCaseMeansWhatTheJavaScriptSays() {
        assertTrue(cases("heard").size >= 20)
        for (c in cases("heard")) {
            val words = c["words"].let { if (it == null || it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals(c.str("text"), heard(words), VoiceWords.words(c.str("text"), c.str("verb")))
            assertEquals(c.str("text"), heard(c.str("answer")), VoiceWords.heard(c.str("text"), c.str("verb")))
        }
    }

    @Test fun everyWantsServerCaseMeansWhatTheJavaScriptSays() {
        assertTrue(cases("wantsServer").size >= 10)
        for (c in cases("wantsServer")) {
            val wants = c.getValue("wants").jsonPrimitive.content.toBoolean()
            val missing = c.getValue("missing").jsonPrimitive.content.toBoolean()
            assertEquals(c.str("text"), wants, VoiceWords.wantsServer(c.str("text"), c.str("verb"), missing))
        }
    }

    @Test fun laughterIsNoAndHaanIsStillYes() {
        for (said in listOf("ha", "ha ha", "ha ha ha", "ha send it")) assertEquals(said, Heard.NO, VoiceWords.heard(said, "send"))
        assertEquals(Heard.YES, VoiceWords.heard("haan", "send"))
        assertTrue("ha" !in VoiceWords.grammar("send", null).phrases)
    }

    @Test fun everyGrammarCaseListsTheSameWords() {
        for (c in cases("grammar")) {
            val known = c["known"].let { if (it == null || it is JsonNull) null else it.jsonArray.strings().toSet() }
            val g = VoiceWords.grammar(c.str("verb"), known)
            assertEquals(c.getValue("grammar").jsonArray.strings(), g.phrases)
            assertEquals(c.getValue("missing").jsonArray.strings(), g.missing)
        }
    }

    @Test fun everyQuestionIsAskedAsTheJavaScriptAsksIt() {
        for (c in cases("questions")) {
            val card = c.getValue("card").jsonObject
            val spoken = if (card.str("kind") == "message") SpokenCard.Message(card.str("name"), card.str("text"))
            else SpokenCard.Call(card.str("name"), card.str("how"))
            assertEquals(c.str("said"), VoiceWords.question(spoken))
        }
    }

    @Test fun everyLineIsSpokenAsTheJavaScriptSpeaksIt() {
        for (c in cases("lines")) {
            val items = c.getValue("items").jsonArray.map { it.jsonObject }.map {
                fun s(k: String) = it[k]?.jsonPrimitive?.content ?: ""
                SpokenItem(s("type"), s("say"), s("text"), s("code"))
            }
            assertEquals(c.getValue("said").jsonArray.strings(), VoiceWords.spoken(items))
        }
    }

    @Test fun everyLineThatAsksIsFound() {
        for (c in cases("asksBack")) assertEquals(c.str("line"), c.getValue("asks").jsonPrimitive.content.toBoolean(), VoiceWords.asksBack(c.str("line")))
    }

    @Test fun everyUnlockLineIsSaidAsTheJavaScriptSaysIt() {
        for (c in cases("unlock")) assertEquals(c.str("said"), VoiceWords.unlockLine(c.str("device"), c.str("kind"), c.str("name")))
    }

    @Test fun callingNamesWhoIsCalled() = assertEquals("Calling Priya.", VoiceWords.calling("Priya"))
}
