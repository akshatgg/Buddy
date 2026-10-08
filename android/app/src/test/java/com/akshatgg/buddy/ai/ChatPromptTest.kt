package com.akshatgg.buddy.ai

import com.akshatgg.buddy.TestShared
import com.akshatgg.buddy.core.BuddyError
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** The chat request (shared/prompts.js chatPrompt and parseChat) on the phone: test/prompts.test.js's cases, and chat-cases.json. */
class ChatPromptTest {
    private val prompts = Prompts(TestShared.shared)
    private val cases = Json.parseToJsonElement(File("src/test/resources/chat-cases.json").readText()).jsonObject

    private fun chat(input: AskInput) = prompts.build(Action.CHAT, input)

    private fun refused(input: AskInput): BuddyError = assertThrows(BuddyError::class.java) { chat(input) }

    private fun reply(
        kind: String, say: String = "", text: String = "", notes: List<String> = emptyList(), doIt: Boolean = false,
        send: Boolean = false, remember: List<String> = emptyList(), again: Boolean = false,
    ) = ChatReply(kind, say, text, notes, doIt, send, remember, again)

    private fun answerOf(kind: String, text: String = "", say: String = "", again: Any = false) =
        """{"kind":"$kind","say":"$say","text":"$text","notes":[],"doIt":false,"send":false,"remember":[],"again":$again}"""

    // ---- every case the JavaScript answered ----

    private fun inputOf(j: JsonObject): AskInput {
        fun string(name: String) = j[name]?.jsonPrimitive?.content
        return AskInput(
            message = string("message"),
            selection = string("selection"),
            box = string("box"),
            image = string("image"),
            history = j["history"]?.jsonArray?.map { ChatTurn(it.jsonObject.getValue("from").jsonPrimitive.content, it.jsonObject.getValue("text").jsonPrimitive.content) },
            facts = j["facts"]?.jsonArray?.map { it.jsonPrimitive.content },
            appName = string("appName"),
            userName = string("userName"),
            step = j["step"]?.jsonPrimitive?.int,
        )
    }

    @Test fun everyChatPromptCaseIsBuiltAsTheJavaScriptBuildsIt() {
        val all = cases.getValue("prompts").jsonArray
        assertTrue(all.size >= 20)
        for (case in all.map { it.jsonObject }) {
            val input = inputOf(case.getValue("input").jsonObject)
            val error = case["error"]?.jsonObject
            if (error != null) {
                val e = refused(input)
                assertEquals(case.toString().take(200), error.getValue("code").jsonPrimitive.content, e.code)
                assertEquals(error.getValue("message").jsonPrimitive.content, e.message)
            } else {
                val p = chat(input)
                assertEquals(TestShared.shared.chatSystem, p.system)
                assertEquals(case.toString().take(200), case.getValue("user").jsonPrimitive.content, p.user)
                assertEquals(case.getValue("image").let { if (it is JsonNull) null else it.jsonPrimitive.content }, p.image)
            }
        }
    }

    @Test fun everyParseChatCaseIsReadAsTheJavaScriptReadsIt() {
        val all = cases.getValue("replies").jsonArray
        assertTrue(all.size >= 20)
        for (case in all.map { it.jsonObject }) {
            val raw = case.getValue("raw").jsonPrimitive.content
            val r = case.getValue("reply").jsonObject
            fun list(name: String) = (r.getValue(name) as JsonArray).map { it.jsonPrimitive.content }
            val expected = ChatReply(
                kind = r.getValue("kind").jsonPrimitive.content,
                say = r.getValue("say").jsonPrimitive.content,
                text = r.getValue("text").jsonPrimitive.content,
                notes = list("notes"),
                doIt = r.getValue("doIt").jsonPrimitive.boolean,
                send = r.getValue("send").jsonPrimitive.boolean,
                remember = list("remember"),
                again = r.getValue("again").jsonPrimitive.boolean,
            )
            assertEquals(raw.take(200), expected, prompts.parseChat(raw))
        }
    }

    // ---- test/prompts.test.js, chat ----

    @Test fun theMessageIsTheUserTurnTrimmedWithNoImage() {
        val p = chat(AskInput(message = "  boss ko mail, kal chutti chahiye  "))
        assertTrue(p.user.contains("Their message:\n\"\"\"\nboss ko mail, kal chutti chahiye\n\"\"\""))
        assertNull(p.image)
        for (label in listOf("Selected text:", "Their text box:", "Chat so far", "What you know about them:", "The app they are in:", "Their first name:", "second step")) {
            assertFalse(label, p.user.contains(label))
        }
    }

