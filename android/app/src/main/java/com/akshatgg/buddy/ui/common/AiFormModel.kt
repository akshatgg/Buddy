package com.akshatgg.buddy.ui.common

import com.akshatgg.buddy.ai.KeySaver
import com.akshatgg.buddy.ai.providers.Providers
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.Secrets
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

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
    private var shown: Pair<String, Boolean>? = null // the AI and whether it had a key, as the form last showed them

    /** All four AIs, as choices: nobody has to open a list to find out which ones Buddy works with. */
    val choices: List<Pair<String, String>> = providers.ids.map { it to label(it) }

    fun label(id: String): String = providers.get(id).facts.label

    fun keyUrl(): String = providers.get(current.value.provider).facts.keyUrl

    /** "Get a key" found no browser to open the AI's page in. */
    fun noBrowser() = setStatus(Status("Couldn't open your browser.", Tone.ERROR))

    private fun setStatus(status: Status) = current.update { it.copy(status = status) }

    /** What is known about the key: saved or not. */
    private fun keyStatus(id: String) = if (secrets.has(id)) Status("Key saved ✓", Tone.GOOD) else Status("No key yet.")

    private fun fillModels(models: List<String>) = current.update { it.copy(models = models, model = modelFor(it.provider)) }

    /** The saved AI and what is known about its key. What is typed in the key box stays: it is not saved yet. */
    private fun render() {
        val id = settings.provider
        shown = id to secrets.has(id)
        current.update { it.copy(provider = id, status = keyStatus(id)) }
    }

    /**
     * Each time the form is shown: what is saved, and the models the key can use. Shown again with the same AI and the
     * same key (the Welcome's step come back to, a turn of the phone), it stays as it was: its line still says what
     * the last thing done there found, such as a key saved without a check.
     */
    fun load() {
        val id = settings.provider
        if (shown == id to secrets.has(id)) return
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
            } catch (e: Exception) {
                // A refused key, no internet, or a keystore that failed (KeySaver says so in plain words); anything else
                // is a bug, and the line says to try again.
                setStatus(failure(e, "save key"))
            } finally {
                current.update { it.copy(saving = false) }
            }
        }
    }
}
