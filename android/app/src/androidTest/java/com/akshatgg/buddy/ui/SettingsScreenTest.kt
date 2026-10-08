package com.akshatgg.buddy.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.cloud.FreeSettings
import com.akshatgg.buddy.net.Http
import com.akshatgg.buddy.net.HttpRequest
import com.akshatgg.buddy.net.HttpResponse
import com.akshatgg.buddy.store.MemoryKeyValue
import com.akshatgg.buddy.store.MemorySecrets
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.IOException

@RunWith(AndroidJUnit4::class)
class SettingsScreenTest {
    @get:Rule val compose = createEmptyComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var real: AppGraph
    private lateinit var graph: AppGraph

    // No internet: Settings' fetch of the free-mode settings on opening fails quietly, and the kept ones show.
    private val offline = object : Http {
        override suspend fun send(request: HttpRequest): HttpResponse = throw IOException("offline")
    }

    @Before fun keepTheRealGraph() {
        real = AppGraph.instance
    }

    @After fun putTheRealGraphBack() {
        AppGraph.instance = real
    }

    /** Someone who finished the Welcome and is signed in, with these free-mode settings kept from the server. */
    private fun signedIn(free: FreeSettings?) {
        val kv = MemoryKeyValue()
        val secrets = MemorySecrets()
        kv.putString("onboarded", "true")
        kv.putString("account.user", """{"uid":"u1","email":"asha@example.com","name":"Asha Rao","photo":""}""")
        secrets.set("account.refresh", "refresh-token")
        kv.putString("cloud", free?.toJson())
        graph = AppGraph(context, http = offline, kv = kv, secrets = secrets)
        AppGraph.instance = graph
    }

    private fun free(freeOn: Boolean, limitMode: String = "daily") =
        FreeSettings(freeOn = freeOn, limitMode = limitMode, limit = 2, usedToday = 0, allowOwnKey = false, blocked = false, isAdmin = false)

    @Test fun signedInShowsTheEmailAndSignOut() {
        signedIn(free(freeOn = false))
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.onNodeWithText("Asha Rao").assertIsDisplayed()
            compose.onNodeWithText("asha@example.com").assertIsDisplayed()
            compose.onNodeWithText("AR").assertIsDisplayed()
            compose.onNodeWithText("Sign in with Google").assertDoesNotExist()
            compose.onNodeWithText("Sign out").assertIsDisplayed().performClick()
            compose.onNodeWithText("Signed out.").assertIsDisplayed()
            compose.onNodeWithText("Not signed in").assertIsDisplayed()
            compose.onNodeWithText("Sign in with Google").assertIsDisplayed()
            assertFalse(graph.account.isSignedIn())
        }
    }

    @Test fun unlimitedFreeAiNeedsNoKey() {
        signedIn(free(freeOn = true, limitMode = "unlimited"))
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.onNodeWithText("Free AI is on. No key needed.").performScrollTo().assertIsDisplayed()
            compose.onNodeWithText("Which AI do you have a key for?").assertDoesNotExist()
            compose.onNodeWithText("Save key").assertDoesNotExist()
        }
    }

    @Test fun freeOffShowsTheKeyForm() {
        signedIn(free(freeOn = false))
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.onNodeWithText("Which AI do you have a key for?").performScrollTo().assertIsDisplayed()
            compose.onNodeWithText("Paste your Claude (Anthropic) key").assertExists()
            compose.onNodeWithText("Google Gemini").performScrollTo().performClick()
            compose.onNodeWithText("Paste your Google Gemini key").assertExists()
            compose.onNodeWithText("No key yet.").assertExists()
        }
    }
}
