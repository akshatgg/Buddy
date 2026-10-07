package com.akshatgg.buddy.ui.common

import android.content.ActivityNotFoundException
import android.content.Intent
import android.util.Log
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
import com.akshatgg.buddy.ai.KeySaver
import com.akshatgg.buddy.ai.providers.Providers
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.Secrets
import com.akshatgg.buddy.ui.panel.Primary
import com.akshatgg.buddy.ui.panel.ROUNDED
import com.akshatgg.buddy.ui.panel.Secondary
import com.akshatgg.buddy.ui.theme.Buddy
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

// The keystore is the only part of saving a key that throws something other than a BuddyError.
private const val NO_KEYSTORE = "Your phone can't keep your sign-in safe right now, so Buddy can't keep you signed in."

/** The form as it shows: the chosen AI, what is typed in the key box, the line under it, and the models. */
data class AiFormState(
    val provider: String,
    val key: String = "",
    val status: Status = Status(""),
    val models: List<String> = emptyList(),
    val model: String = "",
    val saving: Boolean = false,
)

/**
 * The AI form's state, as the Mac's ai-form.js: which AI, the key box (which never shows a saved key; it only takes a
 * new one) and the model. Every change is saved at once. Settings and the Welcome share one, kept by MainActivity.
 */
class AiFormModel(
    private val settings: AppSettings,
    private val secrets: Secrets,
    private val providers: Providers,
    private val keySaver: KeySaver,
    private val listModels: suspend (String) -> List<String>,
    private val modelFor: (String) -> String,
    private val scope: CoroutineScope,
) {
    private val current = MutableStateFlow(AiFormState(provider = settings.provider))
    val state: StateFlow<AiFormState> = current.asStateFlow()
    private var loading: Job? = null

    /** All four AIs, as choices: nobody has to open a list to find out which ones Buddy works with. */
    val choices: List<Pair<String, String>> = providers.ids.map { it to label(it) }

    fun label(id: String): String = providers.get(id).facts.label

    fun keyUrl(): String = providers.get(current.value.provider).facts.keyUrl

    private fun setStatus(status: Status) = current.update { it.copy(status = status) }

    /** What is known about the key: saved or not. */
    private fun keyStatus(id: String) = if (secrets.has(id)) Status("Key saved ✓", Tone.GOOD) else Status("No key yet.")

    private fun fillModels(models: List<String>) = current.update { it.copy(models = models, model = modelFor(it.provider)) }

    /** The saved AI and what is known about its key. What is typed in the key box stays: it is not saved yet. */
    private fun render() {
        val id = settings.provider
        current.update { it.copy(provider = id, status = keyStatus(id)) }
    }

    /** Each time the form is shown: what is saved, and the models the key can use. */
    fun load() {
        render()
        loadModels()
    }

    private fun loadModels() {
        val id = settings.provider
        loading?.cancel()
        fillModels(providers.get(id).facts.fallbackModels)
        if (!secrets.has(id)) return
        loading = scope.launch {
            try {
                val models = listModels(id)
                if (id != settings.provider) return@launch // another AI was chosen while this one was loading
                fillModels(models)
                setStatus(keyStatus(id)) // a refresh that works clears the error an earlier one left
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (id == settings.provider) setStatus(failure(e, "models"))
            }
        }
    }

    /** Another AI: saved at once. The key box keeps what is in it: a person may paste the key first, then pick their AI. */
    fun pick(id: String) {
        settings.provider = id
        render()
        loadModels()
    }

    fun setKey(text: String) = current.update { it.copy(key = text) }

    fun refresh() = loadModels()

    fun chooseModel(model: String) {
        val id = current.value.provider
        settings.setModel(id, model)
        current.update { it.copy(model = model) }
        if (current.value.status.tone == Tone.ERROR) setStatus(keyStatus(id)) // an earlier error no longer applies
    }

    fun saveKey() {
        if (current.value.saving) return
        val id = current.value.provider
        val key = current.value.key
        current.update { it.copy(saving = true, status = Status("Checking your key…")) }
        scope.launch {
            try {
                val saved = keySaver.save(id, key)
                loading?.cancel()
                current.update { it.copy(key = "") }
                render()
                fillModels(saved.models)
                // The key was for another AI than the one that was chosen: it was kept there, and Buddy switched to it.
                val label = label(current.value.provider)
                val switched = if (saved.switchedFrom != null) "That key is for $label, so I switched to $label. " else ""
                if (!saved.verified) {
                    setStatus(Status("${switched}Key saved — I couldn't check it (no internet)"))
                } else if (switched.isNotEmpty()) {
                    setStatus(Status("${switched}Key saved ✓", Tone.GOOD))
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: BuddyError) {
                setStatus(Status(e.message.orEmpty(), Tone.ERROR))
            } catch (e: Exception) {
                Log.w("Buddy", "save key: ${e.javaClass.simpleName}")
                setStatus(Status(NO_KEYSTORE, Tone.ERROR))
            } finally {
                current.update { it.copy(saving = false) }
            }
        }
    }
}

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
                    Log.w("Buddy", "get a key: no browser")
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
