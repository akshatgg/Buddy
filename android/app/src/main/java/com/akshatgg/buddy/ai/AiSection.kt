package com.akshatgg.buddy.ai

import com.akshatgg.buddy.cloud.FreeSettings

/** A line about free mode, and whether the provider / key / model form is shown. */
data class AiSection(val note: String, val showForm: Boolean)

/**
 * What the AI part of Settings and the Welcome screens shows for this person's free-mode settings (Phase 2 spec §2,
 * "What the AI section shows"), as the Mac's free-state.js says it.
 */
fun aiSection(free: FreeSettings?): AiSection {
    if (free == null || !free.freeOn) return AiSection("", true)
    if (free.blocked) {
        return if (free.allowOwnKey) {
            AiSection("Your free access is paused. You can still use your own key.", true)
        } else {
            AiSection("Your free access is paused.", false)
        }
    }
    if (free.limitMode == "unlimited") return AiSection("Free AI is on. No key needed.", false)
    // A missing limit reads as JavaScript's Math.min reads null: as 0.
    val today = "You get ${free.limit} free requests a day. Used today: ${minOf(free.usedToday, free.limit ?: 0)}."
    if (free.allowOwnKey) {
        return AiSection("$today Add your own key to keep going after your free requests run out.", true)
    }
    return AiSection(today, false)
}
