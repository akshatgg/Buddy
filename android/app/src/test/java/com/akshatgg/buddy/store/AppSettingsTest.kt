package com.akshatgg.buddy.store

import com.akshatgg.buddy.cloud.FreeSettings
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppSettingsTest {
    @Test fun defaultsAreTheMacs() {
        val s = AppSettings(MemoryKeyValue())
        assertFalse(s.onboarded); assertFalse(s.buddyOn)
        assertEquals("boy-1", s.characterId); assertEquals("Aarav", s.buddyName)
        assertEquals(BuddySize.MEDIUM, s.size); assertEquals("anthropic", s.provider)
        assertNull(s.model("openai")); assertNull(s.cloud)
        assertFalse(s.notificationsAsked)
        assertFalse("the panel opens as a card", s.panelFull)
    }

    @Test fun namesAreTrimmedCutAndFallBackToTheCharacters() {
        val s = AppSettings(MemoryKeyValue())
        s.characterId = "girl-1"; s.buddyName = "   "
        assertEquals("Anaya", s.buddyName)
        s.buddyName = "  " + "x".repeat(40)
        assertEquals(24, s.buddyName.length)
        s.characterId = "ghost"
        assertEquals("boy-1", s.characterId)
    }

    @Test fun everythingSurvivesANewInstance() {
        val kv = MemoryKeyValue()
        AppSettings(kv).apply { setModel("openai", "gpt-4.1"); bubbleRight = false; bubbleY = 1.7f; size = BuddySize.LARGE; notificationsAsked = true }
        val again = AppSettings(kv)
        assertTrue(again.notificationsAsked)
        assertEquals("gpt-4.1", again.model("openai")); assertFalse(again.bubbleRight)
        assertEquals(1f, again.bubbleY); assertEquals(BuddySize.LARGE, again.size)
    }

    @Test fun aFullScreenPanelIsRememberedForTheNextOne() {
        val kv = MemoryKeyValue()
        AppSettings(kv).panelFull = true
        assertTrue(AppSettings(kv).panelFull)
        AppSettings(kv).panelFull = false
        assertFalse(AppSettings(kv).panelFull)
        kv.putString("panelFull", "maybe")
        assertFalse("an odd value reads as the card", AppSettings(kv).panelFull)
    }

    @Test fun freeSettingsReadOddAnswersAsOff() {
        val odd = FreeSettings.read(Json.parseToJsonElement("""{"freeOn":"yes","limit":2.5,"usedToday":null}""").jsonObject)
        assertEquals(FreeSettings(false, "daily", null, 0, false, false, false), odd)
        val s = AppSettings(MemoryKeyValue())
        val on = FreeSettings(true, "daily", 5, 2, true, false, true)
        s.cloud = on
        assertEquals(on, s.cloud)
        s.cloud = null
        assertNull(s.cloud)
    }
}
