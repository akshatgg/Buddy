package com.akshatgg.buddy.calls

import android.Manifest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** A missed call: who (a name, a number, or "Unknown number") and when. */
data class Missed(val who: String, val at: Long)

/** One missed call as the call log has it. `presentation` is CallLog.Calls' NUMBER_PRESENTATION (1: shown). */
data class LogRow(val number: String?, val cachedName: String?, val date: Long, val presentation: Int)

/** What Buddy says about the phone's calls, and the Settings fix when it cannot (`code`). */
data class Told(val line: String, val code: String? = null)

/** Whether the phone rings now. Needs READ_PHONE_STATE on Android 12 and later (a SecurityException without it). */
interface PhoneState {
    fun ringing(): Boolean
}

/** The call log's missed calls since `from`, newest first. Needs READ_CALL_LOG (a SecurityException without it). */
interface CallLogReader {
    suspend fun missedSince(from: Long): List<LogRow>
}

/** A number's name in the contacts; null when it has none or the contacts cannot be read. */
interface NameLookup {
    suspend fun nameFor(number: String): String?
}

/** "Who is calling?" and "any missed calls?", as the chat asks them. */
interface CallTelling {
    suspend fun ringing(): Told
    suspend fun missed(): Told
}

private const val NO_CALL_LOG = "I need permission to see your calls. You can allow it in Settings."
private const val SHOWN = 1 // CallLog.Calls.PRESENTATION_ALLOWED
private const val NAMED = 5
private val CLOCK = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)

/** Who is calling, in one line: by name or number, or that Buddy can't see who (`who` null). */
fun ringingLine(who: String?): String = if (who == null) "Someone is calling, but I can't see who." else "$who is calling."

/** The first moment of `now`'s day, in `zone`. */
fun startOfToday(now: Long, zone: ZoneId): Long =
    Instant.ofEpochMilli(now).atZone(zone).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli()

/** Today's missed calls in one line, newest first: at most five by name and time, then how many more. */
fun missedLine(calls: List<Missed>, zone: ZoneId): String {
    if (calls.isEmpty()) return "No missed calls today."
    val named = calls.take(NAMED).joinToString(", ") { "${it.who} at ${CLOCK.format(Instant.ofEpochMilli(it.at).atZone(zone)).lowercase()}" }
    val more = if (calls.size > NAMED) " and ${calls.size - NAMED} more" else ""
    val count = if (calls.size == 1) "1 missed call" else "${calls.size} missed calls"
    return "$count today: $named$more."
}

/**
 * "Who is calling?" and "any missed calls?", answered only when asked. The permissions are asked the first time (the
 * chat says why first). Names come from the call log, else the contacts (only when Buddy may already read them: no
 * third question while the phone rings), else the number. Nothing is kept.
 */
class CallInfo(
    private val state: PhoneState,
    private val ring: () -> Ring,
    private val log: CallLogReader,
    private val names: NameLookup,
    private val allowed: suspend (String) -> Boolean,
    private val format: (String) -> String,
    private val now: () -> Long = System::currentTimeMillis,
    private val zone: () -> ZoneId = ZoneId::systemDefault,
) : CallTelling {
    override suspend fun ringing(): Told {
        if (!allowed(Manifest.permission.READ_PHONE_STATE) || !allowed(Manifest.permission.READ_CALL_LOG)) return Told(NO_CALL_LOG, "no_call_log")
        val ringing = try {
            state.ringing()
        } catch (e: SecurityException) {
            return Told(NO_CALL_LOG, "no_call_log")
        }
        if (!ringing) return Told("Nobody is calling right now.")
        // Only the number heard for this ring: one left from an earlier ring is not this caller.
        val number = ring().takeIf { it.ringing }?.number
        return Told(ringingLine(number?.let { names.nameFor(it) ?: format(it) }))
    }

    override suspend fun missed(): Told {
        if (!allowed(Manifest.permission.READ_CALL_LOG)) return Told(NO_CALL_LOG, "no_call_log")
        val zone = zone()
        val rows = try {
            log.missedSince(startOfToday(now(), zone))
        } catch (e: SecurityException) {
            return Told(NO_CALL_LOG, "no_call_log")
        }
        return Told(missedLine(rows.map { Missed(whoOf(it), it.date) }, zone))
    }

    /** A missed call's caller: the log's name, else the contacts', else the number; a hidden one is "Unknown number". */
    private suspend fun whoOf(row: LogRow): String {
        val number = row.number?.trim().orEmpty()
        if (row.presentation != SHOWN || number.isEmpty()) return "Unknown number"
        return row.cachedName?.trim()?.takeIf(String::isNotEmpty) ?: names.nameFor(number) ?: format(number)
    }
}