    @Test fun aMessageIsNeededAndAtMost1000Characters() {
        for (message in listOf(null, "", "   ")) {
            val e = refused(AskInput(message = message))
            assertEquals("bad_request", e.code)
            assertEquals("Tell me what to do first.", e.message)
        }
        chat(AskInput(message = "a".repeat(1000)))
        assertEquals("That is too long (over 1000 characters). Try a shorter one.", refused(AskInput(message = "a".repeat(1001))).message)
    }

    @Test fun everythingGivenReachesTheUserPromptUnderItsOwnLabelAndTheMessageComesLast() {
        val p = chat(
            AskInput(
                message = "fix this", selection = "  i am go to office  ", box = "Dear sir, i will not come tomorow.",
                history = listOf(ChatTurn("you", "hi"), ChatTurn("buddy", "Hi Akshat! What should we do?")),
                facts = listOf("Your boss is Mr. Sharma.", "You work at Infosys."), appName = "Gmail", userName = "Akshat", step = 2,
            ),
        )
        assertTrue(p.user.contains("Selected text:\n\"\"\"\ni am go to office\n\"\"\""))
        assertTrue(p.user.contains("Their text box:\n\"\"\"\nDear sir, i will not come tomorow.\n\"\"\""))
        assertTrue(p.user.contains("Chat so far (oldest first):\nThem: hi\nBuddy: Hi Akshat! What should we do?"))
        assertTrue(p.user.contains("What you know about them:\n- Your boss is Mr. Sharma.\n- You work at Infosys."))
        assertTrue(p.user.contains("The app they are in: Gmail\nTheir first name: Akshat"))
        assertTrue(p.user.contains("This is the second step"))
        assertTrue(p.user.endsWith("Their message:\n\"\"\"\nfix this\n\"\"\""))
    }

    @Test fun theScreenshotGoesAlongOnTheSecondStepOnly() {
        val p = chat(AskInput(message = "what does this mean?", image = "IMG", appName = "Chrome", step = 2))
        assertEquals("IMG", p.image)
        assertTrue(p.user.contains("A screenshot of the app they are in comes with this message."))
        assertEquals("That screenshot is too big.", refused(AskInput(message = "hi", image = "a".repeat(2_800_001), step = 2)).message)
        for (step in listOf(null, 1, 3)) {
            assertEquals("That can only come with the second step.", refused(AskInput(message = "x", image = "IMG", step = step)).message)
            assertEquals("That can only come with the second step.", refused(AskInput(message = "x", box = "i am go", step = step)).message)
            assertFalse(chat(AskInput(message = "hi", step = step)).user.contains("second step"))
        }
        chat(AskInput(message = "hi", box = "   ", image = "", step = 1)) // blank is nothing, and is not refused
    }

    @Test fun aSelectionOrABoxOver8000IsRefusedAndBlankOnesAreLeftOut() {
        chat(AskInput(message = "fix", selection = "a".repeat(8000), box = "b".repeat(8000), step = 2))
        val tooLong = "That is too long (over 8000 characters). Try a shorter one."
        assertEquals(tooLong, refused(AskInput(message = "fix", selection = "a".repeat(8001))).message)
        assertEquals(tooLong, refused(AskInput(message = "fix", box = "a".repeat(8001), step = 2)).message)
        assertFalse(chat(AskInput(message = "fix", selection = "   ")).user.contains("Selected text:"))
    }

    @Test fun theLastSixChatMessagesAreKeptEachCutTo2000() {
        val history = listOf(
            ChatTurn("you", "one"), ChatTurn("buddy", "two"), ChatTurn("someone", "four"), ChatTurn("you", "  "),
            ChatTurn("buddy", "five"), ChatTurn("you", "six"), ChatTurn("buddy", "seven"), ChatTurn("you", "eight"),
            ChatTurn("buddy", "nine " + "x".repeat(3000)),
        )
        val lines = chat(AskInput(message = "hi", history = history)).user.split("Chat so far (oldest first):\n")[1].split("\n\n")[0].split("\n")
        assertEquals(listOf("Buddy: two", "Buddy: five", "Them: six", "Buddy: seven", "Them: eight"), lines.take(5))
        assertEquals("Buddy: nine " + "x".repeat(2000 - 5), lines[5])
        assertEquals(6, lines.size)
    }

    @Test fun atMost50FactsTheNewestEachOnOneLineCutTo200() {
        val facts = (0 until 60).map { "Fact $it." } + listOf("  ", "Long\n" + "y".repeat(300))
        val known = chat(AskInput(message = "hi", facts = facts)).user.split("What you know about them:\n")[1].split("\n\n")[0].split("\n")
        assertEquals(50, known.size)
        assertEquals("- Fact 11.", known.first())
        assertEquals("- Long " + "y".repeat(195), known.last())
    }

