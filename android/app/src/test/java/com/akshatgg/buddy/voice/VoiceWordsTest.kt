package com.akshatgg.buddy.voice

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
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

    @Test fun theWakePhraseAndItsCasesAreTheJavaScriptsOwn() {
        val wake = root.getValue("wake").jsonObject
        val lacks = wake.getValue("lacks").jsonArray.strings().toSet()
        val phrases = wake.getValue("phrases").jsonArray.map { it.jsonObject }
        assertTrue(phrases.size >= 5)
        for (c in phrases) {
            val want = c.getValue("phrase").let { if (it is JsonNull) null else it.jsonPrimitive.content }
            assertEquals(c.str("name"), want, VoiceWords.wakePhrase(c.str("name")))
            assertEquals(c.str("name"), c.getValue("missing").jsonArray.strings(), VoiceWords.wakeMissing(c.str("name"), lacks))
            assertEquals(c.str("name"), c.getValue("all").jsonArray.strings(), VoiceWords.wakePhrases(c.str("name"), lacks))
            assertEquals(c.str("name"), c.str("nameHeard").toBoolean(), VoiceWords.wakeNameHeard(c.str("name"), lacks))
        }
        assertEquals(wake.getValue("floor").jsonPrimitive.content.toFloat(), VoiceWords.WAKE_FLOOR)
        val request = wake.getValue("request").jsonObject
        assertEquals(request.str("quietMs").toLong(), VoiceWords.REQUEST_QUIET_MS)
        assertEquals(request.str("nothingMs").toLong(), VoiceWords.REQUEST_NOTHING_MS)
        assertEquals(request.str("maxMs").toLong(), VoiceWords.REQUEST_MAX_MS)
        val froms = wake.getValue("from").jsonArray.map { it.jsonObject }
        assertTrue(froms.size >= 5)
        for (c in froms) {
            val said = c.getValue("said").jsonObject
            val words = said.getValue("result").jsonArray.map { it.jsonObject }.map {
                VoskWord(it.str("word"), it.str("conf").toFloat(), it.str("start").toFloat(), it.str("end").toFloat())
            }
            val got = VoiceWords.wakeFrom(VoskSaid(said.str("text"), words), c.getValue("phrases").jsonArray.strings(), VoiceWords.WAKE_FLOOR)
            val want = c.getValue("wake").let { if (it is JsonNull) null else it.jsonObject }
            if (want == null) assertEquals(null, got)
            else assertEquals(Wake(want.str("endSec").toFloat(), want.str("follows").toBoolean(), want.str("phrase"), want.str("startSec").toFloat()), got)
        }
        val lines = wake.getValue("lines").jsonObject
        val n = lines.str("name")
        val l = VoiceWords.WakeLines
        assertEquals(lines.str("cantListen"), l.cantListen(n))
        assertEquals(lines.str("notCaught"), l.notCaught(n, true))
        assertEquals(lines.str("sayNow"), l.sayNow(n, true))
        assertEquals(lines.str("heard"), l.HEARD)
        assertEquals(lines.str("notHeard"), l.notHeard(n, true))
        assertEquals(lines.str("privacy"), l.privacy(n, true))
        assertEquals(lines.str("label"), l.label(n, true))
        assertEquals(lines.str("tapToListen"), l.TAP_TO_LISTEN)
        assertEquals(lines.str("yes"), l.YES)
        assertEquals(lines.str("listening"), l.listening(n, true))
        val un = wake.getValue("unheard").jsonObject // the same lines when only "Hey Buddy" wakes it
        assertEquals(un.str("notCaught"), l.notCaught(" Aarav ", false))
        assertEquals(un.str("sayNow"), l.sayNow(" Aarav ", false))
        assertEquals(un.str("notHeard"), l.notHeard(" Aarav ", false))
        assertEquals(un.str("privacy"), l.privacy(" Aarav ", false))
        assertEquals(un.str("label"), l.label(" Aarav ", false))
        assertEquals(un.str("listening"), l.listening(" Aarav ", false))
        assertEquals(lines.str("gettingEars"), l.GETTING_EARS)
        assertEquals(lines.str("earsFailed"), l.EARS_FAILED)
        assertEquals(lines.str("signIn"), l.SIGN_IN)
    }

    @Test fun callingNamesWhoIsCalled() = assertEquals("Calling Priya.", VoiceWords.calling("Priya"))

    @Test fun theSpeechBubbleShowsWhatTheJavaScriptShows() {
        val b = root.getValue("bubble").jsonObject
        assertEquals(b.getValue("max").jsonPrimitive.int, VoiceWords.BUBBLE_MAX)
        assertEquals(b.getValue("hideMs").jsonPrimitive.long, VoiceWords.BUBBLE_HIDE_MS)
        assertEquals(b.str("didntCatch"), VoiceWords.DIDNT_CATCH)
        for (c in b.getValue("lines").jsonArray.map { it.jsonObject }) assertEquals(c.str("text"), c.str("shown"), VoiceWords.bubbleLine(c.str("text")))
        for (c in b.getValue("texts").jsonArray.map { it.jsonObject }) {
            val items = c.getValue("items").jsonArray.map { it.jsonObject }.map {
                fun s(k: String) = it[k]?.jsonPrimitive?.content ?: ""
                SpokenItem(s("type"), s("say"), s("text"), s("code"))
            }
            assertEquals(c.str("shown"), VoiceWords.bubbleText(items))
        }
    }
}
