package com.akshatgg.buddy.ai

import com.akshatgg.buddy.TestShared
import com.akshatgg.buddy.core.BuddyError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PromptsTest {
    private val prompts = Prompts(TestShared.shared)

    @Test fun writeUsesTheToneAndTrimsTheInstruction() {
        val p = prompts.build(Action.WRITE, AskInput(instruction = "  boss ko mail  ", tone = "friendly"))
        assertEquals(TestShared.shared.writeSystem["friendly"], p.system)
        assertEquals("boss ko mail", p.user)
        assertNull(p.image)
    }

    @Test fun anUnknownToneIsFormal() {
        val p = prompts.build(Action.WRITE, AskInput(instruction = "x", tone = "constructor"))
        assertEquals(TestShared.shared.writeSystem["formal"], p.system)
    }

    @Test fun emptyAndTooLongAreRefusedInTheMacsWords() {
        val e = assertThrows(BuddyError::class.java) { prompts.build(Action.WRITE, AskInput(instruction = "  ")) }
        assertEquals("bad_request", e.code)
        assertEquals("Tell me what to write first.", e.message)
        val long = assertThrows(BuddyError::class.java) { prompts.build(Action.FIX, AskInput(text = "x".repeat(8001))) }
        assertEquals("That is too long (over 8000 characters). Try a shorter one.", long.message)
        assertEquals("Select or paste the text to fix first.", assertThrows(BuddyError::class.java) { prompts.build(Action.FIX, AskInput()) }.message)
        assertEquals("Take a screenshot first.", assertThrows(BuddyError::class.java) { prompts.build(Action.CHECK, AskInput()) }.message)
    }

    @Test fun checkAsksTheQuestionOrTheDefault() {
        assertEquals("Is my text okay?", prompts.build(Action.CHECK, AskInput(image = "abc")).user)
        val p = prompts.build(Action.CHECK, AskInput(image = "abc", instruction = "  Is this mail ok?  "))
        assertEquals("The user asks: Is this mail ok?", p.user)
        assertEquals("abc", p.image)
        assertEquals(TestShared.shared.checkSystem, p.system)
    }

    @Test fun parseCheckReadsTheJsonEvenInAFence() {
        val r = Prompts.parseCheck("```json\n{\"verdict\":\"problems\",\"problems\":[\"a\",2,\"b\",\"c\",\"d\",\"e\",\"f\"],\"corrected\":\"Fixed.\"}\n```")
        assertEquals(CheckResult.Verdict(good = false, problems = listOf("a", "b", "c", "d", "e"), corrected = "Fixed."), r)
        assertEquals(CheckResult.Verdict(true, emptyList(), null), Prompts.parseCheck("{\"verdict\":\"good\",\"problems\":[],\"corrected\":\"  \"}"))
    }

    @Test fun parseCheckFallsBackToTheText() {
        assertEquals(CheckResult.Raw("Looks fine to me."), Prompts.parseCheck("  Looks fine to me. "))
        assertTrue(Prompts.parseCheck("{\"verdict\":\"maybe\",\"problems\":[]}") is CheckResult.Raw)
        assertEquals(CheckResult.Raw(""), Prompts.parseCheck(null))
    }

    @Test fun aTagAsksWithTheInstructionThenTheirTextAsTheMacDoes() {
        val shared = TestShared.shared
        val example = prompts.build(Action.TAG, AskInput(text = "x", instruction = "formal"))
        assertEquals("the user turn shared.json shows, made by shared/prompts.js", shared.tagUserExample, example.user)
        assertEquals(shared.tagSystem, example.system)
        assertNull(example.image)
        assertTrue(shared.tagSystem.contains("Return ONLY the finished text"))
        assertEquals(
            "no instruction is fix",
            "Instruction: fix\n\nTheir text:\n\"\"\"\ni not coming\n\"\"\"",
            prompts.build(Action.TAG, AskInput(text = "  i not coming ", instruction = "  ")).user,
        )
        assertEquals("tag", Action.TAG.id)
    }

    @Test fun aTagWithNothingToRewriteOrTooLongIsRefused() {
        for (text in listOf(null, "", "   ")) {
            val e = assertThrows(BuddyError::class.java) { prompts.build(Action.TAG, AskInput(text = text, instruction = "formal")) }
            assertEquals("bad_request", e.code)
            assertEquals(TestShared.shared.tagEmpty, e.message)
        }
        assertEquals("Write something before @buddy first.", TestShared.shared.tagEmpty)
        val long = assertThrows(BuddyError::class.java) { prompts.build(Action.TAG, AskInput(text = "x".repeat(8001))) }
        assertEquals("That is too long (over 8000 characters). Try a shorter one.", long.message)
        val longer = assertThrows(BuddyError::class.java) { prompts.build(Action.TAG, AskInput(text = "x", instruction = "y".repeat(1001))) }
        assertEquals("That is too long (over 1000 characters). Try a shorter one.", longer.message)
    }
}
