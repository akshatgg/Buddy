package com.akshatgg.buddy.ui.common

import android.util.Log
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.ui.theme.Buddy

/** The Mac's three kinds of status line: a wait or a plain fact, a success, and what went wrong. */
enum class Tone { MUTED, GOOD, ERROR }

/** A line that says how something went, under the part of the screen it is about. */
data class Status(val text: String, val tone: Tone = Tone.MUTED)

/**
 * What failed, for the person: a BuddyError's own words, which are written for them. Anything else is a bug or a
 * system failure whose words would mean nothing to them (they can even hold a file path), so only its kind goes to the
 * log, and the line says to try again, as the Mac's ipc/result.js.
 */
fun failure(e: Exception, where: String): Status {
    if (e is BuddyError) return Status(e.message.orEmpty(), Tone.ERROR)
    Log.w("Buddy", "$where: unexpected ${e.javaClass.simpleName}")
    return Status("Something went wrong. Try again.", Tone.ERROR)
}

@Composable
fun StatusLine(status: Status?, modifier: Modifier = Modifier) {
    if (status == null || status.text.isEmpty()) return
    val colors = Buddy.colors
    Text(
        status.text,
        modifier,
        color = when (status.tone) {
            Tone.MUTED -> colors.muted
            Tone.GOOD -> colors.good
            Tone.ERROR -> colors.error
        },
        style = MaterialTheme.typography.bodySmall,
    )
}

/** A soft box for something worth knowing (the Mac's .note), or, in the error tint, for what went wrong. */
@Composable
fun Note(text: String, error: Boolean = false) {
    val colors = Buddy.colors
    Text(
        text,
        Modifier.fillMaxWidth().background(if (error) colors.errorSoft else colors.accentSoft, RoundedCornerShape(7.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        color = if (error) colors.error else colors.fg,
        style = MaterialTheme.typography.bodyMedium,
    )
}
