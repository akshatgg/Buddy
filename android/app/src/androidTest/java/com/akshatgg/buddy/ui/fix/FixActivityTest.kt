package com.akshatgg.buddy.ui.fix

import android.app.Activity
import android.content.Intent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.AskInput
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.store.MemoryKeyValue
import com.akshatgg.buddy.store.MemorySecrets
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FixActivityTest {
    @get:Rule val compose = createEmptyComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var real: AppGraph
    private val asked = mutableListOf<Pair<Action, AskInput>>()
    private var reply: () -> Answer = { Answer("I went to the market.", "m") }

    @Before fun useAFakeRouter() {
        real = AppGraph.instance
        AppGraph.instance = AppGraph(context, kv = MemoryKeyValue(), secrets = MemorySecrets(), ask = { action, input ->
            asked += action to input
            reply()
        })
    }

    @After fun putTheRealGraphBack() {
        AppGraph.instance = real
    }

    private fun processText(text: String) = Intent(context, FixActivity::class.java)
        .setAction(Intent.ACTION_PROCESS_TEXT)
        .setType("text/plain")
        .putExtra(Intent.EXTRA_PROCESS_TEXT, text)

    @Test fun replaceHandsTheFixedTextBackToTheApp() {
        ActivityScenario.launchActivityForResult<FixActivity>(processText("i am go to market")).use { scenario ->
            compose.onNodeWithText("Fix my English").assertIsDisplayed()
            compose.onNodeWithText("i am go to market").assertIsDisplayed()
            compose.onNodeWithText("I went to the market.").assertIsDisplayed()
            compose.onNodeWithText("Replace").performClick()
            assertEquals(Activity.RESULT_OK, scenario.result.resultCode)
            assertEquals("I went to the market.", scenario.result.resultData.getStringExtra(Intent.EXTRA_PROCESS_TEXT))
        }
        assertEquals(listOf(Action.FIX to AskInput(text = "i am go to market")), asked)
    }

    @Test fun readOnlyTextCanOnlyBeCopied() {
        val intent = processText("i am go to market").putExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true)
        ActivityScenario.launchActivityForResult<FixActivity>(intent).use {
            compose.onNodeWithText("I went to the market.").assertIsDisplayed()
            compose.onNodeWithText("Copy").assertIsDisplayed()
            compose.onNodeWithText("Try again").assertIsDisplayed()
            compose.onNodeWithText("Replace").assertDoesNotExist()
        }
    }

    @Test fun sharedTextIsFixedAndCanOnlyBeCopied() {
        val intent = Intent(context, FixActivity::class.java)
            .setAction(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, "she go to school")
        ActivityScenario.launchActivityForResult<FixActivity>(intent).use {
            compose.onNodeWithText("I went to the market.").assertIsDisplayed()
            compose.onNodeWithText("Copy").assertIsDisplayed()
            compose.onNodeWithText("Replace").assertDoesNotExist()
        }
        assertEquals(listOf(Action.FIX to AskInput(text = "she go to school")), asked)
    }

    // As the share sheet sends it: in a task of its own, which the next share finds again.
    private fun share(text: String) = Intent(context, FixActivity::class.java)
        .setAction(Intent.ACTION_SEND)
        .setType("text/plain")
        .putExtra(Intent.EXTRA_TEXT, text)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    @Test fun aSecondShareFixesTheNewText() {
        ActivityScenario.launch<FixActivity>(share("alpha share one")).use {
            compose.onNodeWithText("alpha share one").assertIsDisplayed()
            context.startActivity(share("beta share two"))
            compose.waitUntil(5_000) { compose.onAllNodesWithText("beta share two").fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText("alpha share one").assertDoesNotExist()
            compose.onNodeWithText("I went to the market.").assertIsDisplayed()
            compose.onNodeWithText("Replace").assertDoesNotExist()
        }
        assertEquals(listOf(Action.FIX to AskInput(text = "alpha share one"), Action.FIX to AskInput(text = "beta share two")), asked)
    }

    @Test fun signedOutShowsThePanelsErrorWithOpenSettings() {
        reply = { throw BuddyError("signed_out", "Sign in to use Buddy.") }
        ActivityScenario.launchActivityForResult<FixActivity>(processText("i am go to market")).use {
            compose.onNodeWithText("Sign in to use Buddy.").assertIsDisplayed()
            compose.onNodeWithText("Open Settings").assertIsDisplayed()
            compose.onNodeWithText("Try again").assertIsDisplayed()
            compose.onNodeWithText("Replace").assertDoesNotExist()
        }
    }
}
