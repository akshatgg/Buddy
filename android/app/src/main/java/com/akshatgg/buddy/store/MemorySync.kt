package com.akshatgg.buddy.store

import com.akshatgg.buddy.ai.MemoryRules
import com.akshatgg.buddy.core.Shared
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

/**
 * One change to what Buddy knows, as shared/memory-sync.js sends it to Buddy's server: a fact learnt or typed in (its
 * id made on the phone, so that it can be forgotten before the server has it), one fact forgotten, or "Forget
 * everything".
 */
sealed interface MemoryOp {
    data class Add(val id: String, val text: String, val at: Long) : MemoryOp
    data class Forget(val id: String) : MemoryOp
    data object Clear : MemoryOp

    /** As it is sent and kept: { op: 'add', id, text, at }, { op: 'forget', id } or { op: 'clear' }. */
    fun toJson(): JsonObject = when (this) {
        is Add -> buildJsonObject { put("op", "add"); put("id", id); put("text", text); put("at", at) }
        is Forget -> buildJsonObject { put("op", "forget"); put("id", id) }
        Clear -> buildJsonObject { put("op", "clear") }
    }

    companion object {
        private fun JsonObject.string(name: String) = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.content

        /** One change as kept (memory-sync.js readOp): null for one that is not right. A time that is not a number is 0. */
        fun read(entry: JsonElement?): MemoryOp? {
            val o = entry as? JsonObject ?: return null
            val op = o.string("op")
            if (op == "clear") return Clear
            val id = o.string("id")?.takeIf(MemorySync::isId) ?: return null
            return when (op) {
                "forget" -> Forget(id)
                "add" -> {
                    val text = o.string("text") ?: return null
                    Add(id, text, readTime(o["at"]))
                }
                else -> null
            }
        }

        /** A list of changes kept as JSON; anything damaged reads as no changes, and a single broken one is left out. */
        fun readList(saved: String?): List<MemoryOp> {
            val list = try {
                Json.parseToJsonElement(saved ?: return emptyList()) as? JsonArray
            } catch (_: IllegalArgumentException) {
                null // not JSON (SerializationException is one)
            } ?: return emptyList()
            return list.mapNotNull(::read)
        }

        fun toJson(ops: List<MemoryOp>): JsonArray = buildJsonArray { ops.forEach { add(it.toJson()) } }
    }
}

/** A time as JSON holds it, in ms since 1970: one that is not a number reads as 0. */
internal fun readTime(value: JsonElement?): Long =
    (value as? JsonPrimitive)?.takeIf { !it.isString }?.let { it.longOrNull ?: it.doubleOrNull?.takeIf(Double::isFinite)?.toLong() } ?: 0L

/** An account's facts as the server keeps them: oldest first, and the ids forgotten lately (`gone`). */
data class MemoryRecord(val facts: List<Fact>, val gone: List<String> = emptyList())

/** What applyOps made of a record: `next` is null when nothing changed; `facts` are the facts either way. */
data class Applied(val next: MemoryRecord?, val facts: List<Fact>)

/** What one sync sends (`ops`), and how many of the outbox's changes the answer covers (`sent`). */
data class ToSend(val ops: List<MemoryOp>, val sent: Int)

/**
 * The phone's side of shared/memory-sync.js: what Buddy knows is kept with the person's Google account, so that every
 * device they sign in to knows the same facts. The phone keeps its own copy (Memory) and the changes the server has not
 * taken yet, its "outbox". A sync sends the outbox, the server applies it to the account's facts, and the phone keeps
 * what the server answers, with what it changed meanwhile applied again on top.
 *
 * These follow the functions there step by step, so that the phone and the server agree: a fact goes through the
 * memory rules (cleanFact), a fact known already is not kept twice, a forgotten one is not added back, and over maxFacts
 * the oldest goes. The limits come from shared.json (memorySync).
 */
class MemorySync(val rules: MemoryRules, private val maxOps: Int, private val maxGone: Int) {
    constructor(shared: Shared, rules: MemoryRules = MemoryRules(shared)) : this(rules, shared.memoryMaxOps, shared.memoryMaxGone)

