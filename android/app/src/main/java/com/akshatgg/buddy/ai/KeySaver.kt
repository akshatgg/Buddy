package com.akshatgg.buddy.ai

import com.akshatgg.buddy.ai.providers.Providers
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.Secrets

// An API key is printable ASCII with no spaces. Smart quotes, a zero-width space or a second line that came along with
// the paste make the request fail, and on the Mac that failure looks just like having no internet.
private val KEY_SHAPE = Regex("^[\\x21-\\x7e]+$")

/** The model to use after a key is saved: keep the person's pick if the key can use it. */
private fun chooseModel(available: List<String>, fallbackModels: List<String>, current: String?): String {
    if (!current.isNullOrEmpty() && current in available) return current
    return if (fallbackModels[0] in available) fallbackModels[0] else available[0]
}

/**
 * A saved key: the AI it was saved for, the models it can use, whether the AI answered for it (false: saved but not
 * checked), and the AI that was asked for when the key turned out to be another's.
 */
data class SavedKey(val providerId: String, val models: List<String>, val verified: Boolean, val switchedFrom: String?)

/** Saving and clearing the person's own keys, as the Mac's settings:save-key and settings:clear-key do. */
class KeySaver(private val settings: AppSettings, private val secrets: Secrets, private val providers: Providers) {
    suspend fun save(providerId: String, key: String): SavedKey {
        providers.get(providerId) // an unknown name is refused before anything else is looked at
        val apiKey = key.trim()
        if (apiKey.isEmpty()) throw BuddyError("bad_request", "Paste your key first.")
        if (!KEY_SHAPE.matches(apiKey)) {
            throw BuddyError("bad_key", "That doesn't look like an API key. Copy only the key and paste it again.")
        }
        // A key says by how it starts which AI it is for. If that is not the AI that was asked for, the key is that AI's:
        // it is checked there, kept there, and Buddy switches to it. A key that starts like none of them is checked with
        // the AI that was asked for.
        val ownerId = providers.forKey(apiKey) ?: providerId
        val switched = ownerId != providerId
        val provider = providers.get(ownerId)
        var live: List<String>? = null
        try {
            live = provider.listModels(apiKey)
        } catch (e: BuddyError) {
            // A wrong key is refused; being offline is not the key's fault.
            if (e.code != "network") throw e
        }
        // From here the key is kept: before this, a refused key or a check that ran out of time has changed nothing, and
        // the chosen AI is still the one it was. The key is saved first, so that a phone whose keystore fails does not
        // end up switched to an AI it has no key for.
        secrets.set(ownerId, apiKey)
        val models = live?.ifEmpty { null } ?: provider.facts.fallbackModels
        settings.setModel(ownerId, chooseModel(models, provider.facts.fallbackModels, settings.model(ownerId)))
        if (switched) settings.provider = ownerId
        // verified: the provider answered, so the key is known to work.
        return SavedKey(ownerId, models, verified = live != null, switchedFrom = if (switched) providerId else null)
    }

    fun clear(providerId: String) {
        providers.get(providerId)
        secrets.clear(providerId)
    }
}
