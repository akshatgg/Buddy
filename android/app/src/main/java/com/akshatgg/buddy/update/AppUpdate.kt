package com.akshatgg.buddy.update

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull

/** Where Buddy's releases are listed (GitHub's API) and the name of the phone's file in each Android one. */
const val RELEASES_URL = "https://api.github.com/repos/akshatgg/Buddy/releases?per_page=100"
const val APK_NAME = "Buddy-Android.apk"

/** A published Android release: its version, where its APK is, its size, and its SHA-256 when GitHub gives one. */
data class AndroidRelease(val version: String, val apkUrl: String, val size: Long, val sha256: String?)

/**
 * Buddy for Android's updates, as the website finds them (web/public/site.js androidFacts): Android is released on its
 * own, tagged android-v<version>, never marked latest, so the newest is looked for in the list. Pure, tested on the JVM.
 */
object AppUpdate {
    private val TAG = Regex("^android-v(\\d+)\\.(\\d+)\\.(\\d+)$")
    private val SHA = Regex("^sha256:([0-9a-f]{64})$")

    /** The newest published Android release with its APK in GitHub's list (`json`), or null. */
    fun newestAndroid(json: String): AndroidRelease? {
        val list = try {
            Json.parseToJsonElement(json) as? JsonArray
        } catch (e: Exception) {
            null
        } ?: return null
        var best: Pair<List<Int>, AndroidRelease>? = null
        for (r in list) {
            val release = r as? JsonObject ?: continue
            if (flag(release, "draft") || flag(release, "prerelease")) continue
            val m = TAG.find(text(release, "tag_name") ?: continue) ?: continue
            val asset = (release["assets"] as? JsonArray)?.mapNotNull { it as? JsonObject }?.firstOrNull { text(it, "name") == APK_NAME } ?: continue
            val url = text(asset, "browser_download_url") ?: continue
            if (!url.startsWith("https://github.com/akshatgg/Buddy/releases/download/")) continue // only Buddy's own
            val parts = m.groupValues.drop(1).map { it.toInt() }
            val sha = text(asset, "digest")?.let { SHA.find(it)?.groupValues?.get(1) }
            val found = AndroidRelease(parts.joinToString("."), url, (asset["size"] as? JsonPrimitive)?.longOrNull ?: 0, sha)
            if (best == null || compare(parts, best.first) > 0) best = parts to found
        }
        return best?.second
    }

    /** Whether `version` (1.2.4) is newer than `current` (1.2.3, or 1.2.3-debug and the like). */
    fun isNewer(version: String, current: String): Boolean {
        val a = parts(version) ?: return false
        val b = parts(current) ?: return true
        return compare(a, b) > 0
    }

    private fun parts(v: String): List<Int>? = Regex("^(\\d+)\\.(\\d+)\\.(\\d+)").find(v.trim())?.groupValues?.drop(1)?.map { it.toInt() }

    private fun compare(a: List<Int>, b: List<Int>): Int = a.zip(b).firstOrNull { (x, y) -> x != y }?.let { (x, y) -> x.compareTo(y) } ?: 0

    private fun text(o: JsonObject, key: String): String? = (o[key] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    private fun flag(o: JsonObject, key: String): Boolean = (o[key] as? JsonPrimitive)?.booleanOrNull == true
}
