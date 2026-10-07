package com.akshatgg.buddy.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.akshatgg.buddy.bubble.HeadView
import com.akshatgg.buddy.bubble.Mood
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.ui.theme.Buddy
import com.akshatgg.buddy.ui.theme.BuddyRadius

/**
 * A buddy's 3D head on a screen of the app: the floating head's own view, so both look the same. `mood` is what it
 * does when it first shows (a wave, say); `turning` turns it slowly from side to side. Its GPU side is freed when it
 * leaves the screen.
 */
@Composable
fun HeadPreview(characterId: String, modifier: Modifier = Modifier, mood: Mood = Mood.IDLE, turning: Boolean = false) {
    AndroidView(
        factory = { context ->
            HeadView(context).apply {
                this.characterId = characterId
                this.turning = turning
                this.mood = mood
            }
        },
        modifier = modifier,
        onRelease = { it.release() },
        update = {
            it.characterId = characterId
            it.turning = turning
        },
    )
}

/**
 * The buddies to choose from, side by side, each turning slowly: the chosen one has the accent's edge and tint, as
 * the Mac's buddy grid (buddy-grid.js) in Settings and the Welcome.
 */
@Composable
fun BuddyPicker(chosen: String, onPick: (String) -> Unit, headSize: Dp = 104.dp) {
    val colors = Buddy.colors
    val shape = RoundedCornerShape(BuddyRadius)
    Row(Modifier.fillMaxWidth().selectableGroup(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        for ((id, name) in AppSettings.CHARACTERS) {
            val picked = id == chosen
            Column(
                Modifier
                    .weight(1f)
                    .clip(shape)
                    .background(colors.card)
                    .then(if (picked) Modifier.background(colors.accentSoft) else Modifier)
                    .border(if (picked) 2.dp else 1.dp, if (picked) colors.accent else colors.lineSoft, shape)
                    .selectable(selected = picked, role = Role.RadioButton, onClick = { onPick(id) })
                    .padding(8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                HeadPreview(id, Modifier.size(headSize), turning = true)
                Text(name, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}
