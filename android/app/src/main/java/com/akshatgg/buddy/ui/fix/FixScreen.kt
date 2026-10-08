package com.akshatgg.buddy.ui.fix

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.akshatgg.buddy.ui.panel.AnswerText
import com.akshatgg.buddy.ui.panel.Busy
import com.akshatgg.buddy.ui.panel.ErrorLine
import com.akshatgg.buddy.ui.panel.PanelError
import com.akshatgg.buddy.ui.panel.PanelState
import com.akshatgg.buddy.ui.panel.Primary
import com.akshatgg.buddy.ui.panel.ROUNDED
import com.akshatgg.buddy.ui.panel.Secondary
import com.akshatgg.buddy.ui.panel.Sheet
import com.akshatgg.buddy.ui.theme.Buddy

/** What the sheet's buttons do. FixActivity wires them to PanelModel and to Android; a test leaves them be. */
class FixCallbacks(
    val replace: (String) -> Unit = {},
    val copy: (String) -> Unit = {},
    val retry: () -> Unit = {},
    /** The error's own "Open Settings": to the part of Settings that fixes it. */
    val openSettings: (PanelError) -> Unit = {},
    val close: () -> Unit = {},
)

/**
 * The sheet "Fix with Buddy" opens over the other app: the text it was given, then the fixed text, with Replace when
 * that app lets Buddy put it back in place of the selection, Copy and Try again. What went wrong shows as in the panel.
 */
@Composable
fun FixScreen(state: PanelState, canReplace: Boolean, on: FixCallbacks) {
    Sheet(on.close) {
        Text("Fix my English", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
        Text(
            state.fixText,
            color = Buddy.colors.muted,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
        if (state.busy) Busy()
        state.error?.let { ErrorLine(it, on.openSettings) }
        val fixed = state.answer?.text
        if (fixed != null) AnswerText(fixed)
        // There is no box to send again from, so Try again is here after an error as well as after an answer.
        if (!state.busy) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!fixed.isNullOrEmpty()) {
                    if (canReplace) {
                        Primary("Replace") { on.replace(fixed) }
                        Secondary("Copy") { on.copy(fixed) }
                    } else {
                        Primary("Copy") { on.copy(fixed) }
                    }
                }
                Spacer(Modifier.weight(1f))
                TextButton(on.retry, shape = ROUNDED) { Text("Try again") }
            }
        }
    }
}
