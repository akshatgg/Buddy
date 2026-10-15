package com.akshatgg.buddy.voice

import android.util.Log
import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipInputStream

/** The model's name, where to get its zip, the zip's SHA-256 and its size in bytes (shared/voice-model.js). */
data class ModelSpec(val name: String, val url: String, val sha256: String, val bytes: Long)

/** Whether Buddy's ears are there: not yet, being downloaded (a percent), ready to use, or failed. */
sealed interface ModelState {
    data object Missing : ModelState
    data class Getting(val percent: Int) : ModelState
    data object Ready : ModelState
    data object Failed : ModelState
}

/**
 * Buddy's ears: the Vosk model, downloaded once from Buddy's own release into `root`. The zip is thrown away unless its
 * SHA-256 is `spec.sha256`; it is unpacked into `<name>.new` (an entry that would leave that folder is refused), that
 * folder is renamed to `<name>` only when every entry is out, and the "ok" file holding the SHA-256 is written last.
 * `download(url, file, progress)` writes a URL into a file, telling `progress` the bytes so far (ApkInstaller::download).
 */
class VoiceModel(
    private val root: File,
    private val spec: ModelSpec,
    private val download: suspend (String, File, (Long) -> Unit) -> Unit,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow<ModelState>(if (ready()) ModelState.Ready else ModelState.Missing)
    val state: StateFlow<ModelState> = _state

    private var running = false

    /** Counts the times the model's folder was replaced: a model loaded from an earlier folder is stale. */
    @Volatile var generation = 0
        private set

    /** The model's folder is there and its "ok" file holds the SHA-256 this app expects. */
    fun ready(): Boolean = runCatching { File(folder(), OK).readText().trim() == spec.sha256 }.getOrDefault(false)

    fun folder(): File = File(root, spec.name)

    /** Download, check and unpack the model. Throws BuddyError("model_failed", …) and leaves nothing half-done. */
    suspend fun fetch() {
        if (ready()) { _state.value = ModelState.Ready; return }
        val part = File(root, "${spec.name}.zip.part")
        val unpacked = File(root, "${spec.name}.new")
        try {
            root.mkdirs()
            part.delete(); unpacked.deleteRecursively()
            _state.value = ModelState.Getting(0)
            download(spec.url, part) { got ->
                if (spec.bytes > 0) _state.value = ModelState.Getting((got * 100 / spec.bytes).toInt().coerceIn(0, 100))
            }
            if (sha256(part) != spec.sha256) throw BuddyError("model_failed", "The voice model download was damaged.")
            unzip(part, unpacked)
            if (!File(unpacked, "${spec.name}/am/final.mdl").isFile && !File(unpacked, "am/final.mdl").isFile) {
                throw BuddyError("model_failed", "The voice model is incomplete.")
            }
            val target = folder()
            target.deleteRecursively()
            // The zip holds one top folder named like the model; that folder becomes <name>.
            val inner = File(unpacked, spec.name)
            if (!(if (inner.isDirectory) inner.renameTo(target) else unpacked.renameTo(target))) {
                throw BuddyError("model_failed", "Couldn't save the voice model.")
            }
            File(target, OK).writeText(spec.sha256)
            generation++
            _state.value = ModelState.Ready
        } catch (e: Throwable) {
            _state.value = ModelState.Failed
            if (e is kotlinx.coroutines.CancellationException) throw e
            folder().takeIf { !ready() }?.deleteRecursively()
            throw e as? BuddyError ?: BuddyError("model_failed", "Couldn't get the voice model.")
        } finally {
            part.delete()
            unpacked.deleteRecursively()
        }
    }

    /** fetch() in the background, one at a time; a failure is logged and the state says Failed. */
    fun fetchInBackground() {
        synchronized(this) { if (running) return; running = true }
        scope.launch {
            try {
                fetch()
            } catch (e: BuddyError) {
                try { Log.w("Buddy", "voice model: ${e.code}") } catch (_: Throwable) {}
            } finally {
                synchronized(this@VoiceModel) { running = false }
            }
        }
    }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) { val n = input.read(buf); if (n < 0) break; md.update(buf, 0, n) }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun unzip(zip: File, into: File) {
        into.mkdirs()
        val base = into.canonicalFile
        ZipInputStream(zip.inputStream().buffered()).use { zin ->
            while (true) {
                val entry = zin.nextEntry ?: break
                val name = entry.name
                if (name.startsWith("/") || name.startsWith("\\") || name.split('/', '\\').contains("..")) {
                    throw BuddyError("model_failed", "The voice model has a file in the wrong place.")
                }
                val out = File(base, name).canonicalFile
                if (!out.path.startsWith(base.path + File.separator)) {
                    throw BuddyError("model_failed", "The voice model has a file in the wrong place.")
                }
                if (entry.isDirectory) { out.mkdirs(); continue }
                out.parentFile?.mkdirs()
                out.outputStream().use { zin.copyTo(it) }
            }
        }
    }

    private companion object { const val OK = "ok" }
}
