package com.akshatgg.buddy.ui.fix

import android.app.Activity
import android.content.Intent
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.AskInput
import com.akshatgg.buddy.ai.ChatReply
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.store.MemoryKeyValue
import com.akshatgg.buddy.store.MemorySecrets
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Fix with Buddy and Share → Buddy: the chat, with the text as its selection. "Buddy can type for you" is off here. */
@RunWith(AndroidJUnit4::class)
class FixActivityTest {
    @get:Rule val compose = createEmptyComposeRule()

    private val context = InstrumentationRegistry.getInstrumentation().targetContext
    private lateinit var real: AppGraph
    private val asked = mutableListOf<AskInput>()
    private var reply: () -> Answer = { fixed("I went to the market.") }

    private fun fixed(text: String) = Answer(text, "m", chat = ChatReply("fix", "Theek kar diya!", text, emptyList(), false, false, emptyList(), false))

    @Before fun useAFakeRouter() {
        real = AppGraph.instance
        AppGraph.instance = AppGraph(context, kv = MemoryKeyValue(), secrets = MemorySecrets(), ask = { action, input ->
            assertEquals(Action.CHAT, action)
            asked += input
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

    // As the share sheet sends it: in a task of its own, which the next share finds again.
    private fun share(text: String) = Intent(context, FixActivity::class.java)
        .setAction(Intent.ACTION_SEND)
        .setType("text/plain")
        .putExtra(Intent.EXTRA_TEXT, text)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    private fun fixIt() = compose.onNodeWithContentDescription("Send").performClick()

    @Test fun theSelectionShowsAndAnEmptyBoxFixesItAndReplaceHandsItBack() {
        ActivityScenario.launchActivityForResult<FixActivity>(processText("i am go to market")).use { scenario ->
            compose.onNodeWithText("Your selection: “i am go to market”").assertIsDisplayed()
            fixIt()
            compose.onNodeWithText("I went to the market.").assertIsDisplayed()
            compose.onNodeWithText("Replace").performClick()
            assertEquals(Activity.RESULT_OK, scenario.result.resultCode)
            assertEquals("I went to the market.", scenario.result.resultData.getStringExtra(Intent.EXTRA_PROCESS_TEXT))
            compose.waitUntil(5_000) { scenario.state == Lifecycle.State.DESTROYED }
        }
        assertEquals("Fix this.", asked.single().message)
        assertEquals("i am go to market", asked.single().selection)
    }

    // Compose's text menu starts the sheet this way: nobody waits for a result, so Replace would change nothing.
    @Test fun aSelectionNobodyWaitsForCanOnlyBeCopiedOrShared() {
        ActivityScenario.launch<FixActivity>(processText("i am go to market")).use {
            fixIt()
            compose.onNodeWithText("Copy").assertIsDisplayed()
            compose.onNodeWithText("Share").assertIsDisplayed()
            compose.onNodeWithText("Replace").assertDoesNotExist()
        }
    }

    @Test fun readOnlyTextCanOnlyBeCopied() {
        val intent = processText("i am go to market").putExtra(Intent.EXTRA_PROCESS_TEXT_READONLY, true)
        ActivityScenario.launchActivityForResult<FixActivity>(intent).use {
            fixIt()
            compose.onNodeWithText("Copy").assertIsDisplayed()
            compose.onNodeWithText("Replace").assertDoesNotExist()
        }
    }

    @Test fun aSecondShareStartsANewChatWithTheNewText() {
        ActivityScenario.launch<FixActivity>(share("alpha share one")).use {
            compose.onNodeWithText("Your selection: “alpha share one”").assertIsDisplayed()
            context.startActivity(share("beta share two"))
            compose.waitUntil(5_000) { compose.onAllNodesWithText("Your selection: “beta share two”").fetchSemanticsNodes().isNotEmpty() }
            fixIt()
            compose.onNodeWithText("I went to the market.").assertIsDisplayed()
        }
        assertEquals(listOf("beta share two"), asked.map { it.selection })
    }

    @Test fun signedOutShowsTheErrorWithOpenSettingsAndTryAgain() {
        reply = { throw BuddyError("signed_out", "Sign in to use Buddy.") }
        ActivityScenario.launchActivityForResult<FixActivity>(processText("i am go to market")).use {
            fixIt()
            compose.onNodeWithText("Sign in to use Buddy.").assertIsDisplayed()
            compose.onNodeWithText("Open Settings").assertIsDisplayed()
            compose.onNodeWithText("Try again").assertIsDisplayed()
        }
    }
}
