package com.akshatgg.buddy.typing

/** How a buddy's text goes into the box: at the cursor, over the selection it was asked about, or over the whole box. */
enum class PutMode { INSERT, REPLACE, REPLACE_ALL }

/** A text box as Android reports it: its text and its selection (both ends equal: the cursor; -1: not known). */
data class BoxText(val text: String, val selStart: Int, val selEnd: Int)

/** A box's new text, the cursor after the words put in, and the range [start, end) of the old text they replaced. */
data class Edit(val text: String, val cursor: Int, val start: Int, val end: Int)

/**
 * The arithmetic of putting Buddy's text in a box, which Android's Accessibility can only set whole (ACTION_SET_TEXT):
 * the new whole text and where the cursor goes. Pure, so that it is tested on the JVM.
 */
object TextEdit {
    /**
     * `text` put in `box` the `mode` way. REPLACE goes over the selected words the chat was about (`selection`): where
     * the box still selects them, else where they are in the box, else over whatever is selected, else at the cursor.
     * INSERT goes over the selection or at the cursor, as a paste does; at the end when the cursor is not known.
     */
    fun put(box: BoxText, mode: PutMode, text: String, selection: String = ""): Edit {
        val old = box.text
        val (start, end) = when (mode) {
            PutMode.REPLACE_ALL -> 0 to old.length
            PutMode.REPLACE -> replaceRange(box, selection)
            PutMode.INSERT -> cursorRange(box)
        }
        return replace(old, start, end, text)
    }

    /** A new version of the text an earlier put went in with (`last`): in its place, in the text from before that put. */
    fun again(before: String, last: Edit, text: String): Edit = replace(before, last.start, last.end, text)

    private fun replace(old: String, start: Int, end: Int, text: String) =
        Edit(old.substring(0, start) + text + old.substring(end), start + text.length, start, end)

    private fun cursorRange(box: BoxText): Pair<Int, Int> {
        val a = minOf(box.selStart, box.selEnd)
        val b = maxOf(box.selStart, box.selEnd)
        return if (a < 0 || b > box.text.length) box.text.length to box.text.length else a to b
    }

    private fun replaceRange(box: BoxText, selection: String): Pair<Int, Int> {
        val (a, b) = cursorRange(box)
        if (selection.isNotEmpty()) {
            if (box.text.substring(a, b) == selection) return a to b
            val at = box.text.indexOf(selection)
            if (at >= 0) return at to at + selection.length
        }
        return a to b
    }
}
