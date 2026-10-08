package com.akshatgg.buddy.ai

import com.akshatgg.buddy.FakeHttp
import com.akshatgg.buddy.TestShared
import com.akshatgg.buddy.ai.providers.Providers
import com.akshatgg.buddy.cloud.FreeSettings
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.net.HttpResponse
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.MemoryKeyValue
import com.akshatgg.buddy.store.MemorySecrets
import com.akshatgg.buddy.store.Secrets
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.security.KeyStoreException
import java.net.SocketTimeoutException

class KeySaverTest {
    // Gemini's model list: the names it lists, newest first.
    private var listed = listOf("gemini-pro-latest", "gemini-flash-latest", "gemini-2.5-flash")
    private var failure: Exception? = null
    private var status = 200
    private val http = FakeHttp { r ->
        failure?.let { throw it }
        val models = listed.joinToString(",") { """{"name":"models/$it","supportedGenerationMethods":["generateContent"]}""" }
        if (status == 200) HttpResponse(200, """{"models":[$models]}""") else HttpResponse(status, """{"error":{"message":"API key not valid."}}""")
    }
    private val kv = MemoryKeyValue()
    private val secrets = MemorySecrets()
    private val settings = AppSettings(kv)
    private val saver = KeySaver(settings, secrets, Providers(TestShared.shared, http))
    private suspend fun error(block: suspend () -> Unit): BuddyError = try { block(); throw AssertionError("no error") } catch (e: BuddyError) { e }

    @Test fun nothingPastedOrNotAKeyIsSaidBeforeAnythingIsChecked() = runTest {
        for (key in listOf("", "   ")) {
            val e = error { saver.save("anthropic", key) }
            assertEquals(listOf("bad_request", "Paste your key first."), listOf(e.code, e.message))
        }
        for (key in listOf("sk-ant-abc def", "sk-ant-abc\ndef", "sk-ant-“abc”")) {
            val e = error { saver.save("anthropic", key) }
            assertEquals(listOf("bad_key", "That doesn't look like an API key. Copy only the key and paste it again."), listOf(e.code, e.message))
        }
        assertEquals("bad_request", error { saver.save("nope", "sk-ant-abc") }.code)
        assertEquals(emptyList<Any>(), http.requests)
    }

    @Test fun aGeminiKeySavedWhileClaudeIsChosenIsGeminisAndBuddySwitches() = runTest {
        assertEquals("anthropic", settings.provider)
        val saved = saver.save("anthropic", "  AIzaKEY \n")
        assertEquals(SavedKey(providerId = "gemini", models = listed, verified = true, switchedFrom = "anthropic"), saved)
        assertEquals("gemini", settings.provider)
        assertEquals("AIzaKEY", secrets.get("gemini"))
        assertNull(secrets.get("anthropic"))
        assertEquals("AIzaKEY", http.requests.single().headers["x-goog-api-key"])
        assertEquals("the first fallback, which the key can use", "gemini-flash-latest", settings.model("gemini"))
    }

    @Test fun aKeyForTheAiAskedForSwitchesNothing() = runTest {
        val saved = saver.save("gemini", "AIzaKEY")
        assertEquals("gemini", saved.providerId)
        assertNull(saved.switchedFrom)
        assertEquals("the chosen AI is still the one it was", "anthropic", settings.provider)
    }

    @Test fun theModelIsThePersonsPickIfTheKeyCanUseItElseTheFirstFallbackElseTheFirstListed() = runTest {
        settings.setModel("gemini", "gemini-2.5-flash")
        saver.save("gemini", "AIzaKEY")
        assertEquals("gemini-2.5-flash", settings.model("gemini"))

        settings.setModel("gemini", "gemini-1.0-pro")
        saver.save("gemini", "AIzaKEY")
        assertEquals("gemini-flash-latest", settings.model("gemini"))

        listed = listOf("gemini-3-pro", "gemini-3-flash")
        saver.save("gemini", "AIzaKEY")
        assertEquals("gemini-3-pro", settings.model("gemini"))
    }

