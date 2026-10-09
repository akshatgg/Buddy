package com.akshatgg.buddy.cloud

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** What a Claude Code item is: the person's words, Claude's, a tool Claude ran, what it gave back, or a note. */
val REMOTE_KINDS = listOf("you", "claude", "tool", "result", "event")

// The ids the server takes (web/lib/remote.js): an id that cannot be one is left out, so it is never asked for.
private val SESSION_ID = Regex("^[\\w-]{1,100}$")

/**
 * A Claude Code session running on one of the person's computers, as it shares it: `status` is working, waiting, done,
 * failed or idle; `canTalk` whether Buddy there can type into its terminal (otherwise what the phone sends is copied
 * there); `device` the computer's name, null when it did not say (several computers can share at once).
 */
data class RemoteSession(val id: String, val name: String, val status: String, val canTalk: Boolean, val device: String? = null)

/** One item of a session, as the terminal shows it. `error`: a tool's result that failed. */
data class RemoteItem(val id: Int, val kind: String, val text: String, val error: Boolean = false)

/** The session the phone looks at, with its newest items. */
data class RemoteFeed(val session: RemoteSession, val items: List<RemoteItem>)

/**
 * One look from the phone (GET /api/remote/phone): whether the computer shares its sessions now, which, and the items
 * of the session asked for, once the computer has sent them (null until then).
 */
data class RemoteLook(val online: Boolean, val sessions: List<RemoteSession>, val feed: RemoteFeed?) {
    companion object {
        /** Anything missing or odd is left out, so a strange answer shows less rather than breaking the panel. */
        fun read(j: JsonObject): RemoteLook = RemoteLook(
            online = flag(j, "online"),
            sessions = (j["sessions"] as? JsonArray).orEmpty().mapNotNull { session(it as? JsonObject) }.distinctBy { it.id },
            feed = (j["feed"] as? JsonObject)?.let { f ->
                session(f)?.let { s ->
                    // The list shows items by their id: one seen twice would break it, so only the first is kept.
                    RemoteFeed(s, (f["items"] as? JsonArray).orEmpty().mapNotNull { item(it as? JsonObject) }.distinctBy { it.id })
                }
            },
        )

        private fun session(j: JsonObject?): RemoteSession? {
            val id = string(j, "id")?.takeIf { SESSION_ID.matches(it) } ?: return null
            val name = string(j, "name")?.trim()?.ifEmpty { null } ?: "Claude Code"
            return RemoteSession(id, name, string(j, "status") ?: "idle", flag(j, "canTalk"), string(j, "device")?.trim()?.ifEmpty { null })
        }

        // A kind the phone does not know shows as a note, as on the Mac.
        private fun item(j: JsonObject?): RemoteItem? {
            val v = j?.get("id") as? JsonPrimitive
            val id = v?.takeIf { !it.isString }?.contentOrNull?.toIntOrNull() ?: return null
            val text = string(j, "text") ?: return null
            val kind = string(j, "kind")?.takeIf { it in REMOTE_KINDS } ?: "event"
            return RemoteItem(id, kind, text, flag(j, "error"))
        }

        private fun string(j: JsonObject?, key: String): String? = (j?.get(key) as? JsonPrimitive)?.takeIf { it.isString }?.content

        private fun flag(j: JsonObject?, key: String): Boolean {
            val v = j?.get(key)
            return v is JsonPrimitive && !v.isString && v.contentOrNull == "true"
        }
    }
}