    @Test fun theAppAndTheNameAreCutTo100OnOneLine() {
        val user = chat(AskInput(message = "hi", appName = "Google\nChrome " + "c".repeat(200), userName = " " + "n".repeat(150) + " ")).user
        assertTrue(user.contains("The app they are in: Google Chrome " + "c".repeat(86) + "\n"))
        assertTrue(user.contains("Their first name: " + "n".repeat(100) + "\n"))
    }

    @Test fun theSystemPromptIsTheDesktopsAndAsksForTheJson() {
        val system = chat(AskInput(message = "hi")).system
        assertTrue(system.startsWith("You are Buddy"))
        assertTrue(system.contains("JSON only"))
        assertTrue(system.contains("all eight fields"))
        assertEquals(listOf("write", "fix", "answer", "box", "screen", "send", "code"), TestShared.shared.chatKinds)
    }

    // ---- test/prompts.test.js, parseChat ----

    @Test fun parseChatReadsEachKind() {
        for (kind in TestShared.shared.chatKinds) {
            assertEquals(kind, reply(kind, say = "Here you go.", text = "Some text"), prompts.parseChat(answerOf(kind, "Some text", "Here you go.")))
        }
    }

    @Test fun parseChatReadsAFullAnswerWithOrWithoutFences() {
        val json = """{"kind":"fix","say":"Theek kar diya!","text":"I am going.","notes":["one"],"doIt":true,"send":true,"remember":["You work in an office."],"again":true}"""
        val full = reply("fix", "Theek kar diya!", "I am going.", listOf("one"), doIt = true, send = true, remember = listOf("You work in an office."), again = true)
        assertEquals(full, prompts.parseChat(json))
        assertEquals(full, prompts.parseChat("```json\n$json\n```"))
        assertEquals(full, prompts.parseChat("```\n$json\n```"))
    }

    @Test fun parseChatTakesAnythingElseAsAWrittenAnswerWithTheRawText() {
        assertEquals(reply("write", text = "Dear Sir,\nI will be on leave."), prompts.parseChat("  Dear Sir,\nI will be on leave.  "))
        for (raw in listOf("[1, 2]", "\"just a string\"", "42", "null", "{\"say\": \"no kind\"}", "{\"kind\": \"toString\"}", "{", "```")) {
            assertEquals(raw, reply("write", text = raw), prompts.parseChat(raw))
        }
        assertEquals(reply("write"), prompts.parseChat(null))
    }

    @Test fun parseChatReadsJsonWithWordsAroundItOrRawLineBreaks() {
        val expected = reply("write", "Ye lo.", "Dear Sir,\nI need leave.", doIt = true)
        assertEquals(expected, prompts.parseChat("{\"kind\":\"write\",\"say\":\"Ye lo.\",\"text\":\"Dear Sir,\nI need leave.\",\"doIt\":true}"))
        assertEquals(expected, prompts.parseChat("Here:\n{\"kind\":\"write\",\"say\":\"Ye lo.\",\"text\":\"Dear Sir,\\nI need leave.\",\"doIt\":true}\nHope it helps!"))
    }

    @Test fun parseChatTakesAnAnswersSayAsItsTextAndCapsTheLists() {
        assertEquals(reply("answer", text = "Kal ka matlab tomorrow hai."), prompts.parseChat("{\"kind\":\"answer\",\"say\":\"Kal ka matlab tomorrow hai.\"}"))
        val r = prompts.parseChat(
            """{"kind":"fix","say":7,"text":["no"],"notes":["1",2,"  ","3","4","5","6","7"],"doIt":"yes","send":1,"remember":["A",null,"B","C","D","E","F","${"z".repeat(201)}"],"again":"yes"}""",
        )
        assertEquals(reply("fix", notes = listOf("1", "3", "4", "5", "6"), remember = listOf("A", "B", "C", "D", "E")), r)
    }

    @Test fun parseChatSaysAgainOnlyForWrittenOrFixedTextAndCodeNeverDoesIt() {
        assertTrue(prompts.parseChat(answerOf("write", "x", again = true)).again)
        assertTrue(prompts.parseChat(answerOf("fix", "x", again = true)).again)
        for (kind in listOf("answer", "box", "screen", "send")) assertFalse(prompts.parseChat(answerOf(kind, "x", again = true)).again)
        assertFalse(prompts.parseChat(answerOf("write", "x", again = "\"true\"")).again)
        val code = prompts.parseChat("""{"kind":"code","say":"On it!","text":"Fix the bug.","notes":["x"],"doIt":true,"send":true,"again":true}""")
        assertEquals(reply("code", "On it!", "Fix the bug."), code)
    }
}
