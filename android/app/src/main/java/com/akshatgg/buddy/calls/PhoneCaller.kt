package com.akshatgg.buddy.calls

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import com.akshatgg.buddy.message.Pick
import com.akshatgg.buddy.message.contactLine
import com.akshatgg.buddy.message.pickChat
import com.akshatgg.buddy.message.sameName

/** Who "Prince" is among the phone's contacts: one person, or what Buddy says instead (`code`: the Settings fix). */
sealed interface CallFound {
    data class One(val callee: Callee) : CallFound
    data class Say(val line: String, val code: String? = null) : CallFound
}

/**
 * How a call ended: started; pressed but Buddy cannot tell (never a second call); stopped after the call button was
 * pressed, and why (the card ends: never a second call either); or not called before any press, and why (the card
 * stays, to press Call again).
 */
sealed interface Called {
    data object Done : Called
    data object Unsure : Called
    data class Ended(val line: String) : Called
    data class Failed(val line: String, val code: String? = null) : Called
}

const val NO_CALLS = "I need permission to make calls. You can allow it in Settings."
/** A phone call pressed that Buddy cannot tell started (WhatsApp's own says to check WhatsApp: CALL_UNSURE). */
const val PHONE_CALL_UNSURE = "I'm not sure the call started."
private const val CANT_CALL = "This phone can't make calls."

/** The phone app's own call: ACTION_CALL, which rings at once (CALL_PHONE). A phone with two SIMs may ask which. */
interface Dialer {
    fun canCall(): Boolean
    fun call(number: String)
}

class PhoneDialer(private val context: Context) : Dialer {
    override fun canCall() = context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)
    override fun call(number: String) {
        context.startActivity(Intent(Intent.ACTION_CALL, Uri.fromParts("tel", number, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

/** What the chat panel needs for a phone call: who, then call. */
interface PhoneCalling {
    suspend fun find(asked: String): CallFound
    suspend fun call(callee: Callee): Called
}

/**
 * A phone call, the steps in order. find(): whether this phone can call at all, then who "Prince" is among the contacts
 * with a number (the same rule as for WhatsApp). call(), only after the person pressed Call: the call permission (asked the first time), then the call.
 */
class PhoneCaller(
    private val book: PhoneBook,
    private val dialer: Dialer,
    private val contactsAllowed: suspend () -> Boolean,
    private val callsAllowed: suspend () -> Boolean,
) : PhoneCalling {
    override suspend fun find(asked: String): CallFound {
        if (!dialer.canCall()) return CallFound.Say(CANT_CALL) // a tablet with no phone line: no card, no contacts question
        val noContacts = CallFound.Say("I need your contacts to find $asked. You can allow it in Settings.", "no_contacts")
        if (!contactsAllowed()) return noContacts
        val people = try {
            calleesFrom(book.rows())
        } catch (e: SecurityException) {
            return noContacts // taken back in the phone's settings since it was allowed
        }
        val pick = pickChat(asked, people.map { it.name })
        if (pick !is Pick.One) return CallFound.Say(contactLine(asked, pick)!!)
        // Two contacts with the same name and different numbers: Buddy does not guess which. The same number twice is one.
        val numbers = people.filter { sameName(it.name, pick.name) }
            .fold(listOf<Callee>()) { kept, p -> if (kept.any { sameNumber(it.number, p.number) }) kept else kept + p }
        if (numbers.size > 1) {
            return CallFound.Say("You have more than one contact called ${pick.name}. Rename one in your phone's contacts, then ask me again.")
        }
        return CallFound.One(numbers.first())
    }

    override suspend fun call(callee: Callee): Called {
        if (!dialer.canCall()) return Called.Failed(CANT_CALL)
        if (!callsAllowed()) return Called.Failed(NO_CALLS, "no_calls")
        return try {
            dialer.call(callee.number)
            Called.Done
        } catch (e: SecurityException) {
            Called.Failed(NO_CALLS, "no_calls") // taken back since it was allowed
        } catch (e: ActivityNotFoundException) {
            Called.Failed(CANT_CALL)
        }
    }
}
