package com.akshatgg.buddy.voice

import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractor
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import java.io.File

/** A speaker embedding (a voice as 192 numbers) for 16 kHz PCM16, or null when it can't be made. */
fun interface Embedder { fun embed(pcm: ShortArray): FloatArray? }

/**
 * sherpa-onnx on the device. Thin, with no logic worth a unit test: the instrumented SherpaEmbedderTest loads the real
 * model (tools/android-voice-check.sh). The audio is not kept or logged.
 */
class SherpaEmbedder(model: File) : Embedder, AutoCloseable {
    private val ex = SpeakerEmbeddingExtractor(null, SpeakerEmbeddingExtractorConfig(model = model.absolutePath, numThreads = 1))

    private var closed = false

    /** Null once closed: a check that was still waiting when the engine was replaced must not touch freed memory. */
    @Synchronized override fun embed(pcm: ShortArray): FloatArray? {
        if (closed) return null
        val stream = ex.createStream()
        try {
            stream.acceptWaveform(FloatArray(pcm.size) { pcm[it] / 32768f }, 16_000)
            stream.inputFinished()
            return if (ex.isReady(stream)) ex.compute(stream) else null
        } finally {
            stream.release()
        }
    }

    @Synchronized override fun close() { if (!closed) { closed = true; ex.release() } }
}

/**
 * The embedder is loaded ONCE for the whole process and reused (like SharedSpotters): `ready()` says the model file is
 * there; `generation()` changes when the file is replaced, which closes the old embedder and loads the new one on the next
 * use. A failed load is tried again next time.
 */
class SharedEmbedder(
    private val ready: () -> Boolean,
    private val generation: () -> Int,
    private val load: () -> Embedder,
) {
    private var loaded: Embedder? = null
    private var loadedGeneration = 0

    /** The embedder, loaded if it is not yet; null while the model file is not ready. */
    @Synchronized fun get(): Embedder? {
        if (!ready()) return null
        val now = generation()
        loaded?.let { if (loadedGeneration == now) return it }
        (loaded as? AutoCloseable)?.let { runCatching { it.close() } }
        loaded = null
        return load().also { loaded = it; loadedGeneration = now }
    }

    /** Loads the embedder now if the model is there; a failure is left for the check to find. */
    fun warm() { runCatching { get() } }

    @Synchronized fun close() {
        (loaded as? AutoCloseable)?.let { runCatching { it.close() } }
        loaded = null
    }
}
