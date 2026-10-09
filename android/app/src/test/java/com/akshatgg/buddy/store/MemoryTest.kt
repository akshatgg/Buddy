package com.akshatgg.buddy.store

import com.akshatgg.buddy.TestShared
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The desktop's test/memory.test.js, on a phone. */
class MemoryTest {
    private val sync = MemorySync(TestShared.shared)
    private val kv = MemoryKeyValue()
    private var ids = 0
    private var clock = 1_000_000L

    /** Memory with ids f1, f2, … and a clock that moves one second per fact. */
    private fun memory(on: KeyValue = kv) = Memory(on, sync, now = { clock += 1000; clock }, newId = { "f${++ids}" })
    private fun texts(m: Memory) = m.facts().map { it.text }

    @Test fun aNewPhoneKnowsNothingYetAndLearnsFromChats() {
        val m = memory()
        assertEquals(emptyList<Fact>(), m.facts())
        assertTrue(m.learning)
        assertEquals(emptyList<Fact>(), m.changes.value)
    }

    @Test fun addKeepsAFactAndFactsAnswersThemOldestFirst() {
        val m = memory()
        assertEquals(Fact("f1", "Your boss is Mr. Sharma.", 1_001_000), m.add("Your boss is Mr. Sharma.", "chat"))
        assertEquals(Fact("f2", "You work at Infosys.", 1_002_000), m.add("  You work at Infosys.\n", "settings"))
        assertEquals(
            listOf(Fact("f1", "Your boss is Mr. Sharma.", 1_001_000), Fact("f2", "You work at Infosys.", 1_002_000)),
            m.facts(),
        )
    }

    @Test fun theFactsAreSavedAsJsonAndAreThereAfterARestart() {
        memory().add("Your boss is Mr. Sharma.", "chat")
        assertEquals(listOf("Your boss is Mr. Sharma."), texts(Memory(kv, sync)))
        val saved = Json.parseToJsonElement(kv.getString("memory")!!).jsonArray.single().jsonObject
        assertEquals("f1", saved.getValue("id").jsonPrimitive.content)
        assertEquals("Your boss is Mr. Sharma.", saved.getValue("text").jsonPrimitive.content)
        assertEquals(1_001_000L, saved.getValue("at").jsonPrimitive.long)
    }

