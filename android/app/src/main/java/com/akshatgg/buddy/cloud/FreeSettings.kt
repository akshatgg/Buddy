package com.akshatgg.buddy.cloud

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

/** This person's free-mode settings as the server last gave them. */
data class FreeSettings(
    val freeOn: Boolean,
    val limitMode: String,
    val limit: Int?,
    val usedToday: Int,
    val allowOwnKey: Boolean,
    val blocked: Boolean,
    val isAdmin: Boolean,
) {
    fun toJson(): String = buildJsonObject {
        put("freeOn", freeOn)
        put("limitMode", limitMode)
        if (limit == null) put("limit", JsonNull) else put("limit", limit)
        put("usedToday", usedToday)
        put("allowOwnKey", allowOwnKey)
        put("blocked", blocked)
        put("isAdmin", isAdmin)
    }.toString()

    companion object {
        /** Anything missing or odd reads as off, so a strange answer never switches free mode on. */
        fun read(j: JsonObject?): FreeSettings = FreeSettings(
            freeOn = flag(j, "freeOn"),
            limitMode = if (j?.get("limitMode").let { it is JsonPrimitive && it.isString && it.content == "unlimited" }) "unlimited" else "daily",
            limit = integer(j, "limit"),
            usedToday = integer(j, "usedToday") ?: 0,
            allowOwnKey = flag(j, "allowOwnKey"),
            blocked = flag(j, "blocked"),
            isAdmin = flag(j, "isAdmin"),
        )

        /** The copy kept in the app's settings; null when there is none or it cannot be read. */
        fun fromJson(text: String?): FreeSettings? {
            if (text.isNullOrBlank()) return null
            return try {
                read(Json.parseToJsonElement(text).jsonObject)
            } catch (e: Exception) {
                null
            }
        }

        private fun flag(j: JsonObject?, key: String): Boolean {
            val v = j?.get(key)
            return v is JsonPrimitive && !v.isString && v.contentOrNull == "true" && v.boolean
        }

        // Like Number.isInteger: 5 and 5.0 count, 2.5, "5" and null do not.
        private fun integer(j: JsonObject?, key: String): Int? {
            val v = j?.get(key)
            if (v !is JsonPrimitive || v.isString) return null
            val d = v.contentOrNull?.toDoubleOrNull() ?: return null
            if (d != Math.floor(d) || d.isInfinite() || d < Int.MIN_VALUE || d > Int.MAX_VALUE) return null
            return d.toInt()
        }
    }
}
