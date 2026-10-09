package com.akshatgg.buddy.typing

import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.AskInput
import com.akshatgg.buddy.ai.providers.AI_TIMEOUT_MS
import com.akshatgg.buddy.bubble.Mood
import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

const val TAG_PAUSE_MS = 1200L // the pause after the last keystroke before Buddy rewrites
const val TAG_UNDO_MS = 15_000L // how long "Fixed ✅" can be tapped to put the old text back

// What Buddy says, in the Mac's words where it has them (src/main/tag.js).
const val TAG_FIXING = "Fixing it…"
const val TAG_FIXED = "Fixed ✅ Tap here to undo"
const val TAG_KEPT_TYPING = "You kept typing, so I left it."
const val TAG_NOTHING = "I couldn't rewrite that. Try again."
const val TAG_CANT_PUT = "I couldn't put it back in that box."
const val TAG_UNDONE = "Undone."
const val TAG_CHANGED_SINCE = "You changed it since, so I left it."

/** How the tag shows itself: the floating buddy's mood and words (BubbleBus). `onTap`, when given, is a tap on the words. */
interface TagShow {
    fun mood(mood: Mood)
    fun say(text: String, onTap: (() -> Unit)? = null)
}

/**
 * Buddy where you type, on Android: the person types in any app and ends with "@buddy" (or their buddy's name) and
 * what to do; when they pause, Buddy rewrites the paragraph the tag ends (Tag.splitAtTag) and puts it back in the same
 * box, in place of what they wrote, tag and all. As the Mac's src/main/tag.js, with the box read and set through
 * LookService (`box`, the chat's TypeIn) rather than copied and pasted.
 *
 * LookService tells it each change of a box's text (never a password box, never Buddy's own); `wanted` says whether
 * Buddy is on and Fix where I type is too. A change with a tag in it (re)starts a wait of `pauseMs`; one without
 * stops it. When the wait ends, the box is read again, and only a tag on the line the cursor is on counts: an older
 * tag further up is something the person left there, not a question. The AI is asked (Action.TAG) with that paragraph
 * only; its answer goes in only if the box still has exactly what was read, and "Fixed ✅" can then be tapped to put
 * the old text back. One at a time. Everything here runs on `scope`'s thread (the main one).
 */
class TagFlow(
    private val scope: CoroutineScope,
    private val box: TypeIn,
    private val ask: suspend (Action, AskInput) -> Answer,
    private val wanted: () -> Boolean,
    private val names: () -> List<String>,
    private val show: TagShow,
    private val pauseMs: Long = TAG_PAUSE_MS,
    private val undoMs: Long = TAG_UNDO_MS,
) {
    private var waiting: Job? = null
    private var busy = false
    // The text Buddy last put in a box: the change that makes is Buddy's own, not a tag typed (after an Undo the tag is
    // back in it, and Buddy must not start again by itself).
    private var written: String? = null
    private var undoable: Any? = null // the Fixed ✅ that can still be undone
    private var undoTimer: Job? = null

    /** The text of a box the person types in changed to `text` (LookService). */
    fun onTyped(text: CharSequence?) {
        if (busy) return
        val now = text?.toString().orEmpty()
        if (now == written) return
        // The quick look: most keystrokes have no "@" at all.
        if (!wanted() || '@' !in now || Tag.findTag(now, names()) == null) {
            if (wanted()) TagTrace.step(TagTrace.TYPING)
            stop()
            return
        }
        TagTrace.step(TagTrace.SAW_TAG)
        waiting?.cancel()
        waiting = scope.launch {
            delay(pauseMs)
            waiting = null
            fix()
        }
    }

    /** Stop waiting: the tag was deleted, or the service is going. */
    fun stop() {
        waiting?.cancel()
        waiting = null
    }

    private suspend fun fix() {
        if (busy || !wanted()) return
        val read = box.read() ?: return TagTrace.step(TagTrace.NO_BOX)
        val names = names()
        val tag = Tag.findTag(read.text, names) ?: return TagTrace.step(TagTrace.NO_BOX)
        // The cursor elsewhere: an old tag. Some apps say the cursor is at 0 (or nowhere) whatever it is: not known then.
        if (read.selEnd > 0 && read.selEnd !in tag.start..tag.end + 1) return TagTrace.step(TagTrace.ELSEWHERE)
        val split = Tag.splitAtTag(read.text, names) ?: return TagTrace.step(TagTrace.NOTHING_BEFORE)
        busy = true
        try {
            show.mood(Mood.THINKING)
            show.say(TAG_FIXING)
            TagTrace.step(TagTrace.ASKING)
            val answer = Tag.cleanAnswer(askTag(split).text)
            if (answer.isEmpty()) throw BuddyError("upstream", TAG_NOTHING)
            // Still what was read? Had they typed on meanwhile, their words would be lost.
            if (box.read()?.text != read.text) {
                show.mood(Mood.IDLE)
                show.say(TAG_KEPT_TYPING)
                return
            }
            val fixed = split.prefix + answer + split.suffix
            written = fixed
            if (!box.write(fixed, split.prefix.length + answer.length)) {
                TagTrace.step(TagTrace.NOT_PUT)
                throw BuddyError("failed", TAG_CANT_PUT)
            }
            TagTrace.step(TagTrace.FIXED)
            show.mood(Mood.HAPPY)
            offerUndo(read, fixed)
        } catch (e: CancellationException) {
            show.mood(Mood.IDLE)
            throw e
        } catch (e: BuddyError) {
            fail(e)
        } catch (e: Exception) {
            fail(BuddyError("failed", TAG_NOTHING))
        } finally {
            busy = false
        }
    }

    private suspend fun askTag(split: TagSplit): Answer = try {
        withTimeout(AI_TIMEOUT_MS.toLong()) { ask(Action.TAG, AskInput(text = split.target, instruction = split.instruction)) }
    } catch (e: TimeoutCancellationException) {
        throw BuddyError("timeout", "Buddy took too long to answer. Try again.")
    }

    /** As the panel: a buddy with no internet gets sleepy; any other failure is said, and the buddy calms down. */
    private fun fail(err: BuddyError) {
        if (err.message != TAG_CANT_PUT) TagTrace.step(TagTrace.FAILED)
        show.mood(if (err.code == "network" || err.code == "timeout") Mood.SLEEPY else Mood.IDLE)
        show.say(err.message?.ifEmpty { null } ?: TAG_NOTHING)
    }

    /** "Fixed ✅", which a tap undoes for `undoMs`: the old text back, if the box still has Buddy's. */
    private fun offerUndo(before: BoxText, fixed: String) {
        val mine = Any()
        undoable = mine
        undoTimer?.cancel()
        undoTimer = scope.launch {
            delay(undoMs)
            if (undoable === mine) undoable = null
        }
        show.say(TAG_FIXED) {
            if (undoable === mine) {
                undoable = null
                scope.launch { undo(before, fixed) }
            }
        }
    }

    private suspend fun undo(before: BoxText, fixed: String) {
        if (busy) return
        if (box.read()?.text != fixed) {
            show.say(TAG_CHANGED_SINCE)
            return
        }
        written = before.text
        val cursor = if (before.selEnd in 0..before.text.length) before.selEnd else before.text.length
        if (box.write(before.text, cursor)) {
            show.mood(Mood.IDLE)
            show.say(TAG_UNDONE)
        } else {
            show.say(TAG_CANT_PUT)
        }
    }
}
