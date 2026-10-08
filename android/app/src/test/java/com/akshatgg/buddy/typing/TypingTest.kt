package com.akshatgg.buddy.typing

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TextEditTest {
    private val box = BoxText("Hi team, i am go to office.", 9, 26) // "i am go to office" selected

    @Test fun replacingTheSelectionPutsTheTextOverItAndTheCursorAfterIt() {
        assertEquals(Edit("Hi team, I am going to the office..", 34, 9, 26), TextEdit.put(box, PutMode.REPLACE, "I am going to the office.", "i am go to office"))
    }

    @Test fun theSelectedWordsAreFoundWhereTheyAreWhenTheBoxNoLongerSelectsThem() {
        val moved = BoxText("Hi team, i am go to office.", 3, 3)
        assertEquals(Edit("Hi team, I go.", 14, 9, 27), TextEdit.put(moved, PutMode.REPLACE, "I go.", "i am go to office."))
        // Not there at all: at the cursor.
        assertEquals(Edit("Hi X team, i am go to office.", 5, 3, 3), TextEdit.put(moved, PutMode.REPLACE, "X ", "something else"))
        // Selected, but other words: the selection is what the person sees, so it is replaced.
        assertEquals(Edit("Hi Y, i am go to office.", 4, 3, 7), TextEdit.put(BoxText("Hi team, i am go to office.", 3, 7), PutMode.REPLACE, "Y", "zzz"))
    }

    @Test fun replacingAllPutsTheTextOverTheWholeBox() {
        assertEquals(Edit("Dear Sir,", 9, 0, 27), TextEdit.put(box, PutMode.REPLACE_ALL, "Dear Sir,"))
    }

    @Test fun insertingGoesAtTheCursorOverASelectionAndAtTheEndWhenTheCursorIsUnknown() {
        assertEquals(Edit("Hello world", 6, 6, 6), TextEdit.put(BoxText("Hello world", 6, 6), PutMode.INSERT, ""))
        assertEquals(Edit("Hello dear world", 11, 6, 6), TextEdit.put(BoxText("Hello world", 6, 6), PutMode.INSERT, "dear "))
        assertEquals(Edit("Hello there", 11, 6, 11), TextEdit.put(BoxText("Hello world", 11, 6), PutMode.INSERT, "there"))
        assertEquals(Edit("Hello!", 6, 5, 5), TextEdit.put(BoxText("Hello", -1, -1), PutMode.INSERT, "!"))
        assertEquals(Edit("Hello!", 6, 5, 5), TextEdit.put(BoxText("Hello", 3, 99), PutMode.INSERT, "!"))
        assertEquals(Edit("Hi", 2, 0, 0), TextEdit.put(BoxText("", 0, 0), PutMode.INSERT, "Hi"))
    }

    @Test fun aNewVersionGoesWhereTheLastOneWentInTheTextFromBeforeIt() {
        val first = TextEdit.put(BoxText("Dear Sir, ", 10, 10), PutMode.INSERT, "I need a long leave tomorrow.")
        assertEquals(Edit("Dear Sir, Leave tomorrow?", 25, 10, 10), TextEdit.again("Dear Sir, ", first, "Leave tomorrow?"))
        val all = TextEdit.put(BoxText("i am go", 7, 7), PutMode.REPLACE_ALL, "I am going.")
        assertEquals(Edit("I go.", 5, 0, 7), TextEdit.again("i am go", all, "I go."))
    }
}

class TypingTargetTest {
    private val released = mutableListOf<String>()
    private val target = TypingTarget<String>("com.akshatgg.buddy") { released += it }

    @Test fun theLastBoxAndItsAppAreKept() {
        target.onWindow("com.whatsapp", keyboard = false)
        assertEquals("com.whatsapp", target.app)
        assertNull(target.box)
        target.onBox("com.whatsapp", "box 1")
        target.onBox("com.whatsapp", "box 2")
        assertEquals("box 2", target.box)
        assertEquals(listOf("box 1"), released)
    }

    @Test fun buddyTheKeyboardAndTheSystemUiChangeNothing() {
        target.onBox("com.whatsapp", "box")
        target.onWindow("com.akshatgg.buddy", keyboard = false) // the panel opens over it
        target.onWindow("com.google.android.inputmethod.latin", keyboard = true)
        target.onWindow("com.android.systemui", keyboard = false) // the notification shade
        target.onBox("com.akshatgg.buddy", "the panel's own box")
        assertEquals("box", target.box)
        assertEquals("com.whatsapp", target.app)
        assertEquals(listOf("the panel's own box"), released)
    }

    @Test fun anotherAppsWindowForgetsTheBoxAndTheSameAppsKeepsIt() {
        target.onBox("com.whatsapp", "box")
        target.onWindow("com.whatsapp", keyboard = false) // a dialog of its own
        assertEquals("box", target.box)
        target.onWindow("com.google.android.gm", keyboard = false)
        assertNull(target.box)
        assertEquals("com.google.android.gm", target.app)
        assertEquals(listOf("box"), released)
    }

    @Test fun aPasswordBoxIsNeverKeptAndForgetsTheOneBefore() {
        target.onBox("com.bank", "user name box")
        target.onPassword("com.bank")
        assertNull(target.box)
        assertEquals("com.bank", target.app)
        assertEquals(listOf("user name box"), released)
    }
}
