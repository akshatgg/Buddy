package com.akshatgg.buddy.voice

import android.util.Log
import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.File
import java.security.MessageDigest

/**
 * The voice-check model for "Only my voice": one .onnx file, downloaded once from Buddy's own release into `root`. The
 * download is thrown away unless its size and SHA-256 are the spec's; it is renamed to its name only then, and the
 * "<file>.ok" file holding the SHA-256 is written last. `download(url, file, progress)` is ApkInstaller::download.
 */
class SpeakerModelFile(
    private val root: File,
    private val spec: SpeakerModelSpec,
    private val download: suspend (String, File, (Long) -> Unit) -> Unit,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow<ModelState>(if (ready()) ModelState.Ready else ModelState.Missing)
    val state: StateFlow<ModelState> = _state

    private var running = false

    /** Counts the times the file was replaced: an engine loaded from an earlier file is stale. */
    @Volatile var generation = 0
        private set

    /** The file is there with the right size, and its ".ok" file holds the SHA-256 this app expects. */
    fun ready(): Boolean = runCatching {
        file().length() == spec.bytes && ok().readText().trim() == spec.sha256
    }.getOrDefault(false)

    fun file(): File = File(root, spec.file)

    private fun ok(): File = File(root, spec.file + ".ok")

    /** Download and check the model. Throws BuddyError("model_failed", …) and leaves nothing half-done. */
    suspend fun fetch() {
        if (ready()) { _state.value = ModelState.Ready; return }
        val part = File(root, spec.file + ".part")
        try {
            root.mkdirs()
            part.delete(); ok().delete(); file().delete()
            _state.value = ModelState.Getting(0)
            download(spec.url, part) { got ->
                if (spec.bytes > 0) _state.value = ModelState.Getting((got * 100 / spec.bytes).toInt().coerceIn(0, 100))
            }
            if (part.length() != spec.bytes || sha256(part) != spec.sha256) throw BuddyError("model_failed", "The voice check download was damaged.")
            if (!part.renameTo(file())) throw BuddyError("model_failed", "Couldn't save the voice check.")
            ok().writeText(spec.sha256)
            generation++
            _state.value = ModelState.Ready
        } catch (e: Throwable) {
            _state.value = ModelState.Failed
            if (e is kotlinx.coroutines.CancellationException) throw e
            file().delete(); ok().delete()
            throw e as? BuddyError ?: BuddyError("model_failed", "Couldn't get the voice check.")
        } finally {
            part.delete()
        }
    }

    /** fetch() in the background, one at a time; a failure is logged and the state says Failed. */
    fun fetchInBackground() {
        synchronized(this) { if (running) return; running = true }
        scope.launch {
            try {
                fetch()
            } catch (e: BuddyError) {
                try { Log.w("Buddy", "voice check model: ${e.code}") } catch (_: Throwable) {}
            } finally {
                synchronized(this@SpeakerModelFile) { running = false }
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
}
