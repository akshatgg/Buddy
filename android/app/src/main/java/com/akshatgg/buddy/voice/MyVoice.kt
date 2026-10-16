package com.akshatgg.buddy.voice

import android.util.Log
import java.io.File

/** What the settings need of the owner's voice. */
interface MyVoiceSettings {
    val on: Boolean
    fun profileUsable(): Boolean
    /** A take's embedding for setup: null when the clip is too short or too long, or the engine isn't ready. */
    fun embed(clip: ShortArray): FloatArray?
    fun save(profile: FloatArray)
    fun off()
}

/**
 * "Only my voice": the owner's voice, kept in `file` (filesDir/my-voice.json), and the check of a wake phrase against it.
 * The profile is written only there: never in the settings, never synced, never logged. Clips and embeddings are not
 * written anywhere; a log line says only "voice check: <code>".
 */
class MyVoice(
    private val file: File,
    private val spec: SpeakerModelSpec,
    private val embedder: () -> Embedder?,
    private val isOn: () -> Boolean,
    private val setOn: (Boolean) -> Unit,
    private val now: () -> String = { java.time.Instant.now().toString() },
) : MyVoiceSettings {
    override val on: Boolean get() = isOn()

    /** True when off. When on: the clip is long enough, the profile reads, and the embedding is the owner's. Never throws. */
    fun allows(clip: ShortArray?): Boolean {
        if (!isOn()) return true
        return try {
            when {
                clip == null || !longEnough(clip) -> { note("clip"); false }
                else -> {
                    val profile = readProfile() ?: run { note("profile"); return false }
                    val embedding = (embedder() ?: run { note("model"); return false }).embed(clip)
                    val me = MyVoiceRules.isMe(profile, embedding)
                    if (!me) note("no")
                    me
                }
            }
        } catch (_: Throwable) {
            note("error")
            false
        }
    }

    override fun profileUsable(): Boolean = readProfile() != null

    /** Saves a finished setup's profile (tmp file + rename) and turns it on. */
    override fun save(profile: FloatArray) {
        file.parentFile?.mkdirs()
        val tmp = File(file.path + ".tmp")
        tmp.writeText(MyVoiceRules.profileJson(profile, spec.sha256, now()))
        if (!tmp.renameTo(file)) { file.delete(); check(tmp.renameTo(file)) { "Couldn't save the voice" } }
        setOn(true)
    }

    /** Off: forgets the voice (deletes the file). */
    override fun off() {
        file.delete()
        File(file.path + ".tmp").delete()
        setOn(false)
    }

    override fun embed(clip: ShortArray): FloatArray? = try {
        if (!longEnough(clip)) null else embedder()?.embed(clip)
    } catch (_: Throwable) {
        note("error")
        null
    }

    private fun longEnough(clip: ShortArray) = clip.size in (MyVoiceRules.MIN_PHRASE_MS * 16)..(MyVoiceRules.MAX_PHRASE_MS * 16)

    private fun readProfile(): FloatArray? = runCatching { MyVoiceRules.readProfile(file.takeIf { it.isFile }?.readText(), spec) }.getOrNull()

    private fun note(code: String) { try { Log.i("Buddy", "voice check: $code") } catch (_: Throwable) {} }
}
