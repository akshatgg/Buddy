package com.akshatgg.buddy.ui.panel

import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ui.theme.BuddyTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class PanelScreenTest {
    @get:Rule val compose = createComposeRule()

    @Test fun aFixAnswerShowsAfterAndCanBeCopied() {
        var copied: String? = null
        val state = PanelState(tab = Tab.FIX, fixText = "i am go to market", original = "i am go to market", answer = Answer("I went to the market.", "m"))
        compose.setContent { BuddyTheme { PanelScreen(state, "Aarav", PanelCallbacks(copy = { copied = it })) } }
        compose.onNodeWithText("After").assertIsDisplayed()
        compose.onNodeWithText("I went to the market.").assertIsDisplayed()
        compose.onNodeWithText("Copy").assertHasClickAction().performClick()
        assertEquals("I went to the market.", copied)
    }

    @Test fun anErrorWhoseFixIsInSettingsOffersOpenSettings() {
        var opened: PanelError? = null
        val error = PanelError("Sign in to use Buddy.", showSettings = true, code = "signed_out")
        compose.setContent { BuddyTheme { PanelScreen(PanelState(error = error), "Aarav", PanelCallbacks(openSettings = { opened = it })) } }
        compose.onNodeWithText("Sign in to use Buddy.").assertIsDisplayed()
        compose.onNodeWithText("Open Settings").assertIsDisplayed().performClick()
        assertEquals(error, opened)
    }
}
