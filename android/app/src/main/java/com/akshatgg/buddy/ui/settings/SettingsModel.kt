package com.akshatgg.buddy.ui.settings

import android.util.Log
import com.akshatgg.buddy.account.Account
import com.akshatgg.buddy.account.User
import com.akshatgg.buddy.cloud.CloudClient
import com.akshatgg.buddy.cloud.FreeSettings
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.BuddySize
import com.akshatgg.buddy.store.Fact
import com.akshatgg.buddy.store.Memory
import com.akshatgg.buddy.typing.Tag
import com.akshatgg.buddy.ui.common.Status
import com.akshatgg.buddy.ui.common.Tone
import com.akshatgg.buddy.ui.common.failure
import com.akshatgg.buddy.voice.ModelState
import com.akshatgg.buddy.voice.MyVoiceRules
import com.akshatgg.buddy.voice.MyVoiceSettings
import com.akshatgg.buddy.voice.Setup
import com.akshatgg.buddy.voice.SpeakerModelFile
import com.akshatgg.buddy.voice.VoiceModel
import com.akshatgg.buddy.voice.VoiceWords
import com.akshatgg.buddy.voice.WakeRules
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val NAME_MAX = 24
private const val FADE_AFTER_MS = 3000L // how long a success ("Saved ✓") is shown before it goes

// The desktop's words (src/main/ipc/settings.js) when a fact typed into Settings → Memory is not kept.
private const val CANT_SAVE = "I can't save that. Passwords, PINs, OTPs and long numbers are never saved."
private const val KNOWN_ALREADY = "I already know that."
private const val MIC_REFUSED = VoiceWords.WakeLines.MIC_NEEDED
private const val TEST_MS = 10_000L
private const val WAKE_DEBOUNCE_MS = 600L // typing in the name box: the phrase is looked at again this long after the last key

/** Where a status line is: under the account, under the Buddy card, or under What Buddy knows about you. */
enum class Line { ACCOUNT, BUDDY, MEMORY }

/**
 * What Fix where I type says under its switch: the tags the person can type, which are "@buddy" and their buddy's own
 * name when it is one word (Tag.tagNames). `name` is the name box as typed; blank, it is the buddy's own.
 */
internal fun tagExplanation(name: String, characterId: String): String {
    val own = name.trim().ifEmpty { AppSettings.CHARACTERS.firstOrNull { it.first == characterId }?.second.orEmpty() }
    val names = Tag.tagNames(own)
    val tags = if (names.size > 1) "@buddy (or @${names[1]})" else "@buddy"
    return "Type $tags after your text, and Buddy rewrites it in place. Add what you want: @buddy formal, @buddy shorter."
}

/** Forget everything asks once more first, as the desktop does. */
/**
 * Whether Android may block Buddy can type for you ("Restricted setting"): from Android 13 it does for an app that did
 * not come from an app store, until the person allows restricted settings on the app's App info page, once.
 */
internal fun mayBeRestricted(sdk: Int, installer: String?): Boolean = sdk >= 33 && installer != PLAY_STORE

private const val PLAY_STORE = "com.android.vending"

/** What to do in Android's Accessibility settings, said before they open; with what to do if Android blocks it. */
internal fun lookSteps(mayBeBlocked: Boolean): String {
    val steps = "Next: tap Downloaded apps (or Installed apps), then Buddy can type for you, and turn it on."
    return if (mayBeBlocked) "$steps If Android says \"Restricted setting\", come back here: Buddy shows you how to unlock it, once." else steps
}

/** How to unlock Buddy can type for you once Android has blocked it ("Restricted setting"), on Buddy's App info page. */
internal val UNLOCK_STEPS = listOf(
    "Tap Open App info below.",
    "Tap ⋮ at the top right, then Allow restricted settings, and confirm. (Not there? Tap Buddy once in Accessibility first.)",
    "Come back here, tap Turn on, and switch Buddy on.",
)

internal fun forgetAllQuestion(n: Int): String = if (n == 1) "Forget the 1 thing?" else "Forget all $n things?"

/** Where the facts are kept, under What Buddy knows about you: with the account when signed in, else on this phone. */
internal fun memoryWhere(signedIn: Boolean): String =
    if (signedIn) {
        "Buddy learns these from your chats. They're saved to your account, so your other devices with the same sign-in know them too."
    } else {
        "Buddy learns these from your chats. They stay on this phone."
    }

