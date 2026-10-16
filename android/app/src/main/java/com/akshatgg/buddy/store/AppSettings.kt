package com.akshatgg.buddy.store

import com.akshatgg.buddy.cloud.FreeSettings

enum class BuddySize(val id: String, val dp: Int) { SMALL("small", 44), MEDIUM("medium", 56), LARGE("large", 72) }

/**
 * Buddy's settings, the Mac's store.js on a phone: each one is a string in the key-value store, read fresh every time
 * so that two holders of the same store never disagree.
 */
class AppSettings(private val kv: KeyValue) {
    var onboarded: Boolean
        get() = flag("onboarded", false)
        set(v) = kv.putString("onboarded", v.toString())

    var buddyOn: Boolean
        get() = flag("buddyOn", false)
        set(v) = kv.putString("buddyOn", v.toString())

    var characterId: String
        get() = kv.getString("characterId")?.takeIf { id -> CHARACTERS.any { it.first == id } } ?: CHARACTERS[0].first
        set(v) = kv.putString("characterId", v)

    /** Cut to NAME_MAX when set; a blank name reads as the character's own, which follows a change of character. */
    var buddyName: String
        get() = kv.getString("buddyName")?.trim()?.takeIf { it.isNotEmpty() } ?: CHARACTERS.first { it.first == characterId }.second
        set(v) = kv.putString("buddyName", v.trim().take(NAME_MAX).ifEmpty { null })

    var size: BuddySize
        get() = BuddySize.entries.firstOrNull { it.id == kv.getString("size") } ?: BuddySize.MEDIUM
        set(v) = kv.putString("size", v.id)

    var provider: String
        get() = kv.getString("provider") ?: "anthropic"
        set(v) = kv.putString("provider", v)

    fun model(providerId: String): String? = kv.getString("model.$providerId")

    fun setModel(providerId: String, model: String) = kv.putString("model.$providerId", model)

    /** Which edge the head sits on. */
    var bubbleRight: Boolean
        get() = flag("bubbleRight", true)
        set(v) = kv.putString("bubbleRight", v.toString())

    /** The head's top as a fraction of the screen height. */
    var bubbleY: Float
        get() = (kv.getString("bubbleY")?.toFloatOrNull()?.takeIf { it.isFinite() } ?: 0.35f).coerceIn(0f, 1f)
        set(v) = kv.putString("bubbleY", (if (v.isFinite()) v.coerceIn(0f, 1f) else 0.35f).toString())

    /** Whether the panel (and the Fix sheet) fills the screen: the person's last pull on its handle, or its button. */
    var panelFull: Boolean
        get() = flag("panelFull", false)
        set(v) = kv.putString("panelFull", v.toString())

    /**
     * Whether Android's own "Allow notifications?" has been asked. Android stops asking after the person says no twice,
     * and a request then comes back refused at once: from then on only the phone's settings can allow them.
     */
    var notificationsAsked: Boolean
        get() = flag("notificationsAsked", false)
        set(v) = kv.putString("notificationsAsked", v.toString())

    /**
     * Fix where I type: "@buddy" (or the buddy's name) typed after some text in any app has Buddy rewrite it in place
     * (typing/TagFlow.kt). It needs Buddy can type for you (LookService) too.
     */
    var tagOn: Boolean
        get() = flag("tagOn", true)
        set(v) = kv.putString("tagOn", v.toString())

    /** Buddy can type for you was asked for (off to Android's Accessibility settings) and is not on yet. */
    var lookAsked: Boolean
        get() = flag("lookAsked", false)
        set(v) = kv.putString("lookAsked", v.toString())

    /**
     * "Listen for Hey <name>" (voice/WakeListener.kt): off until the person turns it on, with the app open. Never turned on
     * by anything else.
     */
    var wakeOn: Boolean
        get() = flag("wakeOn", false)
        set(v) = kv.putString("wakeOn", v.toString())

    /**
     * "Only my voice": after "Hey <name>" Buddy answers only the owner. The voice itself is not here: it is in its own
     * file (voice/MyVoice.kt), never in the settings.
     */
    var myVoiceOn: Boolean
        get() = flag("myVoiceOn", false)
        set(v) = kv.putString("myVoiceOn", v.toString())

    /**
     * Listening was on but the microphone could not be started (after a restart Android refuses it): the buddy says
     * "Tap me to listen again" until an app screen opens and starts it.
     */
    var wakeNeedsTap: Boolean
        get() = flag("wakeNeedsTap", false)
        set(v) = kv.putString("wakeNeedsTap", v.toString())

    /** The server's last answer about free mode, null when there is none. */
    var cloud: FreeSettings?
        get() = FreeSettings.fromJson(kv.getString("cloud"))
        set(v) = kv.putString("cloud", v?.toJson())

    private fun flag(key: String, default: Boolean): Boolean = when (kv.getString(key)) {
        "true" -> true
        "false" -> false
        else -> default
    }

    companion object {
        val CHARACTERS: List<Pair<String, String>> = listOf("boy-1" to "Aarav", "girl-1" to "Anaya")
        private const val NAME_MAX = 24
    }
}
