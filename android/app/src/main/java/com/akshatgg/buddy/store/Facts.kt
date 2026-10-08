package com.akshatgg.buddy.store

// What Buddy knows about the person, as the chat sees it. The memory branch builds the store (store/Memory.kt, the
// class Memory : Facts, with cleanFact and Settings → Memory); this file only declares what the chat codes against.
// When that branch merges, its Memory.kt declares these same two types: this file then goes.

/** One thing Buddy knows about the person ("Your boss is Mr. Sharma."). */
data class Fact(val id: String, val text: String, val at: Long)

interface Facts {
    /** Oldest first. */
    fun facts(): List<Fact>

    /** Keep a fact; null when it is refused (cleanFact), already known, or comes from a chat (`source` "chat") while learning is off. */
    fun add(text: String, source: String): Fact?

    fun remove(id: String): Boolean

    /** "Learn about me from chats". */
    val learning: Boolean
}
