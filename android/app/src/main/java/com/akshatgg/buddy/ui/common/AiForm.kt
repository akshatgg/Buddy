package com.akshatgg.buddy.ui.common

import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.akshatgg.buddy.ui.panel.Primary
import com.akshatgg.buddy.ui.panel.ROUNDED
import com.akshatgg.buddy.ui.panel.Secondary
import com.akshatgg.buddy.ui.theme.Buddy
import kotlinx.coroutines.Dispatchers

/** The AI form (which AI, API key, model), in Settings and the Welcome, in the Mac's words and order. */
@Composable
fun AiForm(model: AiFormModel) {
    val state by model.state.collectAsStateWithLifecycle(context = Dispatchers.Main.immediate)
    val context = LocalContext.current
    val colors = Buddy.colors
    LaunchedEffect(model) { model.load() }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Which AI do you have a key for?", style = MaterialTheme.typography.bodyMedium)
        Column(Modifier.selectableGroup().padding(top = 2.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            // Two by two, as cards like the buddies.
            for (row in model.choices.chunked(2)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((id, label) in row) {
                        val picked = id == state.provider
                        Text(
                            label,
                            Modifier
                                .weight(1f)
                                .clip(ROUNDED)
                                .background(colors.card)
                                .then(if (picked) Modifier.background(colors.accentSoft) else Modifier)
                                .border(if (picked) 2.dp else 1.dp, if (picked) colors.accent else colors.lineSoft, ROUNDED)
                                .selectable(selected = picked, role = Role.RadioButton, onClick = { model.pick(id) })
                                .padding(horizontal = 8.dp, vertical = 12.dp),
                            textAlign = TextAlign.Center,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }
        }
        Label("API key")
        // The whole width for the key box, so that the AI's name in it is not cut short on a phone.
        OutlinedTextField(
            value = state.key,
            onValueChange = model::setKey,
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text("Paste your ${model.label(state.provider)} key", maxLines = 1, overflow = TextOverflow.Ellipsis) },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, keyboardType = KeyboardType.Password),
            shape = ROUNDED,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = {
                try {
                    context.startActivity(Intent(Intent.ACTION_VIEW, model.keyUrl().toUri()))
                } catch (e: ActivityNotFoundException) {
                    model.noBrowser()
                }
            }, shape = ROUNDED) { Text("Get a key") }
            Spacer(Modifier.weight(1f))
            Primary("Save key", enabled = !state.saving, onClick = model::saveKey)
        }
        StatusLine(state.status)
        Label("Model")
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ModelMenu(state.models, state.model, model::chooseModel, Modifier.weight(1f))
            Secondary("Refresh", onClick = model::refresh)
        }
    }
}

@Composable
private fun Label(text: String) {
    Text(text, Modifier.padding(top = 12.dp), style = MaterialTheme.typography.bodyMedium)
}

/** The models the key can use, as a list that opens under the chosen one. */
@Composable
private fun ModelMenu(models: List<String>, chosen: String, onChoose: (String) -> Unit, modifier: Modifier) {
    var open by remember { mutableStateOf(false) }
    val colors = Buddy.colors
    Box(modifier) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(ROUNDED)
                .border(1.dp, colors.line, ROUNDED)
                .selectable(selected = open, role = Role.DropdownList, onClick = { open = true })
                .semantics { contentDescription = "Model" }
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(chosen, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text("▾", color = colors.muted)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (m in models) {
                DropdownMenuItem(text = { Text(m) }, onClick = {
                    open = false
                    onChoose(m)
                })
            }
        }
    }
}
