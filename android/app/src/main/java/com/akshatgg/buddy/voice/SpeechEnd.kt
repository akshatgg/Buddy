package com.akshatgg.buddy.voice

enum class End { LISTEN, DONE, NOTHING, TOO_LONG }

/**
 * When listening ends, from how loud the microphone is: after `quietMs` of quiet that follows speech, after `nothingMs`
 * in which nothing was said, or at `maxMs`. A port of createVoiceTiming (src/renderer/panel/voice-timing.js). Feed it
 * each level with the time it was measured (ms since listening began). Once it has ended, it stays so.
 */
class SpeechEnd(private val quietMs: Long = 1_500, private val nothingMs: Long = 8_000, private val maxMs: Long = 60_000) {
    private var last = 0L // when the level before came
    private var speech = 0L // how long a voice was heard, all together
    private var lastVoice = 0L
    private var end: End? = null

    /** Only a voice heard this long in all is a voice; less is noise. */
    val heardVoice: Boolean get() = speech >= MIN_SPEECH_MS

    fun feed(level: Float, ms: Long): End {
        end?.let { return it }
        val loud = !level.isNaN() && level >= SPEECH_LEVEL
        if (loud) {
            speech += minOf(maxOf(0L, ms - last), LEVEL_SPAN_MS)
            lastVoice = ms
        }
        last = maxOf(last, ms)
        end = when {
            heardVoice && !loud && ms - lastVoice >= quietMs -> End.DONE
            ms >= maxMs -> End.TOO_LONG
            !heardVoice && !loud && ms >= nothingMs -> End.NOTHING // a word begun just now is heard out first
            else -> null
        }
        return end ?: End.LISTEN
    }

    companion object {
        const val SPEECH_LEVEL = 0.06f // a voice is at least this loud (the RMS, 0 to 1)
        const val MIN_SPEECH_MS = 300L
        // A level stands for the sound since the one before it, but for no more than this.
        const val LEVEL_SPAN_MS = 250L
    }
}
