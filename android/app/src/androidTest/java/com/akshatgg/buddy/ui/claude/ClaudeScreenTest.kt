package com.akshatgg.buddy.ui.claude

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.akshatgg.buddy.cloud.RemoteSession
import com.akshatgg.buddy.ui.panel.ClaudeCallbacks
import com.akshatgg.buddy.ui.panel.ClaudeState
import com.akshatgg.buddy.ui.theme.BuddyTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ClaudeScreenTest {
    @get:Rule val compose = createComposeRule()

    @Test fun signedOutItSaysToSignInFirst() {
        var signIn = 0
        var back = 0
        compose.setContent { BuddyTheme { ClaudeScreen(ClaudeState(), signedIn = false, ClaudeCallbacks(), back = { back++ }, signIn = { signIn++ }) } }
        compose.onNodeWithText(CLAUDE_SIGN_IN).assertIsDisplayed()
        compose.onNodeWithText("Sign in").performClick()
        compose.onNodeWithContentDescription("Back").performClick()
        assertEquals(1, signIn)
        assertEquals(1, back)
    }

    @Test fun signedInItListsTheSessionsToPick() {
        var opened: String? = null
        val state = ClaudeState(on = true, online = true, sessions = listOf(RemoteSession("s-1", "buddy", "working", true)))
        compose.setContent { BuddyTheme { ClaudeScreen(state, signedIn = true, ClaudeCallbacks(open = { opened = it }), back = {}, signIn = {}) } }
        compose.onNodeWithText("Claude Code").assertIsDisplayed()
        compose.onNodeWithText("Which Claude Code session?").assertIsDisplayed()
        compose.onNodeWithContentDescription("Send").assertIsNotEnabled()
        compose.onNodeWithText("buddy").performClick()
        assertEquals("s-1", opened)
    }
}
