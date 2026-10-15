package com.akshatgg.buddy.calls

import android.content.Context
import android.provider.ContactsContract.CommonDataKinds.Phone as P
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** One phone number of a contact, as the contacts list has it. */
data class PhoneRow(val contact: Long, val name: String?, val number: String?, val primary: Boolean = false, val mobile: Boolean = false)

/** Someone Buddy can call: their name in the phone's contacts and the number it calls. */
data class Callee(val name: String, val number: String)

private fun digits(number: String) = number.filter { it in '0'..'9' }

/** Whether two numbers are the same, however they are written: the same digits, or the same last 10 of 10 or more. */
fun sameNumber(a: String, b: String): Boolean {
    val x = digits(a)
    val y = digits(b)
    if (x.isEmpty() || y.isEmpty()) return false
    return x == y || (x.length >= 10 && y.length >= 10 && x.takeLast(10) == y.takeLast(10))
}

/**
 * Everyone in the contacts with a number, once each: a contact with several numbers is called on the one marked as
 * the default, else the mobile one, else the first.
 */
fun calleesFrom(rows: List<PhoneRow>): List<Callee> =
    rows.filter { !it.name.isNullOrBlank() && digits(it.number.orEmpty()).length >= 3 }
        .groupBy { it.contact }
        .map { (_, own) ->
            val best = own.firstOrNull { it.primary } ?: own.firstOrNull { it.mobile } ?: own.first()
            Callee(best.name!!.trim(), best.number!!.trim())
        }

/** The phone's contacts' numbers. Needs the Contacts permission (a SecurityException without it). */
interface PhoneBook {
    suspend fun rows(): List<PhoneRow>
}

class AndroidPhoneBook(private val context: Context) : PhoneBook {
    override suspend fun rows(): List<PhoneRow> = withContext(Dispatchers.IO) {
        val columns = arrayOf(P.CONTACT_ID, P.DISPLAY_NAME, P.NUMBER, P.IS_SUPER_PRIMARY, P.IS_PRIMARY, P.TYPE)
        val out = mutableListOf<PhoneRow>()
        context.contentResolver.query(P.CONTENT_URI, columns, null, null, null)?.use { r ->
            while (r.moveToNext()) {
                out += PhoneRow(r.getLong(0), r.getString(1), r.getString(2), r.getInt(3) != 0 || r.getInt(4) != 0, r.getInt(5) == P.TYPE_MOBILE)
            }
        }
        out
    }
}
