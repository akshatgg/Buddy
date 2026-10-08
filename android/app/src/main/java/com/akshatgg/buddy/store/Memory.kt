package com.akshatgg.buddy.store

import com.akshatgg.buddy.ai.MemoryRules
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/** Something Buddy knows about the person ("Your boss is Mr. Sharma."), and when it learnt it (ms since 1970). */
data class Fact(val id: String, val text: String, val at: Long)

/** What the chat needs of the memory: the facts to send along, a way to keep a new one, forget one, and the switch. */
interface Facts {
    /** Oldest first. */
    fun facts(): List<Fact>

    /** The fact as kept, or null when the rules refuse it, it is known already, or a chat adds it while learning is off. */
    fun add(text: String, source: String): Fact?

    /** False when there was no fact with that id. */
    fun remove(id: String): Boolean

    /** "Learn about me from chats". Off, a chat saves nothing new; what is known is still used. */
    val learning: Boolean
}

/**
 * What Buddy knows about the person, as the desktop's src/main/memory.js: short facts kept only on this phone (they are
 * not shared with the computer), as JSON [{ id, text, at }] oldest first under "memory" in the key-value store, and
 * "Learn about me from chats" under "learnFromChats" (on unless it says "false").
 *
 * The chat adds the facts the AI picked up (source "chat"), but only while learning is on; Settings → Memory adds the
 * ones the person types (source "settings"), forgets one, or forgets them all. Every fact goes through cleanFact first,
 * so a password or a card number is never kept. Over maxFacts, the oldest goes. A damaged value reads as no facts.
 */
class Memory(
    private val kv: KeyValue,
    /** The rules every fact goes through; Settings' add box holds no more than rules.maxFactChars. */
    val rules: MemoryRules,
    private val now: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { java.util.UUID.randomUUID().toString() },
) : Facts {
    private val current = MutableStateFlow(read())

    /** The facts after every change, oldest first: Settings shows them as the chat learns. */
    val changes: StateFlow<List<Fact>> = current.asStateFlow()

    override fun facts(): List<Fact> = read()

    override var learning: Boolean
        get() = kv.getString(LEARNING) != "false"
        set(on) = kv.putString(LEARNING, on.toString())

    @Synchronized
    override fun add(text: String, source: String): Fact? {
        val clean = rules.cleanFact(text) ?: return null
        if (source == "chat" && !learning) return null
        val known = read()
        if (known.any { it.text.lowercase() == clean.lowercase() }) return null
        val fact = Fact(newId(), clean, now())
        save((known + fact).takeLast(rules.maxFacts))
        return fact
    }

    @Synchronized
    override fun remove(id: String): Boolean {
        val known = read()
        val left = known.filter { it.id != id }
        if (left.size == known.size) return false
        save(left)
        return true
    }

    /** Forget everything; the learning switch stays as it is. */
    @Synchronized
    fun clear() {
        if (read().isNotEmpty()) save(emptyList())
    }

    private fun save(facts: List<Fact>) {
        kv.putString(
            KEY,
            buildJsonArray {
                for (f in facts) add(buildJsonObject { put("id", f.id); put("text", f.text); put("at", f.at) })
            }.toString(),
        )
        current.value = facts
    }

    private fun read(): List<Fact> {
        val saved = kv.getString(KEY) ?: return emptyList()
        val list = try {
            Json.parseToJsonElement(saved) as? JsonArray
        } catch (_: IllegalArgumentException) {
            null // not JSON (SerializationException is one)
        } ?: return emptyList()
        return list.mapNotNull(::readFact)
    }

    /** A fact as it is kept; null for anything a damaged value holds instead. A time that is not a number reads as 0. */
    private fun readFact(entry: JsonElement): Fact? {
        val o = entry as? JsonObject ?: return null
        val id = (o["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        val text = (o["text"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
        val at = (o["at"] as? JsonPrimitive)?.takeIf { !it.isString }?.let { it.longOrNull ?: it.doubleOrNull?.takeIf(Double::isFinite)?.toLong() } ?: 0L
        return Fact(id, text, at)
    }

    private companion object {
        const val KEY = "memory"
        const val LEARNING = "learnFromChats"
    }
}