    @Test fun idsAreUuidsAndTimesTheClockUnlessOthersAreGiven() {
        val before = System.currentTimeMillis()
        val added = Memory(kv, sync).add("Your city is Pune.", "chat")!!
        assertTrue(added.id, Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$").matches(added.id))
        assertTrue(added.at >= before && added.at <= System.currentTimeMillis())
    }

    @Test fun aFactAlreadyKnownIsNotSavedAgainWhateverItsCase() {
        val m = memory()
        m.add("Your boss is Mr. Sharma.", "chat")
        assertNull(m.add("your BOSS is mr. sharma.", "chat"))
        assertNull("nor with other spaces around and in it", m.add("  Your boss is   Mr. Sharma. ", "settings"))
        assertEquals(listOf("Your boss is Mr. Sharma."), texts(m))
    }

    @Test fun aFactTheRulesRefuseIsNotSaved() {
        val m = memory()
        for (fact in listOf("", "   ", "Your PIN is 1234.", "Your card is 4111 1111 1111 1111.", "a".repeat(201))) {
            assertNull(fact, m.add(fact, "chat"))
            assertNull("$fact from Settings", m.add(fact, "settings"))
        }
        assertEquals(emptyList<Fact>(), m.facts())
        assertNull("nothing saved", kv.getString("memory"))
    }

    @Test fun thereAreAtMost50FactsANewOnePushesOutTheOldest() {
        val m = memory()
        for (i in 1..50) m.add("Fact number $i.", "chat")
        assertEquals(50, m.facts().size)
        assertEquals(Fact("f51", "One more fact.", 1_051_000), m.add("One more fact.", "chat"))
        val facts = texts(m)
        assertEquals(50, facts.size)
        assertEquals("the oldest went", "Fact number 2.", facts.first())
        assertEquals("One more fact.", facts.last())
    }

    @Test fun withLearningOffTheChatSavesNothingNewSettingsStillCanAndWhatIsKnownStays() {
        val m = memory()
        m.add("Your boss is Mr. Sharma.", "chat")
        m.learning = false
        assertFalse(m.learning)
        assertEquals("saved", "false", kv.getString("learnFromChats"))
        assertFalse("after a restart too", Memory(kv, sync).learning)
        assertNull(m.add("Your city is Pune.", "chat"))
        assertEquals("Your city is Pune.", m.add("Your city is Pune.", "settings")?.text)
        assertEquals(listOf("Your boss is Mr. Sharma.", "Your city is Pune."), texts(m))
        m.learning = true
        assertEquals("You work at Infosys.", m.add("You work at Infosys.", "chat")?.text)
    }

    @Test fun removeForgetsOneFactByItsIdAndSaysWhetherThereWasOne() {
        val m = memory()
        m.add("Your boss is Mr. Sharma.", "chat")
        m.add("Your city is Pune.", "chat")
        assertTrue(m.remove("f1"))
        assertEquals(listOf("Your city is Pune."), texts(m))
        assertFalse("already gone", m.remove("f1"))
        assertFalse(m.remove("nope"))
        assertEquals(listOf("Your city is Pune."), texts(Memory(kv, sync)))
        assertEquals("a forgotten fact can be learnt again", "f3", m.add("Your boss is Mr. Sharma.", "chat")?.id)
    }

    @Test fun clearForgetsEverythingAndLeavesTheLearningSwitchAsItIs() {
        val m = memory()
        m.add("Your boss is Mr. Sharma.", "chat")
        m.add("Your city is Pune.", "chat")
        m.learning = false
        m.clear()
        assertEquals(emptyList<Fact>(), m.facts())
        assertEquals(emptyList<Fact>(), Memory(kv, sync).facts())
        assertFalse(m.learning)
    }

    @Test fun changesShowsTheListAfterEveryChange() {
        kv.putString("memory", """[{"id":"a","text":"Your boss is Mr. Sharma.","at":5}]""")
        val m = memory()
        assertEquals("what was saved before", listOf("Your boss is Mr. Sharma."), m.changes.value.map { it.text })
        m.add("Your city is Pune.", "chat")
        assertEquals(listOf("Your boss is Mr. Sharma.", "Your city is Pune."), m.changes.value.map { it.text })
        m.remove("a")
        assertEquals(listOf("Your city is Pune."), m.changes.value.map { it.text })
        m.clear()
        assertEquals(emptyList<Fact>(), m.changes.value)
    }

    @Test fun aDamagedMemoryStillWorksWhatIsNotAFactIsLeftOut() {
        kv.putString(
            "memory",
            """[{"id":"a","text":"Your boss is Mr. Sharma.","at":5}, null, "a bare string", {"id":7,"text":"a number for an id","at":6},
               {"id":"b","text":42,"at":7}, {"id":"c","text":"Your city is Pune."}, {"id":"d","text":"Odd time.","at":"soon"}, [1]]""",
        )
        assertEquals(
            listOf(Fact("a", "Your boss is Mr. Sharma.", 5), Fact("c", "Your city is Pune.", 0), Fact("d", "Odd time.", 0)),
            memory().facts(),
        )
        for (broken in listOf("""{"not":"a list"}""", "not json at all", "[", "42", "null")) {
            kv.putString("memory", broken)
            val m = memory()
            assertEquals(broken, emptyList<Fact>(), m.facts())
            assertEquals(broken, "Your city is Pune.", m.add("Your city is Pune.", "chat")?.text)
        }
    }

    @Test fun aLearningSettingThatIsNotFalseCountsAsOn() {
        kv.putString("learnFromChats", "maybe")
        assertTrue(memory().learning)
        kv.putString("learnFromChats", "false")
        assertFalse(memory().learning)
    }

    @Test fun theChatSeesMemoryAsFacts() {
        val facts: Facts = memory()
        facts.add("Your boss is Mr. Sharma.", "chat")
        assertEquals(listOf("Your boss is Mr. Sharma."), facts.facts().map { it.text })
        assertTrue(facts.learning)
    }

    // ---- Kept with the account ----

    @Test fun everyChangeIsWrittenDownInTheOutboxAndKeptThroughARestart() {
        val m = memory()
        assertEquals(emptyList<MemoryOp>(), m.outbox())
        assertNull("never synced", m.linked)
        m.add("Your boss is Mr. Sharma.", "chat")
        m.add("Your city is Pune.", "settings")
        m.remove("f1")
        assertEquals(
            listOf(MemoryOp.Add("f1", "Your boss is Mr. Sharma.", 1_001_000), MemoryOp.Add("f2", "Your city is Pune.", 1_002_000), MemoryOp.Forget("f1")),
            Memory(kv, sync).outbox(),
        )
        assertTrue("as JSON", kv.getString("memoryOutbox")!!.startsWith("""[{"op":"add","id":"f1","text":"Your boss is Mr. Sharma.","at":1001000},"""))
        assertEquals(3, m.edits.value)
        m.clear()
        assertEquals("forget everything makes what came before moot", listOf(MemoryOp.Clear), m.outbox())
        assertEquals(4, m.edits.value)
    }

    @Test fun whatChangesNothingWritesNothingDown() {
        val m = memory()
        m.learning = false
        assertNull(m.add("Your city is Pune.", "chat"))
        assertNull(m.add("Your PIN is 1234.", "settings"))
        m.learning = true
        m.add("Your city is Pune.", "chat")
        assertNull(m.add("your city is pune.", "chat"))
        assertFalse(m.remove("nope"))
        m.remove("f1")
        m.clear() // nothing left to forget: facts the phone has not been shown yet are not forgotten unseen
        assertEquals(listOf(MemoryOp.Add("f1", "Your city is Pune.", 1_001_000), MemoryOp.Forget("f1")), m.outbox())
        assertEquals(2, m.edits.value)
    }

    @Test fun theFirstSyncSendsEveryFactAndKeepsTheServersAnswer() {
        val m = memory()
        m.add("Your boss is Mr. Sharma.", "chat")
        m.add("Your city is Pune.", "chat")
        m.remove("f2")
        val sending = m.toSend("u1")
        assertEquals(listOf(MemoryOp.Add("f1", "Your boss is Mr. Sharma.", 1_001_000)), sending.ops)
        assertEquals(3, sending.sent)
        val tea = Fact("x9", "You like tea.", 7)
        m.synced(sending, listOf(Fact("f1", "Your boss is Mr. Sharma.", 1_001_000), tea))
        assertEquals("u1", m.linked)
        assertEquals("u1", Memory(kv, sync).linked)
        assertEquals(emptyList<MemoryOp>(), m.outbox())
        assertNull(kv.getString("memoryOutbox"))
        assertEquals(listOf("Your boss is Mr. Sharma.", "You like tea."), m.changes.value.map { it.text })
        assertEquals("a sync is no change made here", 3, m.edits.value)
        assertEquals("then only the outbox", emptyList<MemoryOp>(), m.toSend("u1").ops)
    }

    @Test fun whatChangesDuringASyncStaysInTheOutboxAndOnTopOfTheServersFacts() {
        val m = memory()
        kv.putString("memoryUid", "u1")
        m.add("Your boss is Mr. Sharma.", "chat")
        val sending = m.toSend("u1")
        assertEquals(listOf(MemoryOp.Add("f1", "Your boss is Mr. Sharma.", 1_001_000)), sending.ops)
        m.add("Your city is Pune.", "chat") // meanwhile
        m.synced(sending, listOf(Fact("f1", "Your boss is Mr. Sharma.", 1_001_000)))
        assertEquals(listOf(MemoryOp.Add("f2", "Your city is Pune.", 1_002_000)), m.outbox())
        assertEquals(listOf("Your boss is Mr. Sharma.", "Your city is Pune."), m.facts().map { it.text })

        val again = m.toSend("u1")
        m.clear() // meanwhile, "Forget everything"
        m.synced(again, listOf(Fact("f1", "Your boss is Mr. Sharma.", 1_001_000), Fact("f2", "Your city is Pune.", 1_002_000)))
        assertEquals("the clear is not lost", listOf(MemoryOp.Clear), m.outbox())
        assertEquals(emptyList<Fact>(), m.facts())
    }

    @Test fun anotherAccountsFactsTakeThePlaceOfThisPhones() {
        val m = memory()
        kv.putString("memoryUid", "u1")
        m.add("Your boss is Mr. Sharma.", "chat")
        val sending = m.toSend("u2")
        assertEquals(Sending("u2", emptyList(), 1, m.outbox()), sending)
        m.synced(sending, listOf(Fact("z", "You like tea.", 7)))
        assertEquals(listOf(Fact("z", "You like tea.", 7)), m.facts())
        assertEquals("u2", m.linked)
        assertEquals(emptyList<MemoryOp>(), m.outbox())
    }

    @Test fun aDamagedOutboxReadsAsNoChanges() {
        kv.putString("memoryOutbox", "not json")
        val m = memory()
        assertEquals(emptyList<MemoryOp>(), m.outbox())
        m.add("Your city is Pune.", "chat")
        assertEquals(1, m.outbox().size)
    }
}
