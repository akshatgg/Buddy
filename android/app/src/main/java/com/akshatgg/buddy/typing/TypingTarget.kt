package com.akshatgg.buddy.typing

// Apps whose windows come and go over the person's app without being where they type: Android's own (the notification
// shade, the volume panel). Buddy's own package and the keyboard's are told apart by the caller.
private val OVERLAYS = setOf("com.android.systemui")

/**
 * Which box the person was last typing in, and which app is under Buddy's panel, from the Accessibility events
 * (LookService). `N` is the box's node (AccessibilityNodeInfo in the app, anything in a test); `release` lets go of a
 * node no longer kept. Never a password box; never a box or a window of Buddy's own, the keyboard's or the system's.
 * A window of another app forgets the box: the person has moved on, and Buddy must not write into an app they left.
 * Used from the service's thread and the panel's, so every change is under one lock.
 */
class TypingTarget<N>(private val ownPackage: String, private val release: (N) -> Unit = {}) {
    private var held: N? = null
    private var heldPackage: String? = null
    private var appPackage: String? = null

    /** The box the person last typed in, or null. */
    val box: N? get() = synchronized(this) { held }

    /** The package of the app the person was last in, or null. */
    val app: String? get() = synchronized(this) { appPackage }

    private fun ignored(pkg: String?) = pkg == null || pkg == ownPackage || pkg in OVERLAYS

    private fun drop() {
        held?.let(release)
        held = null
        heldPackage = null
    }

    /** Another window came up: the app it is from, unless it is Buddy's, the keyboard's or the system's. */
    fun onWindow(pkg: String?, keyboard: Boolean) = synchronized(this) {
        if (keyboard || ignored(pkg)) return@synchronized
        appPackage = pkg
        if (heldPackage != pkg) drop()
    }

    /** A text box (not a password one) got the focus, or was typed in: kept, in place of the one before. */
    fun onBox(pkg: String?, node: N) = synchronized(this) {
        if (ignored(pkg)) {
            release(node)
            return@synchronized
        }
        if (held !== node) drop()
        held = node
        heldPackage = pkg
        appPackage = pkg
    }

    /** A password box got the focus: nothing is kept, not even the box before it. */
    fun onPassword(pkg: String?) = synchronized(this) {
        if (ignored(pkg)) return@synchronized
        drop()
        appPackage = pkg
    }
}
