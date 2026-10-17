package com.akshatgg.buddy.bubble

import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

/** What the rest of the app asks of the floating buddy. */
sealed interface BubbleEvent {
    data class SetMood(val mood: Mood) : BubbleEvent
    /** `onTap`, when given, is done by a tap on the words (Fix where I type's Undo); without it taps go through them. */
    data class Say(val text: String, val onTap: (() -> Unit)? = null) : BubbleEvent
    data class HideFor(val ms: Long) : BubbleEvent

    /** Look at this place on the screen (pixels): where the person types, from LookService. */
    data class LookAt(val x: Float, val y: Float) : BubbleEvent

    /** Look back to the front: the box lost the focus, or another window came up. */
    data object LookAway : BubbleEvent

    /** A hands-free answer (or its question) in the speech bubble, held until SpeechDone; null holds what is up. A tap opens that chat. */
    data class Speech(val text: String?) : BubbleEvent

    /** Buddy stopped speaking: the speech bubble goes VoiceWords.BUBBLE_HIDE_MS later. */
    data object SpeechDone : BubbleEvent
}

/**
 * How anything in the app reaches the floating buddy, from any thread, as the Mac's ui.mood() and ui.bubble() reach
 * its windows. BubbleService listens while it runs. With no buddy on screen an event goes nowhere: there is nobody to
 * show it.
 */
object BubbleBus {
    private val flow = MutableSharedFlow<BubbleEvent>(extraBufferCapacity = 16, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    val events: SharedFlow<BubbleEvent> = flow.asSharedFlow()

    /** True while a buddy is on screen to take events: LookService does no work for a buddy that is not there. */
    val listening: Boolean get() = flow.subscriptionCount.value > 0

    private val wakeFlow = MutableSharedFlow<Unit>(extraBufferCapacity = 8, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    /** Each "Hey <name>" heard while Settings' Test it runs. */
    val wakes: SharedFlow<Unit> = wakeFlow.asSharedFlow()

    fun woke() { wakeFlow.tryEmit(Unit) }

    private val notYouFlow = MutableSharedFlow<Unit>(extraBufferCapacity = 8, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    /** Each "Hey <name>" heard while Test it runs that "Only my voice" turned away: it was not the owner. */
    val notYou: SharedFlow<Unit> = notYouFlow.asSharedFlow()

    fun notYou() { notYouFlow.tryEmit(Unit) }

    private val clipFlow = MutableSharedFlow<ShortArray?>(extraBufferCapacity = 8, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    /** The audio of each wake phrase heard while "Only my voice" is being set up (null: too short). Never stored or logged. */
    val clips: SharedFlow<ShortArray?> = clipFlow.asSharedFlow()

    fun clip(phrase: ShortArray?) { clipFlow.tryEmit(phrase) }

    private val sheets = mutableSetOf<Any>()
    private val anySheet = MutableStateFlow(false)

    /**
     * True while a sheet (the panel or a Fix sheet) is on screen. The head steps out of its way, since it would cover
     * the card and take its taps, and comes back when the last one goes: a Fix can open over the panel, from its own
     * text box. A state rather than an event, so that a buddy that starts meanwhile knows it too.
     */
    val sheetOpen: StateFlow<Boolean> = anySheet.asStateFlow()

    /**
     * A sheet is on screen. `sheet` is what it keeps through a turn of the phone (its ViewModel), so that the sheet made
     * again then is the same one, not a second.
     */
    fun sheetShown(sheet: Any) = synchronized(sheets) {
        sheets += sheet
        anySheet.value = true
    }

    fun sheetGone(sheet: Any) = synchronized(sheets) {
        sheets -= sheet
        anySheet.value = sheets.isNotEmpty()
    }

    fun mood(m: Mood) = send(BubbleEvent.SetMood(m))

    /**
     * A few words in a speech bubble beside the head ("Copied — …"). With `onTap` the bubble can be tapped, which does
     * it and closes the bubble, and it stays up longer for it.
     */
    fun say(text: String, onTap: (() -> Unit)? = null) = send(BubbleEvent.Say(text, onTap))

    /** Hide the head for `ms`, so that it is not in a picture of the screen. */
    fun hideFor(ms: Long) = send(BubbleEvent.HideFor(ms))

    /**
     * Look where the person types, at (x, y) on the screen in pixels. It only turns the head: a head hidden for a
     * sheet stays hidden.
     */
    fun lookAt(x: Float, y: Float) = send(BubbleEvent.LookAt(x, y))

    fun lookAway() = send(BubbleEvent.LookAway)

    /** Never waits: a buddy that is slow to take an event must not hold up whoever sent it. */
    fun send(event: BubbleEvent) {
        flow.tryEmit(event)
    }
}
