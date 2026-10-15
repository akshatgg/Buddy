package com.akshatgg.buddy.ui.panel

import android.Manifest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PermissionsTest {
    @Test fun eachNewQuestionHasItsLine() {
        assertEquals("I need your OK to make calls.", whyLine(Manifest.permission.CALL_PHONE))
        assertEquals("I need your OK to see who is calling.", whyLine(Manifest.permission.READ_PHONE_STATE))
        assertEquals("I need your OK to see your calls.", whyLine(Manifest.permission.READ_CALL_LOG))
        assertNull(whyLine(Manifest.permission.READ_CONTACTS)) // asked as it was in the message work, with no line
    }
}
