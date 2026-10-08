package com.akshatgg.buddy.ai

import com.akshatgg.buddy.TestShared
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The desktop's test/memory-rules.test.js, case for case, against the rules shared.json carries. */
class MemoryRulesTest {
    private val rules = MemoryRules(TestShared.shared)
    private fun clean(text: String?) = rules.cleanFact(text)

    private fun refused(vararg facts: String) = facts.forEach { assertNull(it, clean(it)) }
    private fun kept(vararg facts: String) = facts.forEach { assertEquals(it, it, clean(it)) }

    @Test fun atMost50FactsEachAtMost200Characters() {
        assertEquals(50, rules.maxFacts)
        assertEquals(200, rules.maxFactChars)
    }

    @Test fun aFactIsKeptTrimmedOnOneLine() {
        assertEquals("Your boss is Mr. Sharma.", clean("  Your boss is Mr. Sharma.  "))
        assertEquals("You work at Infosys, in Pune.", clean("You work at\nInfosys,\r\n  in Pune."))
        assertEquals("You sign off with \"Regards, Akshat\".", clean("You sign off with\t\"Regards, Akshat\"."))
        assertEquals("as JavaScript's \\s: a no-break space too", "You live in Pune.", clean("You live in Pune.﻿"))
    }

    @Test fun nothingAndBlanksAreNotFacts() {
        for (value in listOf(null, "", "   ", "\n\t")) assertNull(value, clean(value))
    }

    @Test fun aFactUpTo200CharactersIsKeptALongerOneIsRefused() {
        val longest = "You like " + "a".repeat(200 - 9)
        assertEquals(200, longest.length)
        assertEquals(longest, clean(longest))
        assertNull(clean(longest + "a"))
        assertEquals("the spaces around it do not count", longest, clean("   $longest   "))
    }

    @Test fun aFactThatNamesAPasswordPasscodePinOtpOrCvvIsRefusedInAnyCase() = refused(
        "Your password is tiger123.",
        "Your Gmail PASSWORD is hunter2",
        "Your phone passcode is 4321.",
        "Your ATM PIN is 1234.",
        "Your pin is 0000",
        "The OTP was 482913.",
        "Your card CVV is 123.",
        "Your cvv: 999",
        "Your passwords are in a notebook.",
        "Your PINs are on a sticky note.",
    )

    @Test fun onlyWholeWordsCount() = kept(
        "You love spinach.",
        "You use Pinterest for recipes.",
        "Your team is Spinning Wheels.",
        "You prefer the second option.",
        "Your passport is renewed every ten years.",
    )

    @Test fun wholeWordsAreJavaScriptsAsciiOnes() {
        // JavaScript's \b sees "é" as no letter: "épin" holds the word "pin". Java's own \b would not.
        assertNull(clean("Your épin is 1234."))
        // JavaScript's \d is 0-9 only: twelve Devanagari digits are no long number to it.
        kept("Your lucky number is १२३४५६७८९०१२.")
    }

    @Test fun twelveOrMoreDigitsAreRefusedEvenWithSpacesDotsOrDashes() = refused(
        "Your card is 4111111111111111.",
        "Your card is 4111 1111 1111 1111.",
        "Your account number is 1234-5678-9012.",
        "Your Aadhaar is 1234 5678 9012.",
        "Your ID is 1234.5678.9012.",
        "Your number is 123456789012.",
        "Your card is 4111–1111–1111–1111.",
    )

    @Test fun aTenDigitPhoneNumberAndShorterNumbersAreKept() = kept(
        "Your phone is 98765 43210.",
        "Your phone is 987-654-3210.",
        "Your office is at 221B Baker Street, 2nd floor.",
        "You were born in 1990 and joined in 2015.",
        "Your pincode is 110001.",
    )

    @Test fun aPhoneNumberWithItsCountryCodeAndAPinCodeAreKept() {
        kept(
            "Your phone is +91 98765 43210.",
            "Your office phone is +44 (20) 7946 0958.",
            "Your PIN code is 110001.",
            "Your pin-code is 400001.",
        )
        // A card number does not become a phone number by starting with "+", nor a PIN by being near a code.
        refused("Your card is +4111 1111 1111 1111.", "Your PIN is 1234, the code for the door.")
    }

    @Test fun aPinCodeIsKeptOnlyAsThePostalCode() {
        refused(
            "Your ATM PIN code is 4321.",
            "Your debit card pin code is 4567.",
            "Your credit card PIN code is 110001.", // six digits, but a card's
            "Your UPI pin code is 123456.",
            "Your net banking PIN code is 560001.",
            "Your netbanking pincode is 560001.",
            "Your Bank PIN-code is 400001.",
            "Your PIN code for both cards is 482913.",
            "Your phone PIN code is 4321.",
            "Your PIN code is 1234.",
            "Your pincode is 98765.",
            "Your PIN code is 1100011.",
            "Your PIN code is 012345.", // a postal code never starts with 0
            "Your PIN code is 4 3 2 1.",
            "4321 is your PIN code.",
            "Your PIN code for the locker at your office is 4321.",
            "Your PIN code is 110001, and the one for your phone is 4321.",
        )
        kept(
            "Your PIN code is 110001.",
            "Your pincode is 560037.",
            "Your PIN code is 110 001.",
            "411001 is your PIN code.",
            "You live in Pune, PIN code 411001.",
            "You live in Bankura, PIN code 722101.", // whole words only: "Bankura" is not "bank"
            "Your clinic's PIN code is 110029, and you work in cardiology.",
            "You want to know the PIN code of your new office.",
            "You live at 12 MG Road, Pune, PIN code 411001.", // the house number is not the PIN code's number
            "Your office is on the 3rd floor, 221 Park Street, Kolkata, PIN code 700016.",
        )
    }
}
