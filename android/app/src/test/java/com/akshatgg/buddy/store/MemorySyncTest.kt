package com.akshatgg.buddy.store

import com.akshatgg.buddy.TestShared
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** The rules of the memory kept with the account: the cases of the desktop's test/server-memory.test.js, on a phone. */
class MemorySyncTest {
    private val sync = MemorySync(TestShared.shared)
    private fun add(id: String, text: String, at: Long = 1) = MemoryOp.Add(id, text, at)
    private fun forget(id: String) = MemoryOp.Forget(id)
    private val boss = Fact("f1", "Your boss is Mr. Sharma.", 1)
    private val city = Fact("f2", "You live in Pune.", 2)

    @Test fun theLimitsComeFromSharedJson() {
        assertEquals(100, TestShared.shared.memoryMaxOps)
        assertEquals(300, TestShared.shared.memoryMaxGone)
    }

    @Test fun addsKeepToTheMemoryRulesNoSecretNothingTwiceOver50TheOldestGoes() {
        val r = sync.applyOps(null, listOf(add("f1", boss.text), add("f9", "My password is hunter2"), add("f1", "Another text, same id"), add("f3", "YOUR BOSS IS MR. SHARMA.")))
        assertEquals(listOf(boss), r.facts)
        assertEquals(MemoryRecord(listOf(boss), emptyList()), r.next)

        val many = (0 until 52).map { i -> add("n$i", "Fact number ${"x".repeat(i)}.", i.toLong()) }
        val facts = sync.applyOps(null, many).facts
        assertEquals(50, facts.size)
        assertEquals("the two oldest went", "n2", facts.first().id)
    }

    @Test fun aForgottenFactStaysForgottenTheSameIdSentAgainLaterIsNotAddedBack() {
        val doc = sync.applyOps(MemoryRecord(listOf(boss, city)), listOf(forget("f1"))).next
        assertEquals(MemoryRecord(listOf(city), listOf("f1")), doc)
        val again = sync.applyOps(doc, listOf(add("f1", boss.text)))
        assertEquals(listOf(city), again.facts)
        assertNull("nothing changed", again.next)
        assertEquals("learnt again later, as a new fact", listOf(city, boss.copy(id = "f7")), sync.applyOps(doc, listOf(add("f7", boss.text))).facts)
    }

    @Test fun forgetEverythingForgetsEveryFactThereIsNoOpsChangesNothing() {
        val r = sync.applyOps(MemoryRecord(listOf(boss, city)), listOf(MemoryOp.Clear, add("f3", "You like tea.", 3)))
        assertEquals(listOf(Fact("f3", "You like tea.", 3)), r.facts)
        assertEquals(listOf("f1", "f2"), r.next?.gone)
        assertEquals(Applied(null, listOf(boss)), sync.applyOps(MemoryRecord(listOf(boss)), emptyList()))
        assertEquals(emptyList<Fact>(), sync.applyOps(null, listOf(MemoryOp.Clear, forget("nope"))).facts)
    }

    @Test fun theOutboxOneChangeAfterAnotherForgetEverythingMakesWhatCameBeforeMootAtMost100() {
        var box = sync.addToOutbox(emptyList(), add("a", "x"))
        box = sync.addToOutbox(box, forget("a"))
        assertEquals(listOf(add("a", "x"), forget("a")), box)
        assertEquals(listOf(MemoryOp.Clear), sync.addToOutbox(box, MemoryOp.Clear))
        assertEquals("a change the server would refuse is left out", listOf(forget("b")), sync.addToOutbox(listOf(forget("bad id!")), forget("b")))
        var full = emptyList<MemoryOp>()
        for (i in 0 until 105) full = sync.addToOutbox(full, forget("i$i"))
        assertEquals(100, full.size)
        assertEquals(forget("i5"), full.first())
    }

    @Test fun whatThePhoneSendsItsOutboxForItsOwnAccountAllItsFactsTheFirstTimeNothingForAnother() {
        val facts = listOf(boss, city)
        val outbox = listOf(forget("f1"))
        assertEquals(ToSend(listOf(forget("f1")), 1), sync.opsToSend("u1", "u1", facts, outbox))
        assertEquals(ToSend(listOf(add("f1", boss.text, 1), add("f2", city.text, 2)), 1), sync.opsToSend("u1", null, facts, outbox))
        assertEquals(ToSend(emptyList(), 1), sync.opsToSend("u2", "u1", facts, outbox))
        // A uuid, as the phone makes its ids, is one the server takes.
        val uuid = Fact("0b6e4f3c-2a1d-4c5e-9f00-123456789abc", "You like tea.", 3)
        assertEquals(1, sync.opsToSend("u1", null, listOf(uuid, Fact("no good", "x", 4)), emptyList()).ops.size)
    }

    @Test fun theOutboxAfterASyncWithoutWhatWasSentUnlessForgetEverythingRewroteItMeanwhile() {
        val then = listOf(forget("a"), forget("b"))
        assertEquals(listOf(forget("c")), sync.outboxAfter(then, 2, then + forget("c")))
        assertEquals("nothing was sent of it", then + forget("c"), sync.outboxAfter(then, 0, then + forget("c")))
        assertEquals(listOf(MemoryOp.Clear), sync.outboxAfter(then, 2, listOf(MemoryOp.Clear)))
        assertEquals(emptyList<MemoryOp>(), sync.outboxAfter(then, 2, then))
    }

    @Test fun afterASyncThePhoneKeepsTheServersFactsWithWhatItChangedMeanwhileOnTop() {
        assertEquals(listOf(boss, Fact("f3", "You like tea.", 3)), sync.afterSync(listOf(boss, city), listOf(forget("f2"), add("f3", "You like tea.", 3))))
        assertEquals(listOf(boss), sync.afterSync(listOf(boss), emptyList()))
    }

    @Test fun changesAreKeptAsTheServerReadsThemAndABrokenOneIsLeftOut() {
        val ops = listOf(add("a", "x", 5), forget("b"), MemoryOp.Clear)
        assertEquals("""[{"op":"add","id":"a","text":"x","at":5},{"op":"forget","id":"b"},{"op":"clear"}]""", MemoryOp.toJson(ops).toString())
        assertEquals(ops, MemoryOp.readList(MemoryOp.toJson(ops).toString()))
        assertEquals(
            listOf(add("a", "x", 0), MemoryOp.Clear, add("c", "y", 7)),
            MemoryOp.readList(
                """[{"op":"add","id":"a","text":"x","at":"later"}, {"op":"add","id":"bad id!","text":"x"}, {"op":"eat"}, {"op":"forget","id":""},
                   null, {"op":"clear","id":9}, {"op":"add","id":"b"}, {"op":"add","id":"c","text":"y","at":7.9}]""",
            ),
        )
        for (broken in listOf(null, "", "not json", "{}", "[", "42")) assertEquals(broken, emptyList<MemoryOp>(), MemoryOp.readList(broken))
        assertNull(MemoryOp.read(Json.parseToJsonElement("""{"op":"forget","id":7}""")))
    }
}
