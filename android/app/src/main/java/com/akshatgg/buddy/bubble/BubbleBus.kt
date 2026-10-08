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
    data class Say(val text: String) : BubbleEvent
    data class HideFor(val ms: Long) : BubbleEvent
}

/**
 * How anything in the app reaches the floating buddy, from any thread, as the Mac's ui.mood() and ui.bubble() reach
 * its windows. BubbleService listens while it runs. With no buddy on screen an event goes nowhere: there is nobody to
 * show it.
 */
object BubbleBus {
    private val flow = MutableSharedFlow<BubbleEvent>(extraBufferCapacity = 16, onBufferOverflow = BufferOverflow.DROP_OLDEST)

    val events: SharedFlow<BubbleEvent> = flow.asSharedFlow()

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

    /** A few words in a speech bubble beside the head ("Copied — …"). */
    fun say(text: String) = send(BubbleEvent.Say(text))

    /** Hide the head for `ms`, so that it is not in a picture of the screen. */
    fun hideFor(ms: Long) = send(BubbleEvent.HideFor(ms))

    /** Never waits: a buddy that is slow to take an event must not hold up whoever sent it. */
    fun send(event: BubbleEvent) {
        flow.tryEmit(event)
    }
}
