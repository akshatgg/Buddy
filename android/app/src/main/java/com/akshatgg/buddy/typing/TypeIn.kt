package com.akshatgg.buddy.typing

/**
 * "Buddy can type for you", as the chat sees it: the box the person was typing in, through LookService, read and
 * written only when the chat asks. The panel gets the real one (AccessibilityTypeIn); a test, a fake.
 */
interface TypeIn {
    /** Whether the person has turned the service on in Android's Accessibility settings. */
    fun on(): Boolean

    /** The name of the app the person was in (its label), or null. */
    fun appName(): String?

    /** The box's text and selection as they are now; null when there is no box, it is gone, or it is a password box. */
    suspend fun read(): BoxText?

    /** Set the whole text of the box and put the cursor at `cursor`; false when it could not be set. */
    suspend fun write(text: String, cursor: Int): Boolean
}