    @Test fun aRefusedKeyOrACheckThatRanOutOfTimeSavesNothing() = runTest {
        status = 400
        assertEquals("upstream", error { saver.save("anthropic", "AIzaBAD") }.code)
        status = 401
        assertEquals("Your Gemini key was rejected. Check it in Settings.", error { saver.save("anthropic", "AIzaBAD") }.message)
        status = 200
        failure = SocketTimeoutException("slow")
        assertEquals("timeout", error { saver.save("anthropic", "AIzaBAD") }.code)
        assertNull(secrets.get("gemini"))
        assertNull(settings.model("gemini"))
        assertEquals("anthropic", settings.provider)
    }

    @Test fun offlineTheKeyIsKeptUncheckedWithTheFallbackList() = runTest {
        failure = IOException("offline")
        val saved = saver.save("anthropic", "AIzaKEY")
        assertEquals(SavedKey(providerId = "gemini", models = listOf("gemini-flash-latest", "gemini-pro-latest"), verified = false, switchedFrom = "anthropic"), saved)
        assertEquals("AIzaKEY", secrets.get("gemini"))
        assertEquals("gemini", settings.provider)
        assertEquals("gemini-flash-latest", settings.model("gemini"))
    }

    @Test fun aKeystoreThatFailsSaysSoAndChangesNothing() = runTest {
        val broken = object : Secrets {
            override fun get(id: String): String? = null
            override fun set(id: String, value: String) = throw KeyStoreException("no keystore")
            override fun clear(id: String) {}
        }
        val e = error { KeySaver(settings, broken, Providers(TestShared.shared, http)).save("anthropic", "AIzaKEY") }
        assertEquals(listOf("no_keychain", "Your phone can't keep your key safe right now, so the key can't be saved."), listOf(e.code, e.message))
        assertEquals("not switched to an AI it has no key for", "anthropic", settings.provider)
        assertNull(settings.model("gemini"))
    }

    @Test fun anEmptyLiveListMeansTheFallbackList() = runTest {
        listed = emptyList()
        val saved = saver.save("gemini", "AIzaKEY")
        assertEquals(listOf("gemini-flash-latest", "gemini-pro-latest"), saved.models)
        assertTrue(saved.verified)
    }

    @Test fun clearingForgetsTheKey() {
        secrets.set("gemini", "AIzaKEY")
        saver.clear("gemini")
        assertNull(secrets.get("gemini"))
    }

    // ---- what the AI card says (free-state.js) ----

    private fun free(limitMode: String = "daily", limit: Int? = 30, usedToday: Int = 4, allowOwnKey: Boolean = false, blocked: Boolean = false, freeOn: Boolean = true) =
        FreeSettings(freeOn, limitMode, limit, usedToday, allowOwnKey, blocked, isAdmin = false)

    @Test fun notKnownYetOrFreeModeOffIsTheKeyFormAsInPhase1() {
        assertEquals(AiSection("", true), aiSection(null))
        assertEquals(AiSection("", true), aiSection(free(freeOn = false)))
    }

    @Test fun freeAndUnlimitedNeedsNoKey() {
        assertEquals(AiSection("Free AI is on. No key needed.", false), aiSection(free(limitMode = "unlimited", limit = null)))
    }

    @Test fun aDailyLimitSaysHowManyADayAndHowManyAreUsedToday() {
        assertEquals(AiSection("You get 30 free requests a day. Used today: 4.", false), aiSection(free()))
        assertEquals("You get 30 free requests a day. Used today: 30.", aiSection(free(usedToday = 31)).note)
    }

    @Test fun aDailyLimitWithOwnKeysAllowedShowsTheFormToo() {
        assertEquals(
            AiSection("You get 30 free requests a day. Used today: 4. Add your own key to keep going after your free requests run out.", true),
            aiSection(free(allowOwnKey = true)),
        )
    }

    @Test fun blockedIsPausedWithTheFormOnlyWhereOwnKeysAreAllowed() {
        assertEquals(AiSection("Your free access is paused.", false), aiSection(free(blocked = true)))
        assertEquals(AiSection("Your free access is paused. You can still use your own key.", true), aiSection(free(blocked = true, allowOwnKey = true)))
    }
}
