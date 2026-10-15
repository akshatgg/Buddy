package com.akshatgg.buddy.voice

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

sealed interface WakeEvent {
    data object Woke : WakeEvent
    /** What was said after the wake, as a WAV; null when nothing was. */
    class Request(val wav: ByteArray?) : WakeEvent
}

/**
 * Listens to the microphone all the time for the wake phrase ("hey <name>") and nothing else: the recognizer runs on the
 * device over a grammar of the phrase and [unk], and nothing is sent anywhere. Only an exact final result that begins with
 * the phrase, each word at least `floor` sure, is a wake. The last 25 s are kept in memory only, so that a request said in
 * the same breath ("hey rahul call mom") is taken from where the phrase ended. After a wake the recognizer starts afresh.
 * Time is counted in samples. Used from one coroutine; the caller picks a thread that may block (Dispatchers.IO).
 */
class WakeListener(
    private val mic: () -> PcmSource,
    private val spotters: Spotters,
    private val phrase: String,
    private val floor: Float = VoiceWords.WAKE_FLOOR,
    private val paused: () -> Boolean = { false }, // a call, MicBus busy, a hands-free turn: the mic is let go of
    private val silenced: () -> Boolean = { false }, // another app records: the mic stays open (it reads zeros), nothing is fed
    private val testOnly: Boolean = false, // Settings' "Test it": a Woke for each wake, no request
) {
    private companion object {
        const val CHUNK = 1_600 // 100 ms
        const val KEEP_SAMPLES = 25 * Wav.RATE
        const val RETRY_MS = 5_000L
        const val PAUSED_MS = 1_000L
    }

    /** Listens until cancelled: each wake gives Woke, then (unless testOnly) Request with the WAV of what followed. */
    suspend fun run(on: suspend (WakeEvent) -> Unit) {
        val grammar = listOf(phrase, "[unk]")
        val chunk = ShortArray(CHUNK)
        var source: PcmSource? = null
        var spotter: Spotter? = null
        var kept = PcmKeeper(KEEP_SAMPLES)
        var total = 0L // samples read since the microphone started
        var spotterStart = 0L // where the recognizer began: its times count from there

        fun release() {
            runCatching { source?.stop() }
            runCatching { spotter?.close() }
            source = null; spotter = null
            kept = PcmKeeper(KEEP_SAMPLES); total = 0; spotterStart = 0
        }

        try {
            while (currentCoroutineContext().isActive) {
                if (paused()) { release(); delay(PAUSED_MS); continue }
                if (source == null) {
                    val m = mic()
                    if (!m.start()) { runCatching { m.stop() }; delay(RETRY_MS); continue }
                    source = m
                    spotter = spotters.make(grammar)
                }
                val live = source!!
                val n = live.read(chunk)
                if (n <= 0) { release(); delay(RETRY_MS); continue }
                if (silenced()) continue // a silenced client reads zeros: neither judged nor kept, and the mic is not restarted
                total += n
                kept.add(chunk, n)
                val final = spotter?.accept(chunk, n) ?: continue
                val wake = VoiceWords.wakeFrom(parseVosk(final), phrase, floor) ?: continue

                on(WakeEvent.Woke)
                if (testOnly) {
                    runCatching { spotter?.close() }
                    spotter = spotters.make(grammar); spotterStart = total
                    continue
                }
                val from = (spotterStart + (wake.endSec * Wav.RATE).toLong()).coerceIn(maxOf(0L, total - KEEP_SAMPLES), total)
                val wav = takeRequest(live, chunk, kept, from, total).let { (w, t) -> total = t; w }
                release()
                on(WakeEvent.Request(wav))
            }
        } finally {
            release()
        }
    }

    /** The request from `from` on: what is kept is judged first, then the microphone, until quiet. */
    private suspend fun takeRequest(mic: PcmSource, chunk: ShortArray, kept: PcmKeeper, from: Long, now: Long): Pair<ByteArray?, Long> {
        var total = now
        val end = SpeechEnd(VoiceWords.REQUEST_QUIET_MS, VoiceWords.REQUEST_NOTHING_MS, VoiceWords.REQUEST_MAX_MS)
        var state = End.LISTEN
        val old = kept.from(from)
        var i = 0
        while (i < old.size && state == End.LISTEN) {
            val len = minOf(CHUNK, old.size - i)
            state = end.feed(levelOf(old.copyOfRange(i, i + len), len), (i + len) / 16L)
            i += len
        }
        while (state == End.LISTEN && currentCoroutineContext().isActive) {
            val n = mic.read(chunk)
            if (n <= 0) break
            total += n
            kept.add(chunk, n)
            state = end.feed(levelOf(chunk, n), (total - from) / 16)
        }
        return (if (end.heardVoice) Wav.of(kept.from(from)) else null) to total
    }
}
