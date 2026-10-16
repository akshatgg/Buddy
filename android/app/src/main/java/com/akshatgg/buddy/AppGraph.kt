package com.akshatgg.buddy

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import com.akshatgg.buddy.account.Account
import com.akshatgg.buddy.account.CredentialManagerGoogle
import com.akshatgg.buddy.account.FirebaseAuthApi
import com.akshatgg.buddy.account.GoogleIdTokens
import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.AskInput
import com.akshatgg.buddy.ai.KeySaver
import com.akshatgg.buddy.ai.Prompts
import com.akshatgg.buddy.ai.Router
import com.akshatgg.buddy.ai.providers.Providers
import com.akshatgg.buddy.apps.Launcher
import com.akshatgg.buddy.apps.PhoneLauncher
import com.akshatgg.buddy.bubble.BubbleBus
import com.akshatgg.buddy.bubble.LookService
import com.akshatgg.buddy.calls.AndroidPhoneBook
import com.akshatgg.buddy.calls.PhoneBook
import com.akshatgg.buddy.calls.RingWatch
import com.akshatgg.buddy.cloud.CloudClient
import com.akshatgg.buddy.cloud.MemorySyncer
import com.akshatgg.buddy.core.Shared
import com.akshatgg.buddy.message.PhoneWhatsApp
import com.akshatgg.buddy.message.WhatsApp
import com.akshatgg.buddy.net.Http
import com.akshatgg.buddy.notify.NotifStore
import com.akshatgg.buddy.net.UrlConnectionHttp
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.Facts
import com.akshatgg.buddy.store.KeyValue
import com.akshatgg.buddy.store.KeystoreSecrets
import com.akshatgg.buddy.store.Memory
import com.akshatgg.buddy.store.MemorySync
import com.akshatgg.buddy.store.Secrets
import com.akshatgg.buddy.store.SharedPrefsKeyValue
import com.akshatgg.buddy.typing.ServiceTypeIn
import com.akshatgg.buddy.typing.TypeIn
import com.akshatgg.buddy.ui.common.installer
import com.akshatgg.buddy.ui.settings.mayBeRestricted
import com.akshatgg.buddy.update.ApkInstaller
import com.akshatgg.buddy.update.Updater
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.akshatgg.buddy.apps.AppOpener
import com.akshatgg.buddy.calls.AndroidCallLog
import com.akshatgg.buddy.calls.AndroidNameLookup
import com.akshatgg.buddy.calls.AndroidPhoneState
import com.akshatgg.buddy.calls.CallInfo
import com.akshatgg.buddy.calls.PhoneCaller
import com.akshatgg.buddy.calls.PhoneDialer
import com.akshatgg.buddy.calls.ServiceCallScreen
import com.akshatgg.buddy.calls.WhatsAppCaller
import com.akshatgg.buddy.calls.phoneFormat
import com.akshatgg.buddy.message.Messenger
import com.akshatgg.buddy.message.ServiceChatScreen
import com.akshatgg.buddy.notify.NotifReader
import com.akshatgg.buddy.ui.panel.PanelHands
import com.akshatgg.buddy.ui.panel.PanelModel
import com.akshatgg.buddy.voice.HandsFree
import com.akshatgg.buddy.voice.SpokenChat
import com.akshatgg.buddy.voice.WakeRules
import com.akshatgg.buddy.voice.AudioRecordSource
import com.akshatgg.buddy.voice.Ears
import com.akshatgg.buddy.voice.KeyguardLock
import com.akshatgg.buddy.voice.Lock
import com.akshatgg.buddy.voice.MediaRecorderRecorder
import com.akshatgg.buddy.voice.PhoneTalkBack
import com.akshatgg.buddy.voice.TalkBack
import com.akshatgg.buddy.voice.TtsSpeaker
import com.akshatgg.buddy.voice.SharedSpotters
import com.akshatgg.buddy.voice.VoskSpotters
import com.akshatgg.buddy.voice.Voice
import com.akshatgg.buddy.voice.VoiceModel
import java.io.File
import kotlinx.coroutines.CoroutineScope
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
    val appContext: Context = context.applicationContext
    val shared: Shared = Shared.load(context)
    val settings = AppSettings(kv)
    val providers = Providers(shared, http)
    val prompts = Prompts(shared)
    val account = Account(kv, secrets, BuildConfig.FIREBASE_API_KEY.ifEmpty { null }?.let { FirebaseAuthApi(http, it) })
    val cloud = CloudClient(http, BuildConfig.SERVER_URL, account, settings)

    /** "Update now" (update/Updater.kt): the newest Android release on GitHub, downloaded and installed over this one. */
    val updater: Updater by lazy {
        Updater(
            http, BuildConfig.VERSION_NAME, File(appContext.cacheDir, "updates"), kv,
            CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
            download = ApkInstaller::download,
            canInstall = { ApkInstaller.canInstall(appContext) },
            install = { apk -> ApkInstaller.install(appContext, apk) },
        )
    }
    /** Buddy's ears (voice/VoiceModel.kt): the Vosk model, downloaded from Buddy's release the first time it is needed. */
    val voiceModel: VoiceModel by lazy { VoiceModel(File(appContext.filesDir, "voice-model"), shared.voiceModel, ApkInstaller::download, scope) }
    val router = Router(account, cloud, settings, secrets, providers, prompts)
    val keySaver = KeySaver(settings, secrets, providers)
    val memory = Memory(kv, MemorySync(shared))

    /** Whether Buddy can type for you (LookService) is on in Android's Accessibility settings. */
    val lookEnabled: () -> Boolean = { LookService.isEnabled(context) }

    /** Whether Android may block Buddy can type for you until restricted settings are allowed (mayBeRestricted). */
    val lookMayBeBlocked: Boolean by lazy { mayBeRestricted(Build.VERSION.SDK_INT, context.installer()) }

    /** A Voice for a screen with a 🎤: the microphone recorded into the app's cache, written down by Buddy's server. */
    val voiceFactory: (Context) -> Voice = { c ->
        Voice(MediaRecorderRecorder(c), { cloud.transcribe(it) }, { cloud.voiceOn() }, c.cacheDir, mood = BubbleBus::mood)
    }

    /**
     * Buddy's voice and ears for a spoken chat (voice/TalkBack.kt): TextToSpeech, and yes or no on the phone. The model
     * is fetched in the background the first time Buddy asks out loud; until it is there, the answer goes to the server.
     */
    /** The one Vosk model of this process, loaded when first needed and reused for every question (voice/Spotter.kt). */
    val spotters: SharedSpotters by lazy {
        SharedSpotters(ready = voiceModel::ready, generation = { voiceModel.generation }, load = { VoskSpotters(voiceModel.folder()) })
    }
    /** Buddy's voice for every spoken line, and for Settings' Play. */
    val speaker: TtsSpeaker by lazy { TtsSpeaker(appContext) { settings.voiceName } }
    val talkBack: TalkBack by lazy {
        val ears = Ears(
            mic = { AudioRecordSource() },
            spotters = { spotters.get() },
            missing = { shared.voiceModelMissing }, // words the model lacks: not offered, and the server hears the answer too
            transcribe = { audio, mime -> cloud.transcribe(audio, mime) },
        )
        PhoneTalkBack(speaker, ears, voiceModel, { audio, mime -> cloud.transcribe(audio, mime) },
            warm = { scope.launch(Dispatchers.Default) { spotters.warm() } })
    }
    val lock: Lock by lazy { KeyguardLock(appContext) }

    /**
     * What follows "Hey <name>" (voice/HandsFree.kt): a chat of its own, not the panel's, that answers out loud. It has
     * no screen and no permission questions: its hands never ask (a permission Buddy does not hold is a no).
     */
    val handsFree: HandsFree by lazy {
        fun held(p: String) = ContextCompat.checkSelfPermission(appContext, p) == PackageManager.PERMISSION_GRANTED
        val hands = PanelHands(
            contacts = { held(Manifest.permission.READ_CONTACTS) },
            allow = { held(it) },
            stepAside = {},
            screen = { null },
        )
        val model = PanelModel(
            ask = this.ask,
            scope = scope,
            bubble = BubbleBus::send,
            typeIn = typeIn,
            facts = facts,
            talkBack = talkBack,
            lock = lock,
            hands = hands,
            messaging = Messenger(whatsApp, ServiceChatScreen(appContext), contactsAllowed = hands.contacts),
            apps = AppOpener(launcher),
            phone = PhoneCaller(phoneBook, PhoneDialer(appContext), contactsAllowed = hands.contacts, callsAllowed = { hands.allow(Manifest.permission.CALL_PHONE) }),
            whatsAppCalls = WhatsAppCaller(whatsApp, ServiceCallScreen(appContext)),
            callInfo = CallInfo(AndroidPhoneState(appContext), { ringWatch.now }, AndroidCallLog(appContext), AndroidNameLookup(appContext), allowed = hands.allow, format = phoneFormat(appContext)),
            notifs = NotifReader(on = { NotificationManagerCompat.getEnabledListenerPackages(appContext).contains(appContext.packageName) }, recent = notifs::recent),
            firstName = ::firstName,
            maxMessage = shared.limitInstruction,
            maxSelection = shared.limitText,
            readyLine = "Open me and ask again, and I'll write it.",
        )
        val chat = object : SpokenChat {
            override fun open() = model.open()
            override fun hidden() = model.hidden()
            override fun sendSpoken(text: String) = model.sendSpoken(text)
            override val busy: Boolean get() = model.state.value.busy
        }
        HandsFree(chat, talkBack, { audio, mime -> cloud.transcribe(audio, mime) }, { settings.buddyName }, BubbleBus::say, { WakeRules.nameHeard(settings.buddyName, shared.voiceModelMissing) })
    }

    /** How the panel and the Fix sheet ask the AI: through the router, unless a test answers instead. */
    val ask: suspend (Action, AskInput) -> Answer = ask ?: router::ask

    /** Buddy can type for you: the box the person types in, through LookService. */
    val typeIn: TypeIn = ServiceTypeIn(appContext)

    /** Message a friend: who is on WhatsApp in the phone's contacts, and their chat (message/WhatsApp.kt). */
    val whatsApp: WhatsApp by lazy { PhoneWhatsApp(appContext) }

    /** Open an app: the phone's home-screen apps (apps/Apps.kt). */
    val launcher: Launcher by lazy { PhoneLauncher(appContext) }

    /** Call someone: the phone's contacts' numbers (calls/PhoneBook.kt). */
    val phoneBook: PhoneBook by lazy { AndroidPhoneBook(appContext) }

    /** Who is calling: the ringing number, heard while the bubble runs (calls/Ringing.kt). */
    val ringWatch: RingWatch by lazy { RingWatch(appContext) }

    /** Notifications heard while Notification access is on, in memory only (notify/Notifs.kt). */
    val notifs = NotifStore()

    /** What Buddy knows about the person, as the chat sees it: the memory on this phone (kept with the account too, signed in). */
    val facts: Facts get() = memory

    /** The signed-in person's first name, or "". */
    fun firstName(): String = account.user.value?.name?.trim()?.split(Regex("\\s+"))?.firstOrNull().orEmpty()

    /**
     * Lives as long as the process, like the objects above. The chat's work runs here, so that Buddy can finish putting
     * text in an app after the Fix with Buddy sheet has stepped out of its way (and closed).
     */
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** What Buddy knows, kept with the signed-in person's account: synced at start, at a sign-in and after changes. */
    val memorySyncer = MemorySyncer(memory, account.user, cloud::memory, scope)

    init {
        memorySyncer.start()
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
