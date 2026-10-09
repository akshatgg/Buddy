package com.akshatgg.buddy.typing

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * What Fix where I type last saw, in plain words, for Settings to show under it: the app the person typed in and how
 * far Buddy got there ("Telegram · saw @buddy, couldn't read the box"). When @buddy does nothing in some app, this says
 * where it stopped. Only the app's name and the step: never the text.
 */
object TagTrace {
    private val state = MutableStateFlow<String?>(null)
    val last: StateFlow<String?> = state.asStateFlow()

    private var app: String? = null

    /** The person typed in `appName`'s box (null: not known). */
    fun typedIn(appName: String?) {
        app = appName
    }

    /** How far Buddy got, for the app last typed in. */
    fun step(words: String) {
        state.value = listOfNotNull(app, words).joinToString(" · ")
    }

    // The steps, in the words Settings shows.
    const val TYPING = "typing seen, no @buddy yet"
    const val SAW_TAG = "saw @buddy, waiting for the pause"
    const val NO_BOX = "saw @buddy, couldn't read the box"
    const val ELSEWHERE = "saw @buddy, but the cursor was elsewhere"
    const val NOTHING_BEFORE = "saw @buddy, but nothing before it to fix"
    const val ASKING = "fixing…"
    const val FIXED = "fixed ✓"
    const val NOT_PUT = "fixed, but couldn't put it in the box"
    const val FAILED = "couldn't fix it"
}
