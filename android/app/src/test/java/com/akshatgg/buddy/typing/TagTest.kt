package com.akshatgg.buddy.typing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** shared/tag.js's rules in Kotlin: the cases of test/tag.test.js, and a few where Kotlin and JavaScript differ. */
class TagTest {
    private val aarav = Tag.tagNames("Aarav")

    @Test fun theTagsNamesAreBuddyAndTheBuddysOwnNameWhenItIsOneWord() {
        assertEquals(listOf("buddy", "aarav"), Tag.tagNames("Aarav"))
        assertEquals(listOf("buddy"), Tag.tagNames("Buddy"))
        assertEquals(listOf("buddy"), Tag.tagNames("Mr Bean"))
        assertEquals(listOf("buddy"), Tag.tagNames(""))
        assertEquals(listOf("buddy"), Tag.tagNames(null))
        assertEquals(listOf("buddy", "आरव"), Tag.tagNames("आरव"))
        assertEquals(listOf("buddy", "anaya"), Tag.tagNames("  Anaya  "))
        assertEquals("one letter is too short", listOf("buddy"), Tag.tagNames("A"))
        assertEquals("25 is too long", listOf("buddy"), Tag.tagNames("a".repeat(25)))
        assertEquals("a name ending in a line break is not one word", listOf("buddy"), Tag.tagNames("ab\ncd"))
    }

    @Test fun theLastTagIsFoundWithWhatCameAfterItOnItsLine() {
        assertEquals(TagAt(13, 19, ""), Tag.findTag("i not coming @buddy", aarav))
        assertEquals("make it formal", Tag.findTag("hello @Buddy  make it formal  ", aarav)?.instruction)
        assertEquals("polite", Tag.findTag("kal chutti @aarav polite", aarav)?.instruction)
        assertEquals("the last one", "two", Tag.findTag("a @buddy one\nb @buddy two", aarav)?.instruction)
        assertEquals("ends at the end of its line", TagAt(2, 12, "one"), Tag.findTag("a @buddy one\nnext", aarav))
        assertEquals("cut to 200", 200, Tag.findTag("x @buddy " + "y".repeat(300), aarav)?.instruction?.length)
        assertNotNull("after a bracket", Tag.findTag("(@buddy)", aarav))
        assertNotNull("at the very start", Tag.findTag("@buddy", aarav))
        assertNotNull("in capitals", Tag.findTag("hi @BUDDY", aarav))
    }

    @Test fun notInsideAWordOrAnEmailAddressNorAnotherBuddysName() {
        for (text in listOf("mail me at sam@buddy.com", "a@buddy.com", "see @buddyx", "x@@buddy", "no tag here", "", null)) {
            assertNull(text.toString(), Tag.findTag(text, aarav))
        }
        assertNull("another buddy's name is not a tag", Tag.findTag("done @aarav fix", listOf("buddy")))
        assertNull("nor is a name inside a longer one", Tag.findTag("hi @aaravi", aarav))
    }

    @Test fun theParagraphTheTagEndsIsRewrittenAndTheRestStays() {
        assertEquals(TagSplit("", "i not coming tomorow", "", ""), Tag.splitAtTag("i not coming tomorow @buddy", aarav))
        assertEquals(
            TagSplit("Thanks.\n", "can u send it", "polite", "\nBye"),
            Tag.splitAtTag("Thanks.\ncan u send it @buddy polite\nBye", aarav),
        )
        assertEquals(
            "a paragraph of several lines: only the line the tag ends",
            TagSplit("Dear team,\nline one\n", "line two", "", ""),
            Tag.splitAtTag("Dear team,\nline one\nline two @aarav", aarav),
        )
        assertEquals("the last tag wins", TagSplit("a @buddy one\n", "b", "two", ""), Tag.splitAtTag("a @buddy one\nb @buddy two", aarav))
    }

    @Test fun allTakesEverythingBeforeTheTag() {
        assertEquals(TagSplit("", "one\ntwo", "formal", ""), Tag.splitAtTag("one\ntwo @buddy all formal", aarav))
        assertEquals(TagSplit("", "one\ntwo", "", ""), Tag.splitAtTag("one\ntwo @buddy all", aarav))
        assertEquals(TagSplit("", "one\ntwo", "polite", ""), Tag.splitAtTag("one\ntwo @buddy ALL: polite", aarav))
        assertEquals("allow is not all", TagSplit("one\n", "two", "allow it", ""), Tag.splitAtTag("one\ntwo @buddy allow it", aarav))
    }

    @Test fun nothingToRewriteIsNull() {
        assertNull("nothing before it", Tag.splitAtTag("@buddy fix", aarav))
        assertNull("nothing in its paragraph", Tag.splitAtTag("hello\n   @buddy", aarav))
        assertNull(Tag.splitAtTag("no tag", aarav))
        assertNull(Tag.splitAtTag(null, aarav))
    }

    @Test fun theAnswerIsTakenAsTheTextWithNoFenceAndNoQuotesAroundIt() {
        assertEquals("Hello there.", Tag.cleanAnswer("  Hello there.  "))
        assertEquals("Hello there.", Tag.cleanAnswer("```\nHello there.\n```"))
        assertEquals("Hello there.", Tag.cleanAnswer("```text\nHello there.\n```"))
        assertEquals("Hello there.", Tag.cleanAnswer("\"Hello there.\""))
        assertEquals("Hello there.", Tag.cleanAnswer("“Hello there.”"))
        assertEquals("quotes inside stay", "He said \"hi\" and \"bye\"", Tag.cleanAnswer("He said \"hi\" and \"bye\""))
        assertEquals("\"Hi\" and \"bye\"", Tag.cleanAnswer("\"Hi\" and \"bye\""))
        assertEquals("one quote alone stays", "\"", Tag.cleanAnswer("\""))
        assertEquals("", Tag.cleanAnswer(null))
    }
}
