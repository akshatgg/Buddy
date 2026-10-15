package com.akshatgg.buddy.calls

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneBookTest {
    @Test fun oneCalleePerContactWithItsPrimaryElseMobileElseFirstNumber() {
        val rows = listOf(
            PhoneRow(1, "Prince Sharma", "0124 400 1000", primary = false, mobile = false),
            PhoneRow(1, "Prince Sharma", "+91 98123 45678", primary = false, mobile = true),
            PhoneRow(2, "Mom", "98100 00001", primary = false, mobile = true),
            PhoneRow(2, "Mom", "98100 00002", primary = true, mobile = false),
            PhoneRow(3, "Office", "011 2345 6789", primary = false, mobile = false),
        )
        assertEquals(
            listOf(Callee("Prince Sharma", "+91 98123 45678"), Callee("Mom", "98100 00002"), Callee("Office", "011 2345 6789")),
            calleesFrom(rows),
        )
    }
    @Test fun rowsWithNoNameOrNoNumberAreLeftOut() {
        val rows = listOf(PhoneRow(1, " ", "981"), PhoneRow(2, "A", null), PhoneRow(3, "B", "12"), PhoneRow(4, "C", "100"))
        assertEquals(listOf(Callee("C", "100")), calleesFrom(rows))
    }
    @Test fun theSameNumberWrittenTwoWays() {
        assertTrue(sameNumber("+91 98123 45678", "098123-45678"))
        assertTrue(sameNumber("100", "100"))
        assertFalse(sameNumber("+91 98123 45678", "+91 98123 45679"))
        assertFalse(sameNumber("", ""))
    }
}
