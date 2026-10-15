package com.akshatgg.buddy.voice

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/** A microphone as 16 kHz mono PCM16. */
interface PcmSource {
    fun start(): Boolean
    fun read(into: ShortArray): Int
    fun stop()
}

/** The phone's microphone for voice recognition. `start()` is false when it cannot record. */
class AudioRecordSource : PcmSource {
    private var record: AudioRecord? = null
    private var noise: NoiseSuppressor? = null
    private var echo: AcousticEchoCanceler? = null

    @Suppress("MissingPermission")
    override fun start(): Boolean {
        stop()
        return try {
            val min = AudioRecord.getMinBufferSize(Wav.RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
            val r = AudioRecord(
                MediaRecorder.AudioSource.VOICE_RECOGNITION, Wav.RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, max(min, 3200 * 2),
            )
            if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); return false }
            if (NoiseSuppressor.isAvailable()) noise = NoiseSuppressor.create(r.audioSessionId)?.also { it.enabled = true }
            if (AcousticEchoCanceler.isAvailable()) echo = AcousticEchoCanceler.create(r.audioSessionId)?.also { it.enabled = true }
            r.startRecording()
            record = r
            true
        } catch (_: SecurityException) {
            stop(); false
        } catch (_: IllegalStateException) {
            stop(); false
        }
    }

    override fun read(into: ShortArray): Int = record?.read(into, 0, into.size) ?: -1

    override fun stop() {
        runCatching { record?.stop() }
        runCatching { record?.release() }
        runCatching { noise?.release() }
        runCatching { echo?.release() }
        record = null; noise = null; echo = null
    }
}

/** How loud the first `n` samples are: their RMS, 0 to 1. */
fun levelOf(pcm: ShortArray, n: Int): Float {
    val count = min(n, pcm.size)
    if (count <= 0) return 0f
    var sum = 0.0
    for (i in 0 until count) { val s = pcm[i] / 32768.0; sum += s * s }
    return min(1.0, sqrt(sum / count)).toFloat()
}

object Wav {
    const val RATE = 16_000

    /** A mono 16-bit WAV: a 44-byte RIFF header and the first `n` samples. */
    fun of(pcm: ShortArray, n: Int = pcm.size): ByteArray {
        val count = min(n, pcm.size)
        val bytes = count * 2
        val b = ByteBuffer.allocate(44 + bytes).order(ByteOrder.LITTLE_ENDIAN)
        b.put("RIFF".toByteArray()).putInt(36 + bytes).put("WAVE".toByteArray())
        b.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(RATE).putInt(RATE * 2).putShort(2).putShort(16)
        b.put("data".toByteArray()).putInt(bytes)
        for (i in 0 until count) b.putShort(pcm[i])
        return b.array()
    }
}

/** The last `maxSamples` samples read; `from(sample)` counts samples since the first one ever added. */
class PcmKeeper(private val maxSamples: Int) {
    private val buf = ShortArray(maxSamples)
    private var total = 0L

    val size: Int get() = min(total, maxSamples.toLong()).toInt()

    fun add(pcm: ShortArray, n: Int) {
        for (i in 0 until min(n, pcm.size)) { buf[(total % maxSamples).toInt()] = pcm[i]; total++ }
    }

    fun all(): ShortArray = from(0)

    fun from(sample: Long): ShortArray {
        val start = max(sample, total - size)
        if (start >= total) return ShortArray(0)
        return ShortArray((total - start).toInt()) { buf[((start + it) % maxSamples).toInt()] }
    }
}
