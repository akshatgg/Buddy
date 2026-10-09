package com.akshatgg.buddy.ui.panel

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.akshatgg.buddy.ui.theme.BuddyTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PanelScreenTest {
    @get:Rule val compose = createComposeRule()

    @Test fun anEmptyChatGreetsAndShowsTheExamples() {
        compose.setContent { BuddyTheme { PanelScreen(PanelState(greeting = "Hi Akshat! What should we do?"), "Aarav", PanelCallbacks()) } }
        compose.onNodeWithText("Hi Akshat! What should we do?").assertIsDisplayed()
        compose.onNodeWithText(EXAMPLES).assertIsDisplayed()
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
    }

    @Test fun anAnswersButtonsArePressedOnItsLine() {
        var pressed: Pair<Int, ChatButton>? = null
        val state = PanelState(items = listOf(YouSaid(1, "boss ko mail"), BuddySaid(2, "Ye lo!", "Dear Sir,", emptyList(), listOf(ChatButton.INSERT, ChatButton.COPY, ChatButton.SHARE))))
        compose.setContent { BuddyTheme { PanelScreen(state, "Aarav", PanelCallbacks(press = { id, b -> pressed = id to b })) } }
        compose.onNodeWithText("Dear Sir,").assertIsDisplayed()
        compose.onNodeWithText("Insert").assertHasClickAction()
        compose.onNodeWithText("Copy").performClick()
        assertEquals(2 to ChatButton.COPY, pressed)
    }

    @Test fun anErrorWhoseFixIsInSettingsOffersOpenSettings() {
        var pressed: Pair<Int, ChatButton>? = null
        val state = PanelState(items = listOf(ChatError(1, "Sign in to use Buddy.", "signed_out", listOf(ChatButton.RETRY, ChatButton.SETTINGS))))
        compose.setContent { BuddyTheme { PanelScreen(state, "Aarav", PanelCallbacks(press = { id, b -> pressed = id to b })) } }
        compose.onNodeWithText("Sign in to use Buddy.").assertIsDisplayed()
        compose.onNodeWithText("Open Settings").assertIsDisplayed().performClick()
        assertEquals(1 to ChatButton.SETTINGS, pressed)
    }

    @Test fun whileTheBuddyThinksItSaysSo() {
        compose.setContent { BuddyTheme { PanelScreen(PanelState(busy = true, items = listOf(YouSaid(1, "hi"))), "Aarav", PanelCallbacks()) } }
        compose.onNodeWithText("Aarav is thinking…").assertIsDisplayed()
    }

    @Test fun theSizeButtonFillsTheScreenAndGoesBack() {
        val asked = mutableListOf<Boolean>()
        var full by mutableStateOf(false)
        val on = PanelCallbacks(setFull = { asked += it; full = it })
        compose.setContent { BuddyTheme { PanelScreen(PanelState(), "Aarav", on, full = full) } }
        compose.onNodeWithContentDescription("Full screen").performClick()
        compose.onNodeWithContentDescription("Smaller").assertIsDisplayed().performClick()
        compose.onNodeWithContentDescription("Full screen").assertIsDisplayed()
        assertEquals(listOf(true, false), asked)
    }

    @Test fun aSheetThatKeepsItsSizeHasNoSizeButtonAndClaudeOpensItsScreen() {
        var claude = 0
        compose.setContent { BuddyTheme { PanelScreen(PanelState(), "Aarav", PanelCallbacks(claude = { claude++ })) } }
        compose.onNodeWithContentDescription("Full screen").assertDoesNotExist()
        compose.onNodeWithText("Claude").performClick()
        assertEquals(1, claude)
    }
}