/** What Forget everything forgets: signed in, on the person's other devices too. */
internal fun forgetAllWhat(signedIn: Boolean): String =
    if (signedIn) {
        "Buddy will forget everything it knows about you, on this phone and on your other devices with the same sign-in."
    } else {
        "Buddy will forget everything it knows about you on this phone."
    }

/**
 * What Settings shows besides the account and free mode (which come from their own flows). `name` is the name box as
 * typed: what is saved is trimmed, and a blank one is the buddy's own.
 */
data class SettingsState(
    val characterId: String,
    val name: String,
    val size: BuddySize,
    val buddyOn: Boolean,
    /** Look where I type: whether its Accessibility service is on in Android's settings. */
    val lookOn: Boolean = false,
    /** Turn on was asked for and it is still off, on a phone where Android may block it: how to unlock it shows. */
    val lookBlocked: Boolean = false,
    /** Android may block it on this phone (mayBeRestricted): Turn on says what to do if it does. */
    val lookMayBeBlocked: Boolean = false,
    /** Fix where I type (@buddy). */
    val tagOn: Boolean = true,
    val signingIn: Boolean = false,
    /** Learn about me from chats. */
    val learning: Boolean = true,
    /** Memory's add box, as typed. */
    val newFact: String = "",
    /** Forget everything is asking "Forget all N things?". */
    val forgetAsked: Boolean = false,
    val lines: Map<Line, Status> = emptyMap(),
    /** Listen for "Hey <name>" (voice/WakeListener.kt): off until the person turns it on. */
    val wakeOn: Boolean = false,
    /** What it says under the switch: the model download, signed out, the microphone refused. */
    val wakeLine: Status? = null,
    /** Test it is running (10 s), and how many wakes it heard. */
    val wakeTesting: Boolean = false,
    val wakeHeard: Int = 0,
    /** "Hey <name>" wakes it too (the model can hear the name, and it is not Buddy); else only "Hey Buddy" does. */
    val wakeNameHeard: Boolean = true,
    /** On and the model is there: it is listening (for "Hey Buddy" at least), so a hint shows under the switch. */
    val wakeListening: Boolean = false,
    /** Only my voice (voice/MyVoice.kt): on, i.e. Buddy answers only the owner. */
    val myVoiceOn: Boolean = false,
    /** What it says under the switch: the setup's steps, "On", or that the voice needs setting up again. */
    val myVoiceLine: Status? = null,
    /** The model is being fetched or the person is saying "Hey <name>" for it: Set up again waits. */
    val myVoiceSetting: Boolean = false,
)

/**
 * Settings' state, as the Mac's settings.js: every change is saved at once and said on its card's line. A success
 * fades after a few seconds; anything else (an error, a wait) stays until the line is used again. `lookEnabled` says
 * whether Look where I type is on in Android's Accessibility settings, which only Android changes: it is read again
 * each time Settings comes back. `syncMemory` syncs what Buddy knows with the account (MemorySyncer.request), out of
 * the way, each time Settings is shown.
 */
