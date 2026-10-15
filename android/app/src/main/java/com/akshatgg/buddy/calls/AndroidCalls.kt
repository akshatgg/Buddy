package com.akshatgg.buddy.calls

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.CallLog.Calls
import android.provider.ContactsContract
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale

/** Whether the phone rings now. Android 12 and later need READ_PHONE_STATE for it (a SecurityException without). */
class AndroidPhoneState(private val context: Context) : PhoneState {
    override fun ringing(): Boolean {
        val phone = context.getSystemService(TelephonyManager::class.java) ?: return false
        val state = if (Build.VERSION.SDK_INT >= 31) phone.callStateForSubscription else @Suppress("DEPRECATION") phone.callState
        return state == TelephonyManager.CALL_STATE_RINGING
    }
}

/** Today's missed calls from the call log, newest first (READ_CALL_LOG). */
class AndroidCallLog(private val context: Context) : CallLogReader {
    override suspend fun missedSince(from: Long): List<LogRow> = withContext(Dispatchers.IO) {
        val out = mutableListOf<LogRow>()
        context.contentResolver.query(
            Calls.CONTENT_URI,
            arrayOf(Calls.NUMBER, Calls.CACHED_NAME, Calls.DATE, Calls.NUMBER_PRESENTATION),
            "${Calls.TYPE} = ? AND ${Calls.DATE} >= ?",
            arrayOf(Calls.MISSED_TYPE.toString(), from.toString()),
            "${Calls.DATE} DESC",
        )?.use { r -> while (r.moveToNext()) out += LogRow(r.getString(0), r.getString(1), r.getLong(2), r.getInt(3)) }
        out
    }
}

/** A number's name in the contacts, only when Buddy may already read them; else null. */
class AndroidNameLookup(private val context: Context) : NameLookup {
    override suspend fun nameFor(number: String): String? = withContext(Dispatchers.IO) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return@withContext null
        try {
            val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
            context.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) it.getString(0)?.trim()?.ifEmpty { null } else null
            }
        } catch (e: SecurityException) {
            null
        }
    }
}

/** A number as the phone shows it ("+91 98123 45678"), for the network's country (else the SIM's, else the phone's). */
fun phoneFormat(context: Context): (String) -> String {
    val phone = context.getSystemService(TelephonyManager::class.java)
    val country = phone?.networkCountryIso.orEmpty().ifEmpty { phone?.simCountryIso.orEmpty() }.ifEmpty { Locale.getDefault().country }.uppercase()
    return { number -> PhoneNumberUtils.formatNumber(number, country) ?: number }
}
