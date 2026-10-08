package com.akshatgg.buddy

import android.content.Context
import com.akshatgg.buddy.account.Account
import com.akshatgg.buddy.account.CredentialManagerGoogle
import com.akshatgg.buddy.account.FirebaseAuthApi
import com.akshatgg.buddy.account.GoogleIdTokens
import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.AskInput
import com.akshatgg.buddy.ai.KeySaver
import com.akshatgg.buddy.ai.MemoryRules
import com.akshatgg.buddy.ai.Prompts
import com.akshatgg.buddy.ai.Router
import com.akshatgg.buddy.ai.providers.Providers
import com.akshatgg.buddy.cloud.CloudClient
import com.akshatgg.buddy.core.Shared
import com.akshatgg.buddy.net.Http
import com.akshatgg.buddy.net.UrlConnectionHttp
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.KeyValue
import com.akshatgg.buddy.store.KeystoreSecrets
import com.akshatgg.buddy.store.Memory
import com.akshatgg.buddy.store.Secrets
import com.akshatgg.buddy.store.SharedPrefsKeyValue
import kotlinx.coroutines.CoroutineScope
import com.akshatgg.buddy.bubble.LookService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Every long-lived object, made once for the process and shared, as the Mac's main.js makes its store, secrets,
 * account, cloud and ai once. BuddyApp makes the real one at launch. The network, the stores, the Google picker and
 * the AI's answers can be passed in, so that an instrumented test can make a graph with fakes and put it in `instance`
 * before it starts an activity.
 */
class AppGraph(
    context: Context,
    val http: Http = UrlConnectionHttp(),
    val kv: KeyValue = SharedPrefsKeyValue(context, "buddy"),
    // One for the whole process: two could each make the keystore key at the same moment, and one would be lost.
    val secrets: Secrets = KeystoreSecrets(SharedPrefsKeyValue(context, "secrets")),
    val google: GoogleIdTokens = CredentialManagerGoogle(BuildConfig.GOOGLE_WEB_CLIENT_ID),
    ask: (suspend (Action, AskInput) -> Answer)? = null,
) {
    val shared: Shared = Shared.load(context)
    val settings = AppSettings(kv)
    val providers = Providers(shared, http)
    val prompts = Prompts(shared)
    val account = Account(kv, secrets, BuildConfig.FIREBASE_API_KEY.ifEmpty { null }?.let { FirebaseAuthApi(http, it) })
    val cloud = CloudClient(http, BuildConfig.SERVER_URL, account, settings)
    val router = Router(account, cloud, settings, secrets, providers, prompts)
    val keySaver = KeySaver(settings, secrets, providers)
    val memory = Memory(kv, MemoryRules(shared))

    /** Whether Look where I type is on in Android's Accessibility settings. */
    val lookEnabled: () -> Boolean = { LookService.isEnabled(context) }

    /** How the panel and the Fix sheet ask the AI: through the router, unless a test answers instead. */
    val ask: suspend (Action, AskInput) -> Answer = ask ?: router::ask

    // Lives as long as the process, like the objects above.
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    init {
        // Whenever the person is signed out (from Settings, or because the server or Firebase turned the sign-in
        // down), their free-mode settings are forgotten, so that the next person does not inherit them (or the
        // admin's menu). The Mac forgets on a sign-in too; here this runs a moment after the change, and could then
        // throw away the settings fetched just after signing in.
        scope.launch {
            account.user.collect { if (it == null) cloud.forget() }
        }
    }

    companion object {
        lateinit var instance: AppGraph
    }
}