    /** The facts of a record, leaving out anything broken (memory-sync.js factsOf). */
    private fun factsOf(facts: List<Fact>) = facts.filter { isId(it.id) && it.text.isNotEmpty() }

    /** The changes as they would be read back: one with an id the server would not take is left out. */
    private fun checked(ops: List<MemoryOp>) = ops.filter { op ->
        when (op) {
            is MemoryOp.Add -> isId(op.id)
            is MemoryOp.Forget -> isId(op.id)
            MemoryOp.Clear -> true
        }
    }

    /**
     * The record with `ops` applied, in order. The phone applies its own outbox on top of the server's facts with this
     * (afterSync).
     */
    fun applyOps(record: MemoryRecord?, ops: List<MemoryOp>): Applied {
        var facts = factsOf(record?.facts.orEmpty())
        var gone = record?.gone.orEmpty().filter(::isId)
        var changed = false
        for (op in ops) {
            when (op) {
                is MemoryOp.Add -> {
                    val text = rules.cleanFact(op.text) ?: continue
                    if (op.id in gone) continue
                    if (facts.any { it.id == op.id || it.text.lowercase() == text.lowercase() }) continue
                    facts = (facts + Fact(op.id, text, op.at)).takeLast(rules.maxFacts)
                    changed = true
                }
                is MemoryOp.Forget -> {
                    if (op.id !in gone) gone = (gone + op.id).takeLast(maxGone)
                    facts = facts.filter { it.id != op.id }
                    changed = true
                }
                MemoryOp.Clear -> if (facts.isNotEmpty()) {
                    gone = (gone + facts.map { it.id }).takeLast(maxGone)
                    facts = emptyList()
                    changed = true
                }
            }
        }
        return Applied(if (changed) MemoryRecord(facts, gone) else null, facts)
    }

    /** The outbox with one more change. "Forget everything" makes what came before it moot; past maxOps, the oldest goes. */
    fun addToOutbox(outbox: List<MemoryOp>, op: MemoryOp): List<MemoryOp> =
        (if (op == MemoryOp.Clear) listOf(op) else checked(outbox) + op).takeLast(maxOps)

    /**
     * What the phone sends when it syncs, for the account `uid`. `linked` is the account its facts already belong to
     * (null: none yet), `facts` its facts and `outbox` its changes.
     *
     *   - the same account: the outbox
     *   - no account yet: all its facts, as adds, so that they join the account's
     *   - another account (someone else signed in): nothing; the phone takes that account's facts in place of its own
     */
    fun opsToSend(uid: String, linked: String?, facts: List<Fact>, outbox: List<MemoryOp>): ToSend {
        val kept = checked(outbox)
        if (linked == uid) return ToSend(kept.take(maxOps), minOf(kept.size, maxOps))
        if (linked != null) return ToSend(emptyList(), kept.size)
        val adds = checked(facts.map { MemoryOp.Add(it.id, it.text, it.at) })
        return ToSend(adds.takeLast(maxOps), kept.size)
    }

    /**
     * The outbox once the server answered: `now` without the `sent` changes of `then` (the outbox as it was sent).
     * Changes made meanwhile were added after those; but "Forget everything", or an outbox past maxOps, rewrote it, and
     * then all of `now` stays to be sent next time (sending a change twice does no harm).
     */
    fun outboxAfter(then: List<MemoryOp>, sent: Int, now: List<MemoryOp>): List<MemoryOp> {
        val covered = checked(then).take(sent)
        val current = checked(now)
        return if (current.take(sent) == covered) current.drop(sent) else current
    }

    /** What the phone keeps after the server answered `facts`: those, with the changes it made meanwhile (`rest`) on top. */
    fun afterSync(facts: List<Fact>, rest: List<MemoryOp>): List<Fact> = applyOps(MemoryRecord(facts), checked(rest)).facts

    companion object {
        private val ID = Regex("^[A-Za-z0-9_-]{1,64}$") // memory-sync.js ID: the ids the server takes

        fun isId(id: String): Boolean = ID.matches(id)
    }
}
