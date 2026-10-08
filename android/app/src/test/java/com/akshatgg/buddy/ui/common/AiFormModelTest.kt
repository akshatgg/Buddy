package com.akshatgg.buddy.ui.common

import com.akshatgg.buddy.FakeHttp
import com.akshatgg.buddy.TestShared
import com.akshatgg.buddy.ai.KeySaver
import com.akshatgg.buddy.ai.providers.Providers
import com.akshatgg.buddy.net.HttpResponse
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.MemoryKeyValue
import com.akshatgg.buddy.store.MemorySecrets
import com.akshatgg.buddy.store.Secrets
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.IOException
import java.security.KeyStoreException

class AiFormModelTest {
    // Gemini's model list: the names it lists, newest first.
    private val listed = listOf("gemini-pro-latest", "gemini-flash-latest", "gemini-2.5-flash")
    private var failure: Exception? = null
    private var status = 200
    private val http = FakeHttp { _ ->
        failure?.let { throw it }
        val models = listed.joinToString(",") { """{"name":"models/$it","supportedGenerationMethods":["generateContent"]}""" }
        if (status == 200) HttpResponse(200, """{"models":[$models]}""") else HttpResponse(status, """{"error":{"message":"API key not valid."}}""")
    }
    private val settings = AppSettings(MemoryKeyValue())
    private var secrets: Secrets = MemorySecrets()
    private val providers = Providers(TestShared.shared, http)

    // As the router lists them: live for a saved key, else the fallback list.
    private fun CoroutineScope.model() = AiFormModel(
        settings, secrets, providers, KeySaver(settings, secrets, providers),
        listModels = { id -> secrets.get(id)?.let { providers.get(id).listModels(it) } ?: providers.get(id).facts.fallbackModels },
        modelFor = { id -> settings.model(id) ?: providers.get(id).facts.fallbackModels[0] },
        scope = this,
    )

    private fun TestScope.save(m: AiFormModel, key: String) {
        m.setKey(key)
        m.saveKey()
        testScheduler.advanceUntilIdle()
    }

    @Test fun aKeyForTheChosenAiIsSavedAndChecked() = runTest {
        settings.provider = "gemini"
        val m = model()
        m.load()
        assertEquals(Status("No key yet."), m.state.value.status)
        save(m, "AIzaKEY")
        val s = m.state.value
        assertEquals(Status("Key saved ✓", Tone.GOOD), s.status)
        assertEquals("the key box is emptied", "", s.key)
        assertEquals(listed, s.models)
        assertEquals("gemini-flash-latest", s.model)
        assertFalse(s.saving)
    }

    @Test fun aKeyForAnotherAiSwitchesToIt() = runTest {
        val m = model()
        m.load()
        save(m, "AIzaKEY")
        assertEquals("gemini", m.state.value.provider)
        assertEquals(
            Status("That key is for Google Gemini, so I switched to Google Gemini. Key saved ✓", Tone.GOOD),
            m.state.value.status,
        )
    }

    @Test fun offlineTheKeyIsSavedUnchecked() = runTest {
        failure = IOException("offline")
        settings.provider = "gemini"
        val m = model()
        m.load()
        save(m, "AIzaKEY")
        assertEquals(Status("Key saved — I couldn't check it (no internet)"), m.state.value.status)
        m.pick("anthropic")
        failure = null
        save(m, "AIzaOTHER")
        assertEquals(Status("That key is for Google Gemini, so I switched to Google Gemini. Key saved ✓", Tone.GOOD), m.state.value.status)
    }

    @Test fun aRefusedKeySaysWhyAndStaysInTheBox() = runTest {
        status = 401
        settings.provider = "gemini"
        val m = model()
        m.load()
        save(m, "AIzaBAD")
        assertEquals(Status("Your Gemini key was rejected. Check it in Settings.", Tone.ERROR), m.state.value.status)
        assertEquals("AIzaBAD", m.state.value.key)
        assertFalse(m.state.value.saving)
    }

    @Test fun aKeystoreThatFailsSaysTheKeyCantBeSaved() = runTest {
        secrets = object : Secrets {
            override fun get(id: String): String? = null
            override fun set(id: String, value: String) = throw KeyStoreException("no keystore")
            override fun clear(id: String) {}
        }
        settings.provider = "gemini"
        val m = model()
        m.load()
        save(m, "AIzaKEY")
        assertEquals(Status("Your phone can't keep your key safe right now, so the key can't be saved.", Tone.ERROR), m.state.value.status)
    }

    @Test fun showingTheFormAgainKeepsWhatItsLineSaid() = runTest {
        failure = IOException("offline")
        settings.provider = "gemini"
        val m = model()
        m.load()
        save(m, "AIzaKEY")
        m.load() // the Welcome's AI step shown again
        testScheduler.advanceUntilIdle()
        assertEquals(Status("Key saved — I couldn't check it (no internet)"), m.state.value.status)
        settings.provider = "groq" // changed elsewhere meanwhile: the line is about the AI now chosen
        m.load()
        testScheduler.advanceUntilIdle()
        assertEquals("groq", m.state.value.provider)
        assertEquals(Status("No key yet."), m.state.value.status)
    }

    @Test fun noBrowserSaysSo() = runTest {
        val m = model()
        m.noBrowser()
        assertEquals(Status("Couldn't open your browser.", Tone.ERROR), m.state.value.status)
    }
}
