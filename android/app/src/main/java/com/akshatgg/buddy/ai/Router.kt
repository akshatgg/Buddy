package com.akshatgg.buddy.ai

import com.akshatgg.buddy.account.Account
import com.akshatgg.buddy.account.signedOut
import com.akshatgg.buddy.ai.providers.Providers
import com.akshatgg.buddy.cloud.CloudClient
import com.akshatgg.buddy.cloud.FreeSettings
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.Secrets

/** One answer to a panel action, by either route; `check` is set for a Check only. */
data class Answer(val text: String, val model: String, val check: CheckResult? = null)

// What the server says when it will not answer for free; the settings are fetched again after each.
private val FREE_REFUSALS = listOf("free_limit", "free_off", "blocked")

/**
 * Answers one panel action, by one of two routes (Phase 2 spec §5, "Routing"), as the Mac's ai.js does:
 *   free -- Buddy's server answers with the admin's key (CloudClient);
 *   own  -- the person's own key, straight to the provider they picked (Phase 1).
 * Which one comes from the server's free-mode settings for this person. Nobody uses either without signing in.
 */
class Router(
    private val account: Account,
    private val cloud: CloudClient,
    private val settings: AppSettings,
    private val secrets: Secrets,
    private val providers: Providers,
    private val prompts: Prompts,
) {
    fun modelFor(providerId: String): String {
        val provider = providers.get(providerId)
        return settings.model(providerId)?.ifEmpty { null } ?: provider.facts.fallbackModels[0]
    }

    private fun hasOwnKey() = secrets.has(settings.provider)

    /** The person's own key, straight to their provider: Phase 1's route. */
    private suspend fun askOwn(action: Action, input: AskInput): Answer {
        val providerId = settings.provider
        val provider = providers.get(providerId)
        val apiKey = secrets.get(providerId)?.ifEmpty { null } ?: throw BuddyError("no_key", "Add your API key in Settings first.")
        val prompt = prompts.build(action, input)
        val model = modelFor(providerId)
        if (prompt.image != null && !provider.isVisionModel(model)) {
            throw BuddyError("no_vision", "This model can't read screenshots. Pick another in Settings.")
        }
        val out = provider.complete(apiKey, model, prompt, prompts.maxTokens)
        return Answer(out.text, out.model, if (action == Action.CHECK) Prompts.parseCheck(out.text) else null)
    }

    /**
     * The server would not answer for free: carry on with the person's own key where the admin allows it. When the
     * settings cannot be fetched again, the ones from before the request decide, unless the person has been signed out
     * meanwhile.
     */
    private suspend fun afterRefusal(err: BuddyError, before: FreeSettings, action: Action, input: AskInput): Answer {
        val fresh = try {
            cloud.settings(force = true)
        } catch (fetchErr: BuddyError) {
            if (fetchErr.code == "signed_out") throw fetchErr
            null
        }
        // Signed out while the settings were being fetched again, which then comes back with none (signing out forgets
        // them): nobody uses either route without signing in, and the settings from before the request must not decide.
        if (!account.isSignedIn()) throw signedOut()
        val now = fresh ?: before
        if (err.code == "free_off") {
            if (!now.freeOn) return askOwn(action, input)
            throw err
        }
        if (now.allowOwnKey && hasOwnKey()) return askOwn(action, input)
        if (err.code == "free_limit" && now.allowOwnKey) {
            val limit = now.limit ?: before.limit
            val used = if (limit != null && limit != 0) "today's $limit free requests" else "today's free requests"
            throw BuddyError("need_key", "You've used $used. Add your own key in Settings to keep going, or wait until midnight.")
        }
        throw err
    }

    suspend fun ask(action: Action, input: AskInput): Answer {
        if (!account.isSignedIn()) throw signedOut()
        val free = cloud.settings()
        // Signed out while the settings were being fetched: signing out forgets them, so the fetch comes back with none,
        // which is not "the server was never reached" (nor a reason to use either route).
        if (!account.isSignedIn()) throw signedOut()
        if (free == null) {
            // The server has never been reached: the person's own key, when there is one.
            if (hasOwnKey()) return askOwn(action, input)
            throw BuddyError("network", "Couldn't reach Buddy's server. Check your internet.")
        }
        if (!free.freeOn) return askOwn(action, input)
        if (free.blocked) {
            if (free.allowOwnKey && hasOwnKey()) return askOwn(action, input)
            throw BuddyError("blocked", "Your free access is paused.")
        }
        // Today's free requests are used up and the admin lets this person go on with their own key: the server would
        // only refuse (and the settings be fetched again), so the own key answers at once.
        val usedUp = free.limitMode == "daily" && free.limit != null && free.usedToday >= free.limit
        if (usedUp && free.allowOwnKey && hasOwnKey()) return askOwn(action, input)
        prompts.build(action, input) // input that is not valid is refused here, without a call to the server
        return try {
            cloud.ask(action, input)
        } catch (err: BuddyError) {
            if (err.code !in FREE_REFUSALS) throw err
            afterRefusal(err, free, action, input)
        }
    }

    /** Models for a provider: the live list for the saved key, else the fallback list. */
    suspend fun listModels(providerId: String): List<String> {
        val provider = providers.get(providerId)
        val apiKey = secrets.get(providerId)?.ifEmpty { null } ?: return provider.facts.fallbackModels
        val live = provider.listModels(apiKey)
        return live.ifEmpty { provider.facts.fallbackModels }
    }
}
