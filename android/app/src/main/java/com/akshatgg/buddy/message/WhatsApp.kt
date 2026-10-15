package com.akshatgg.buddy.message

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URLEncoder

/** Someone the phone knows on WhatsApp: the name in the phone's contacts, their number (digits) and which WhatsApp. */
data class Person(val name: String, val number: String, val app: String)

// WhatsApp adds a row of its own to each contact who uses it; `data1` is "<number>@s.whatsapp.net".
private val MIMES = mapOf(
    "vnd.android.cursor.item/vnd.com.whatsapp.profile" to "com.whatsapp",
    "vnd.android.cursor.item/vnd.com.whatsapp.w4b.profile" to "com.whatsapp.w4b",
)
private const val SUFFIX = "@s.whatsapp.net"
private val DIGITS = Regex("\\d{5,20}")

/** One contacts row as a Person, or null when it is not a person on WhatsApp. */
fun personFrom(name: String?, data1: String?, mime: String?): Person? {
    val app = MIMES[mime] ?: return null
    val who = name?.trim().orEmpty()
    val id = data1?.trim().orEmpty()
    if (who.isEmpty() || !id.endsWith(SUFFIX)) return null
    val number = id.removeSuffix(SUFFIX)
    if (!DIGITS.matches(number)) return null
    return Person(who, number, app)
}

/**
 * WhatsApp's own link that opens the chat with the text in its box (nothing is sent). A space is %20, never "+", which
 * WhatsApp may keep as a plus; a "+" in the text is %2B.
 */
fun chatLink(person: Person, text: String): String =
    "https://api.whatsapp.com/send?phone=${person.number}&text=${URLEncoder.encode(text, "UTF-8").replace("+", "%20")}"

/** WhatsApp on this phone, as Buddy uses it to message someone. */
interface WhatsApp {
    fun installed(): Boolean
    /** Everyone in the phone's contacts who is on WhatsApp. Needs the Contacts permission. */
    suspend fun people(): List<Person>
    /** Opens the person's chat with `text` in the box. */
    fun open(person: Person, text: String)
}

class PhoneWhatsApp(private val context: Context) : WhatsApp {
    override fun installed(): Boolean = MIMES.values.any { has(it) }

    private fun has(pkg: String): Boolean = try {
        context.packageManager.getPackageInfo(pkg, 0); true
    } catch (_: PackageManager.NameNotFoundException) { false }

    override suspend fun people(): List<Person> = withContext(Dispatchers.IO) {
        val out = mutableListOf<Person>()
        val columns = arrayOf(ContactsContract.Data.DISPLAY_NAME, ContactsContract.Data.DATA1, ContactsContract.Data.MIMETYPE)
        val where = "${ContactsContract.Data.MIMETYPE} IN (?, ?)"
        context.contentResolver.query(ContactsContract.Data.CONTENT_URI, columns, where, MIMES.keys.toTypedArray(), null)?.use { rows ->
            while (rows.moveToNext()) personFrom(rows.getString(0), rows.getString(1), rows.getString(2))?.let(out::add)
        }
        out.filter { has(it.app) }
    }

    override fun open(person: Person, text: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(chatLink(person, text)))
            .setPackage(person.app)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }
}
