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

/** What a sync sends (`ops`) for the account `uid`, how many of the outbox's changes it covers, and that outbox. */
data class Sending(val uid: String, val ops: List<MemoryOp>, val sent: Int, val outbox: List<MemoryOp>)

/**
 * What Buddy knows about the person, as the desktop's src/main/memory.js: short facts, as JSON [{ id, text, at }]
 * oldest first under "memory" in the key-value store, and "Learn about me from chats" under "learnFromChats" (on unless
 * it says "false").
 *
 * The chat adds the facts the AI picked up (source "chat"), but only while learning is on; Settings → Memory adds the
 * ones the person types (source "settings"), forgets one, or forgets them all. Every fact goes through cleanFact first,
 * so a password or a card number is never kept. Over maxFacts, the oldest goes. A damaged value reads as no facts.
 *
 * Signed in, the facts are kept with the person's account too (shared/memory-sync.js), so that their other devices
 * with the same sign-in know them; signed out, they stay on this phone. Every change is written down in the outbox
 * ("memoryOutbox", JSON), signed in or not, for MemorySyncer to send; "memoryUid" is the account the facts belong to
 * (none until the first sync). After a sync, the facts are what the server answered, with what changed meanwhile on top.
 */
class Memory(
    private val kv: KeyValue,
    /** The rules of the memory kept with the account, and (its `rules`) of every fact. */
    private val sync: MemorySync,
    private val now: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { java.util.UUID.randomUUID().toString() },
) : Facts {
    /** The rules every fact goes through; Settings' add box holds no more than rules.maxFactChars. */
    val rules: MemoryRules get() = sync.rules

    private val current = MutableStateFlow(read())

    /** The facts after every change, oldest first: Settings shows them as the chat learns (and as a sync brings them). */
    val changes: StateFlow<List<Fact>> = current.asStateFlow()

    private val edited = MutableStateFlow(0)

    /** One more with every change made on this phone (none with a sync): MemorySyncer sends them a moment later. */
    val edits: StateFlow<Int> = edited.asStateFlow()

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
        record(MemoryOp.Add(fact.id, fact.text, fact.at))
        return fact
    }

    @Synchronized
    override fun remove(id: String): Boolean {
        val known = read()
        val left = known.filter { it.id != id }
        if (left.size == known.size) return false
        save(left)
        record(MemoryOp.Forget(id))
        return true
    }

    /**
     * Forget everything; the learning switch stays as it is. Signed in, the person's other devices forget it all too.
     * With nothing known here, nothing is sent: facts this phone has not been shown yet are not forgotten unseen.
     */
    @Synchronized
    fun clear() {
        if (read().isEmpty()) return
        save(emptyList())
        record(MemoryOp.Clear)
    }

    // ---- Kept with the account (MemorySyncer) ----

    /** The changes made here that the server has not taken yet, oldest first. */
    fun outbox(): List<MemoryOp> = MemoryOp.readList(kv.getString(OUTBOX))

    /** The account these facts belong to: null until the first sync. */
    val linked: String? get() = kv.getString(UID)?.ifEmpty { null }

    /** What a sync for the account `uid` sends now (MemorySync.opsToSend), with the outbox as it is now. */
    @Synchronized
    fun toSend(uid: String): Sending {
        val outbox = outbox()
        val (ops, sent) = sync.opsToSend(uid, linked, read(), outbox)
        return Sending(uid, ops, sent, outbox)
    }

    /**
     * The server answered `sending` with the account's `facts`. Those are what this phone knows now, with what changed
     * here meanwhile (the outbox past what was sent, which stays for the next sync) on top; and the facts belong to
     * that account from now on.
     */
    @Synchronized
    fun synced(sending: Sending, facts: List<Fact>) {
        val rest = sync.outboxAfter(sending.outbox, sending.sent, outbox())
        saveOutbox(rest)
        kv.putString(UID, sending.uid)
        save(sync.afterSync(facts, rest))
    }

    private fun record(op: MemoryOp) {
        saveOutbox(sync.addToOutbox(outbox(), op))
        edited.value += 1
    }

    private fun saveOutbox(ops: List<MemoryOp>) = kv.putString(OUTBOX, if (ops.isEmpty()) null else MemoryOp.toJson(ops).toString())

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

    private companion object {
        const val KEY = "memory"
        const val LEARNING = "learnFromChats"
        const val OUTBOX = "memoryOutbox"
        const val UID = "memoryUid"
    }
}

/**
 * A fact as it is kept, and as Buddy's server answers it; null for anything a damaged value holds instead. A time that
 * is not a number reads as 0.
 */
internal fun readFact(entry: JsonElement): Fact? {
    val o = entry as? JsonObject ?: return null
    val id = (o["id"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
    val text = (o["text"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return null
    return Fact(id, text, readTime(o["at"]))
}
