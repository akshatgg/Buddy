package com.akshatgg.buddy.store

import android.content.Context

/** A few strings that outlive the app. Everything else in the store is built on this, so tests can swap it for memory. */
interface KeyValue {
    fun getString(key: String): String?

    /** A null value removes the key. */
    fun putString(key: String, value: String?)
}

class SharedPrefsKeyValue(context: Context, name: String) : KeyValue {
    private val prefs = context.getSharedPreferences(name, Context.MODE_PRIVATE)

    override fun getString(key: String): String? = prefs.getString(key, null)

    override fun putString(key: String, value: String?) {
        val edit = prefs.edit()
        if (value == null) edit.remove(key) else edit.putString(key, value)
        edit.apply()
    }
}

class MemoryKeyValue : KeyValue {
    private val map = HashMap<String, String>()

    override fun getString(key: String): String? = map[key]

    override fun putString(key: String, value: String?) {
        if (value == null) map.remove(key) else map[key] = value
    }
}
