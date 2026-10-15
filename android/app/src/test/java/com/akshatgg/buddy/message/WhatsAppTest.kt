package com.akshatgg.buddy.message

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WhatsAppTest {
    @Test fun aWhatsAppRowIsAPersonWithTheirNumber() {
        assertEquals(Person("Priya Sharma", "919812345678", "com.whatsapp"),
            personFrom("Priya Sharma", "919812345678@s.whatsapp.net", "vnd.android.cursor.item/vnd.com.whatsapp.profile"))
    }
    @Test fun aBusinessRowIsForWhatsAppBusiness() {
        assertEquals("com.whatsapp.w4b", personFrom("Priya", "91981@s.whatsapp.net", "vnd.android.cursor.item/vnd.com.whatsapp.w4b.profile")?.app)
    }
    @Test fun rowsWithoutANameOrNumberOrOfAnotherKindAreNobody() {
        assertNull(personFrom("", "9198@s.whatsapp.net", "vnd.android.cursor.item/vnd.com.whatsapp.profile"))
        assertNull(personFrom("Priya", "", "vnd.android.cursor.item/vnd.com.whatsapp.profile"))
        assertNull(personFrom("Priya", "abc@s.whatsapp.net", "vnd.android.cursor.item/vnd.com.whatsapp.profile"))
        assertNull(personFrom("Priya", "9198@s.whatsapp.net", "vnd.android.cursor.item/phone_v2"))
        assertNull(personFrom("Group", "1203630@g.us", "vnd.android.cursor.item/vnd.com.whatsapp.profile"))
    }
    @Test fun theLinkCarriesTheNumberAndTheTextEncoded() {
        assertEquals("https://api.whatsapp.com/send?phone=919812345678&text=I%27m%20late%20%26%20sorry%21",
            chatLink(Person("Priya", "919812345678", "com.whatsapp"), "I'm late & sorry!"))
    }
    @Test fun aLineBreakAndHindiAreEncodedAndSpacesAreNeverPlus() {
        assertEquals(
            "https://api.whatsapp.com/send?phone=919812345678&text=Sorry%0A%E0%A4%AE%E0%A5%88%E0%A4%82%20%E0%A4%86%20%E0%A4%B0%E0%A4%B9%E0%A4%BE%20%E0%A4%B9%E0%A5%82%E0%A4%81",
            chatLink(Person("Priya", "919812345678", "com.whatsapp"), "Sorry\nमैं आ रहा हूँ"),
        )
        assertEquals("https://api.whatsapp.com/send?phone=91&text=1%2B1", chatLink(Person("P", "91", "com.whatsapp"), "1+1"))
    }
}
