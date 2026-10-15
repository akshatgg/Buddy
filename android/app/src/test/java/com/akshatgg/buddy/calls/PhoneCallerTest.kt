package com.akshatgg.buddy.calls

import android.content.ActivityNotFoundException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class PhoneCallerTest {
    private class FakeBook(val rows: List<PhoneRow>, val refused: Boolean = false) : PhoneBook {
        override suspend fun rows(): List<PhoneRow> { if (refused) throw SecurityException("no"); return rows }
    }
    private class FakeDialer(val can: Boolean = true, val fails: Exception? = null) : Dialer {
        val called = mutableListOf<String>()
        override fun canCall() = can
        override fun call(number: String) { fails?.let { throw it }; called += number }
    }
    private val prince = PhoneRow(1, "Prince Sharma", "+91 98123 45678", mobile = true)
    private fun caller(book: PhoneBook = FakeBook(listOf(prince)), dialer: Dialer = FakeDialer(), contacts: Boolean = true, calls: Boolean = true) =
        PhoneCaller(book, dialer, contactsAllowed = { contacts }, callsAllowed = { calls })

    @Test fun findsTheOneContact() = runTest {
        assertEquals(CallFound.One(Callee("Prince Sharma", "+91 98123 45678")), caller().find("prince"))
    }
    @Test fun nobodyByThatName() = runTest {
        assertEquals(CallFound.Say("I couldn't find Zoya in your contacts."), caller().find("Zoya"))
    }
    @Test fun twoContactsToChooseFrom() = runTest {
        val book = FakeBook(listOf(prince, PhoneRow(2, "Prince Kumar", "98100 00001")))
        assertEquals(CallFound.Say("Which Prince: Prince Sharma or Prince Kumar? Tell me the full name."), caller(book).find("Prince"))
    }
    @Test fun oneNameTwoNumbersIsNotGuessed() = runTest {
        val book = FakeBook(listOf(prince, PhoneRow(2, "Prince Sharma", "98100 00001")))
        assertEquals(CallFound.Say("You have more than one contact called Prince Sharma. Rename one in your phone's contacts, then ask me again."), caller(book).find("Prince"))
    }
    @Test fun oneNameTheSameNumberTwiceIsOnePerson() = runTest {
        val book = FakeBook(listOf(prince, PhoneRow(2, "Prince Sharma", "098123 45678")))
        assertEquals(CallFound.One(Callee("Prince Sharma", "+91 98123 45678")), caller(book).find("Prince"))
    }
    @Test fun contactsRefusedOrTakenBack() = runTest {
        val line = CallFound.Say("I need your contacts to find Prince. You can allow it in Settings.", "no_contacts")
        assertEquals(line, caller(contacts = false).find("Prince"))
        assertEquals(line, caller(FakeBook(emptyList(), refused = true)).find("Prince"))
    }
    @Test fun callsTheNumber() = runTest {
        val d = FakeDialer()
        assertEquals(Called.Done, caller(dialer = d).call(Callee("Prince Sharma", "+91 98123 45678")))
        assertEquals(listOf("+91 98123 45678"), d.called)
    }
    @Test fun noCallPermission() = runTest {
        val d = FakeDialer()
        assertEquals(Called.Failed(NO_CALLS, "no_calls"), caller(dialer = d, calls = false).call(Callee("P", "100")))
        assertEquals(emptyList<String>(), d.called)
        assertEquals(Called.Failed(NO_CALLS, "no_calls"), caller(dialer = FakeDialer(fails = SecurityException("x"))).call(Callee("P", "100")))
    }
    @Test fun aPhoneThatCannotCall() = runTest {
        assertEquals(Called.Failed("This phone can't make calls."), caller(dialer = FakeDialer(can = false)).call(Callee("P", "100")))
        assertEquals(Called.Failed("This phone can't make calls."), caller(dialer = FakeDialer(fails = ActivityNotFoundException("x"))).call(Callee("P", "100")))
    }
}
