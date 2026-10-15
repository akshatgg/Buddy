package com.akshatgg.buddy.calls

import android.Manifest
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class CallInfoTest {
    private val zone = ZoneId.of("Asia/Kolkata")
    private fun at(h: Int, m: Int) = ZonedDateTime.of(2026, 10, 15, h, m, 0, 0, zone).toInstant().toEpochMilli()
    private val noon = at(12, 0)

    private class Fakes(var ringing: Boolean = false, var ring: Ring = Ring(), var rows: List<LogRow> = emptyList(),
                        val names: Map<String, String> = emptyMap(), val refuse: Set<String> = emptySet()) {
        val asked = mutableListOf<String>()
        var since: Long? = null
    }
    private fun info(f: Fakes) = CallInfo(
        state = object : PhoneState { override fun ringing() = f.ringing },
        ring = { f.ring },
        log = object : CallLogReader { override suspend fun missedSince(from: Long): List<LogRow> { f.since = from; return f.rows } },
        names = object : NameLookup { override suspend fun nameFor(number: String) = f.names[number] },
        allowed = { p -> f.asked += p; p !in f.refuse },
        format = { "+91 98123 45678" },
        now = { noon }, zone = { zone },
    )

    @Test fun whoIsCallingByName() = runTest {
        val f = Fakes(ringing = true, ring = Ring(true, "+919812345678"), names = mapOf("+919812345678" to "Prince Sharma"))
        assertEquals(Told("Prince Sharma is calling."), info(f).ringing())
        assertEquals(listOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG), f.asked)
    }
    @Test fun whoIsCallingByNumber() = runTest {
        assertEquals(Told("+91 98123 45678 is calling."), info(Fakes(ringing = true, ring = Ring(true, "+919812345678"))).ringing())
    }
    @Test fun ringingButNoNumber() = runTest {
        assertEquals(Told("Someone is calling, but I can't see who."), info(Fakes(ringing = true)).ringing())
        // A number left from an earlier ring is not this one.
        assertEquals(Told("Someone is calling, but I can't see who."), info(Fakes(ringing = true, ring = Ring(false, "1"))).ringing())
    }
    @Test fun nobody() = runTest {
        assertEquals(Told("Nobody is calling right now."), info(Fakes(ringing = false, ring = Ring(true, "1"))).ringing())
    }
    @Test fun refusedSaysSoWithSettings() = runTest {
        val line = Told("I need permission to see your calls. You can allow it in Settings.", "no_call_log")
        assertEquals(line, info(Fakes(refuse = setOf(Manifest.permission.READ_PHONE_STATE))).ringing())
        assertEquals(line, info(Fakes(refuse = setOf(Manifest.permission.READ_CALL_LOG))).missed())
    }
    @Test fun missedSinceMidnightNewestFirstWithNames() = runTest {
        val f = Fakes(rows = listOf(
            LogRow("+911", "Mom", at(17, 40), 1),
            LogRow("+919812345678", null, at(15, 10), 1),
            LogRow("", null, at(9, 5), 2),
        ), names = mapOf("+919812345678" to "Prince Sharma"))
        assertEquals(Told("3 missed calls today: Mom at 5:40 pm, Prince Sharma at 3:10 pm, Unknown number at 9:05 am."), info(f).missed())
        assertEquals(at(0, 0), f.since)
        assertEquals(listOf(Manifest.permission.READ_CALL_LOG), f.asked)
    }
    @Test fun theLines() {
        assertEquals("No missed calls today.", missedLine(emptyList(), zone))
        assertEquals("1 missed call today: Prince Sharma at 3:10 pm.", missedLine(listOf(Missed("Prince Sharma", at(15, 10))), zone))
        val seven = ('A'..'G').mapIndexed { i, c -> Missed("$c", at(11 - i, 0)) }
        assertEquals("7 missed calls today: A at 11:00 am, B at 10:00 am, C at 9:00 am, D at 8:00 am, E at 7:00 am and 2 more.", missedLine(seven, zone))
        assertEquals("Someone is calling, but I can't see who.", ringingLine(null))
        assertEquals(at(0, 0), startOfToday(noon, zone))
    }
}