class SettingsModel(
    private val account: Account,
    private val cloud: CloudClient,
    private val settings: AppSettings,
    private val memory: Memory,
    private val scope: CoroutineScope,
    private val lookEnabled: () -> Boolean = { false },
    private val syncMemory: () -> Unit = {},
    private val lookMayBeBlocked: Boolean = false,
    private val voiceModel: VoiceModel? = null,
    private val wakeChanged: () -> Unit = {}, // the switch or the name changed: the service listens, or stops
    private val micAllowed: () -> Boolean = { true },
    private val modelMissing: () -> Set<String> = { emptySet() }, // words the model cannot hear (shared voiceModelMissing)
    /**
     * Test it: runs a `testOnly` listener for the given ms, calling the second argument for each wake heard, and the third
     * for each one that "Only my voice" turned away.
     */
    private val test: suspend (Long, () -> Unit, () -> Unit) -> Unit = { ms, _, _ -> delay(ms) },
    private val speakerModel: SpeakerModelFile? = null,
    private val myVoice: MyVoiceSettings? = null,
    /**
     * Setup: listens for `phrase` for `ms`, calling the last argument with each phrase's audio (null when too short). The
     * audio is not kept anywhere.
     */
    private val collectClips: suspend (phrase: String, ms: Long, onClip: suspend (ShortArray?) -> Unit) -> Unit = { _, ms, _ -> delay(ms) },
    private val heavy: CoroutineContext = Dispatchers.Default, // where a voice is worked out
) {
    val user: StateFlow<User?> = account.user
    val free: StateFlow<FreeSettings?> = cloud.free

    /** What Buddy knows about the person, oldest first, as the chat learns it and Settings changes it. */
    val facts: StateFlow<List<Fact>> = memory.changes

    private val current = MutableStateFlow(read(name = settings.buddyName))
    val state: StateFlow<SettingsState> = current.asStateFlow()
    private val fading = mutableMapOf<Line, Job>()

    // Buddy on was asked for while it could not float: it comes on once "Display over other apps" is allowed.
    private var waitingToFloat = false

    private fun read(name: String): SettingsState {
        val lookOn = lookEnabled()
        if (lookOn && settings.lookAsked) settings.lookAsked = false
        return SettingsState(
            characterId = settings.characterId,
            name = name,
            size = settings.size,
            buddyOn = settings.buddyOn,
            lookOn = lookOn,
            lookBlocked = !lookOn && lookMayBeBlocked && settings.lookAsked,
            lookMayBeBlocked = lookMayBeBlocked,
            tagOn = settings.tagOn,
            learning = memory.learning,
            wakeOn = settings.wakeOn,
            wakeNameHeard = WakeRules.nameHeard(settings.buddyName, modelMissing()),
            wakeListening = settings.wakeOn && voiceModel?.ready() != false,
            myVoiceOn = settings.myVoiceOn,
            myVoiceLine = restingMyVoiceLine(),
        )
    }

    /** What stands under Only my voice when no setup is running: nothing when off, "On", or that it needs setting up again. */
    private fun restingMyVoiceLine(): Status? = when {
        !settings.myVoiceOn -> null
        // the voice is there but cannot be used: its file is damaged, or the voice-check model is gone or damaged
        myVoice?.profileUsable() == false || speakerModel?.ready() == false -> Status(MyVoiceRules.Lines.SET_UP_AGAIN, Tone.ERROR)
        else -> Status(MyVoiceRules.Lines.ON)
    }

    /** Turn on's Continue: off to Android's Accessibility settings. Back with it still off, how to unlock it shows. */
    fun lookAsked() {
        settings.lookAsked = true
    }

    fun say(line: Line, status: Status?) {
        fading.remove(line)?.cancel()
        current.update { it.copy(lines = if (status == null) it.lines - line else it.lines + (line to status)) }
        if (status?.tone != Tone.GOOD) return
        fading[line] = scope.launch {
            delay(FADE_AFTER_MS)
            current.update { it.copy(lines = it.lines - line) }
        }
    }

    /**
     * Coming back to Settings: Buddy may have been turned off meanwhile (from its notification, or on the ✕), and Look
     * where I type turned on or off in Android's settings. What is being typed in the name box and the add box stays.
     */
    fun reload() = current.update {
        read(name = it.name).copy(
            signingIn = it.signingIn, newFact = it.newFact, forgetAsked = it.forgetAsked, lines = it.lines,
            wakeLine = it.wakeLine, wakeTesting = it.wakeTesting, wakeHeard = it.wakeHeard,
            myVoiceSetting = it.myVoiceSetting,
            // a setup in progress keeps its line; one that went wrong keeps what it said until the next thing the person does
            myVoiceLine = if (it.myVoiceSetting) it.myVoiceLine else keptSetupLine ?: restingMyVoiceLine(),
        )
    }

    /** The admin may have changed free mode since the app last asked. A failure is only logged: the last known settings show. */
    fun refreshFree() {
        if (!account.isSignedIn()) return
        scope.launch {
            try {
                cloud.settings(force = true)
            } catch (e: BuddyError) {
                Log.w("Buddy", "could not fetch the free settings: ${e.code}")
            }
        }
    }

    fun signIn(run: suspend () -> Unit) {
        if (current.value.signingIn) return
        current.update { it.copy(signingIn = true) }
        say(Line.ACCOUNT, null)
        scope.launch {
            try {
                run()
                say(Line.ACCOUNT, Status("Signed in ✓", Tone.GOOD))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                say(Line.ACCOUNT, failure(e, "sign-in"))
            } finally {
                current.update { it.copy(signingIn = false) }
            }
        }
    }

    /** Signing out forgets the free-mode settings too, so that the next person does not inherit them. */
    fun signOut() {
        account.signOut()
        cloud.forget()
        say(Line.ACCOUNT, Status("Signed out."))
    }

    /** Fix where I type: "@buddy" after some text, in any app, has Buddy rewrite it there. */
    fun setTagOn(on: Boolean) {
        settings.tagOn = on
        current.update { it.copy(tagOn = on) }
        say(Line.BUDDY, Status("Saved ✓", Tone.GOOD))
    }

    /** Another buddy; false when it is the one already chosen. */
    fun pick(characterId: String): Boolean {
        if (characterId == current.value.characterId) return false
        settings.characterId = characterId
        current.update { it.copy(characterId = settings.characterId) }
        say(Line.BUDDY, Status("Saved ✓", Tone.GOOD))
        return true
    }

    /** Saved as it is typed, so that nothing is lost when the screen is left. */
    fun setName(name: String) {
        val cut = name.take(NAME_MAX)
        settings.buddyName = cut
        // Which copy applies follows the name at once (the label, Test it's words), even with the switch off.
        current.update { it.copy(name = cut, wakeNameHeard = WakeRules.nameHeard(cut, modelMissing())) }
        // The phrase is looked at again once the typing stops, not at each key; an empty box is left alone (it would
        // show the default name's line while the person is still typing).
        renameCheck?.cancel()
        if (!settings.wakeOn || cut.isBlank()) return
        renameCheck = scope.launch {
            delay(WAKE_DEBOUNCE_MS)
            if (settings.wakeOn) checkWake()
        }
    }

    fun setSize(size: BuddySize) {
        settings.size = size
        current.update { it.copy(size = size) }
        say(Line.BUDDY, Status("Saved ✓", Tone.GOOD))
    }

    /**
     * Buddy on or off; true when it changed. On needs "Display over other apps": without it nothing changes, the line
     * says why, and Buddy comes on by itself once it is allowed (see resumed).
     */
    fun setBuddyOn(on: Boolean, canFloat: Boolean): Boolean {
        waitingToFloat = on && !canFloat
        if (waitingToFloat) {
            say(Line.BUDDY, Status("Let Buddy float: allow Display over other apps.", Tone.ERROR))
            return false
        }
        settings.buddyOn = on
        current.update { it.copy(buddyOn = on) }
        say(Line.BUDDY, null)
        return true
    }

    /** Back on Settings: true when Buddy was waiting for "Display over other apps", has it now, and has come on. */
    fun resumed(canFloat: Boolean): Boolean {
        reload()
        if (!waitingToFloat || !canFloat) return false
        return setBuddyOn(true, canFloat = true)
    }

    // ---- Listen for "Hey <name>" ----

    private var fetching: Job? = null
    private var testing: Job? = null
    private var renameCheck: Job? = null

    /**
     * The switch. Only turned on from Settings (the app is open); it goes back off when the microphone is refused or
     * nobody is signed in. Without the model, it is fetched first (36 MB); then the name is checked against it.
     */
    fun setWakeOn(on: Boolean) {
        if (!on) {
            fetching?.cancel(); testing?.cancel(); renameCheck?.cancel(); setupJob?.cancel()
            settings.wakeOn = false
            current.update { it.copy(wakeOn = false, wakeLine = null, wakeTesting = false, wakeListening = false, myVoiceSetting = false, myVoiceLine = restingMyVoiceLine()) }
            wakeChanged()
            return
        }
        val refusal = when {
            !micAllowed() -> Status(MIC_REFUSED, Tone.ERROR)
            !account.isSignedIn() -> Status(VoiceWords.WakeLines.SIGN_IN, Tone.ERROR)
            else -> null
        }
        if (refusal != null) {
            settings.wakeOn = false
            current.update { it.copy(wakeOn = false, wakeLine = refusal, wakeListening = false) }
            return
        }
        settings.wakeOn = true
        current.update { it.copy(wakeOn = true, wakeLine = null) }
        val model = voiceModel
        if (model == null || model.ready()) return checkWake()
        current.update { it.copy(wakeLine = Status(VoiceWords.WakeLines.GETTING_EARS)) }
        fetching?.cancel()
        fetching = scope.launch {
            try {
                model.fetch()
                if (settings.wakeOn) checkWake()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                settings.wakeOn = false
                current.update { it.copy(wakeOn = false, wakeListening = false, wakeLine = Status(VoiceWords.WakeLines.EARS_FAILED, Tone.ERROR)) }
            }
        }
    }

    /**
     * With the model there: listening begins (again, after a rename), for "Hey Buddy" and, when the model can hear the name,
     * "Hey <name>"; a name it cannot hear is only a hint under the switch.
     */
    private fun checkWake() {
        current.update { it.copy(wakeNameHeard = WakeRules.nameHeard(settings.buddyName, modelMissing()), wakeListening = true, wakeLine = null) }
        wakeChanged()
    }

    /** Test it: for 10 s each wake heard is counted, and nothing is asked of the chat. */
    fun testWake() {
        if (current.value.wakeTesting || !settings.wakeOn) return
        val name = settings.buddyName
        val heard = current.value.wakeNameHeard
        current.update { it.copy(wakeTesting = true, wakeHeard = 0, wakeLine = Status(VoiceWords.WakeLines.sayNow(name, heard))) }
        testing = scope.launch {
            var turnedAway = 0 // wakes that Only my voice said were not the owner
            try {
                test(TEST_MS, {
                    current.update { it.copy(wakeHeard = it.wakeHeard + 1, wakeLine = Status(VoiceWords.WakeLines.HEARD, Tone.GOOD)) }
                }, {
                    turnedAway++
                    current.update { it.copy(wakeLine = Status(MyVoiceRules.Lines.NOT_YOU, Tone.ERROR)) }
                })
                current.update {
                    it.copy(
                        wakeTesting = false,
                        wakeLine = when {
                            it.wakeHeard > 0 -> null
                            turnedAway > 0 -> Status(MyVoiceRules.Lines.NOT_YOU, Tone.ERROR) // heard, but not you
                            else -> Status(VoiceWords.WakeLines.notHeard(name, heard), Tone.ERROR)
                        },
                    )
                }
            } catch (e: CancellationException) {
                current.update { it.copy(wakeTesting = false) }
                throw e
            }
        }
    }

    // ---- Only my voice ----

    private var setupJob: Job? = null

    /** The last setup's error, kept across reload() until the person turns the switch on or off or sets up again. */
    private var keptSetupLine: Status? = null

    /** A setup that did not finish (or finished): the line says how, the switch stops waiting. */
    private fun setupEnded(status: Status) {
        keptSetupLine = status.takeIf { it.tone == Tone.ERROR }
        current.update { it.copy(myVoiceSetting = false, myVoiceLine = status) }
    }

    /** Settings was left: a setup that is still listening stops (the microphone goes back to the normal phrases). */
    fun leaveSettings() {
        setupJob?.cancel()
    }

    private fun myVoiceSays(status: Status) = current.update { it.copy(myVoiceLine = status) }

    /** The name said in setup's lines: the one shown on the switch when the model can hear it, else Buddy. */
    private fun setupName(): String =
        if (current.value.wakeNameHeard) settings.buddyName.trim().replace(Regex("^(?i)hey\\s+"), "").ifEmpty { "Buddy" } else "Buddy"

    /**
     * The switch. On: the model is fetched if needed, then the person says "Hey <name>" five times and the voice is kept on
     * this phone; the switch is on only when that worked. Off: the voice is forgotten. Only while listening for Hey <name>.
     */
    fun setMyVoiceOn(on: Boolean) {
        if (!on) {
            setupJob?.cancel()
            keptSetupLine = null
            myVoice?.off()
            settings.myVoiceOn = false
            current.update { it.copy(myVoiceOn = false, myVoiceLine = null, myVoiceSetting = false) }
            wakeChanged()
            return
        }
        if (!settings.wakeOn || !current.value.wakeListening) return
        setUpMyVoice()
    }

    /** Set up again: the same, and the old voice stays (and stays on) until the new one is learnt. */
    fun redoMyVoice() {
        if (!settings.wakeOn || !current.value.wakeListening) return
        setUpMyVoice()
    }

    private fun setUpMyVoice() {
        val voice = myVoice ?: return
        if (current.value.myVoiceSetting) return
        keptSetupLine = null
        current.update { it.copy(myVoiceSetting = true) }
        setupJob = scope.launch {
            var finished = false // done or failed: the clips are no longer wanted
            try {
                val model = speakerModel
                if (model != null && !model.ready()) {
                    myVoiceSays(Status(MyVoiceRules.Lines.GETTING_MODEL)) // shown under the switch, with the percent as it comes
                    val percent = launch {
                        model.state.collect { st ->
                            if (st is ModelState.Getting && st.percent > 0) myVoiceSays(Status("${MyVoiceRules.Lines.GETTING_MODEL} ${st.percent}%"))
                        }
                    }
                    try {
                        model.fetch()
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        setupEnded(Status(MyVoiceRules.Lines.MODEL_FAILED, Tone.ERROR))
                        return@launch
                    } finally {
                        percent.cancel()
                    }
                }
                val name = setupName()
                val phrase = MyVoiceRules.setupPhrase(settings.buddyName, modelMissing())
                myVoiceSays(Status(MyVoiceRules.Lines.start(name)))
                val setup = Setup()
                try {
                    coroutineScope {
                        val here = this
                        collectClips(phrase, MyVoiceRules.SETUP_MS) { clip ->
                            val embedding = clip?.let { withContext(heavy) { voice.embed(it) } }
                            val step = setup.add(embedding)
                            when (step.step) {
                                "more" -> myVoiceSays(Status(MyVoiceRules.Lines.got(step.count), Tone.GOOD))
                                "again" -> myVoiceSays(Status(MyVoiceRules.Lines.again(name), Tone.ERROR))
                                "odd" -> myVoiceSays(Status(MyVoiceRules.Lines.odd(name), Tone.ERROR))
                                "done" -> {
                                    finished = true
                                    val saved = try {
                                        voice.save(step.profile!!); true
                                    } catch (e: Exception) { // the voice could not be written: not learnt
                                        Log.w("Buddy", "voice save: ${e.javaClass.simpleName}")
                                        false
                                    }
                                    if (saved) {
                                        settings.myVoiceOn = true
                                        current.update { it.copy(myVoiceOn = true) }
                                        setupEnded(Status(MyVoiceRules.Lines.DONE, Tone.GOOD))
                                    } else {
                                        setupEnded(Status(MyVoiceRules.Lines.FAILED, Tone.ERROR))
                                    }
                                    here.cancel("done")
                                }
                                else -> { // "failed"
                                    finished = true
                                    setupEnded(Status(MyVoiceRules.Lines.FAILED, Tone.ERROR))
                                    here.cancel("done")
                                }
                            }
                        }
                    }
                } catch (e: CancellationException) {
                    if (!finished) throw e
                }
                if (!finished) { // the time is up
                    setupEnded(Status(MyVoiceRules.Lines.TIMED_OUT, Tone.ERROR))
                }
                wakeChanged()
            } catch (e: CancellationException) {
                current.update { it.copy(myVoiceSetting = false) }
                throw e
            }
        }
    }

    // ---- What Buddy knows about you ----

    /**
     * Settings is shown: what Buddy knows is synced with the account, so that a fact learnt on another device shows
     * here (the list follows Memory.changes). Signed out, or with no internet, nothing changes.
     */
    fun memoryShown() = syncMemory()

    /** The add box, cut where a fact must end (the desktop's maxlength). */
    fun setNewFact(text: String) = current.update { it.copy(newFact = text.take(memory.rules.maxFactChars)) }

    /**
     * Add: the fact in the box is kept, even with learning off, since the person typed it; true when it was. A secret,
     * or a fact already known, is refused in the desktop's words and stays in the box to change.
     */
    fun addFact(): Boolean {
        val text = current.value.newFact.trim()
        if (text.isEmpty()) return false
        val refusal = when {
            memory.rules.cleanFact(text) == null -> CANT_SAVE
            memory.add(text, "settings") == null -> KNOWN_ALREADY
            else -> null
        }
        if (refusal != null) {
            say(Line.MEMORY, Status(refusal, Tone.ERROR))
            return false
        }
        current.update { it.copy(newFact = "") }
        say(Line.MEMORY, Status("Saved ✓", Tone.GOOD))
        return true
    }

    /** ✕ on a fact. One gone already (the chat's Undo) changes nothing. */
    fun forgetFact(id: String) {
        memory.remove(id)
        say(Line.MEMORY, null)
    }

    /** Forget everything: asks first, and only when there is something to forget. */
    fun askForgetAll() {
        if (memory.facts().isEmpty()) return
        current.update { it.copy(forgetAsked = true) }
        say(Line.MEMORY, null)
    }

    fun cancelForgetAll() = current.update { it.copy(forgetAsked = false) }

    fun forgetAll() {
        memory.clear()
        current.update { it.copy(forgetAsked = false) }
        say(Line.MEMORY, Status("Buddy forgot everything.", Tone.GOOD))
    }

    /** Learn about me from chats. Off, the chat saves nothing new, and Buddy still uses what it knows. */
    fun setLearning(on: Boolean) {
        memory.learning = on
        current.update { it.copy(learning = on) }
        say(Line.MEMORY, Status("Saved ✓", Tone.GOOD))
    }
}
