package com.akshatgg.buddy.account

import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.store.KeyValue
import com.akshatgg.buddy.store.Secrets
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

const val RENEW_EARLY_MS = 5 * 60_000L

private const val USER_KEY = "account.user"
private const val REFRESH_ID = "account.refresh"

private fun notSetUp() = BuddyError("not_set_up", "This copy of Buddy isn't set up for sign-in.")

/**
 * Who is signed in to Buddy. The Firebase refresh token is kept in the keystore-backed secrets, apart from the person's
 * uid, email, name and photo address. ID tokens stay in memory and are renewed a few minutes before they run out.
 * A refresh token Firebase no longer takes signs the person out.
 */
class Account(
    private val kv: KeyValue,
    private val secrets: Secrets,
    private val auth: FirebaseAuthApi?, // null: this copy has no Firebase key
    private val now: () -> Long = System::currentTimeMillis,
) {
    private class Token(val idToken: String, val expiresAt: Long)

    private val state = MutableStateFlow(read())
    val user: StateFlow<User?> = state

    // Counts sign-ins and sign-outs, so that a renewal can tell the person it started for is gone.
    @Volatile private var generation = 0
    @Volatile private var token: Token? = null // for the current person
    private val renewing = Mutex() // one renewal at a time; whoever waits finds the new token and uses it

    private fun JsonObject.string(name: String) = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

    // A user without a refresh token, or one the keystore can no longer decrypt, reads as signed out.
    private fun read(): User? {
        val j = try { Json.parseToJsonElement(kv.getString(USER_KEY) ?: return null) as? JsonObject } catch (e: Exception) { null } ?: return null
        val uid = j.string("uid")?.ifEmpty { null } ?: return null
        if (secrets.get(REFRESH_ID).isNullOrEmpty()) return null
        return User(uid, j.string("email") ?: "", j.string("name") ?: "", j.string("photo") ?: "")
    }

    private fun keep(user: User, refreshToken: String) {
        kv.putString(USER_KEY, buildJsonObject {
            put("uid", user.uid); put("email", user.email); put("name", user.name); put("photo", user.photo)
        }.toString())
        secrets.set(REFRESH_ID, refreshToken)
    }

    private fun forget() {
        generation++
        token = null
        kv.putString(USER_KEY, null)
        secrets.clear(REFRESH_ID)
        state.value = null
    }

    fun isSignedIn(): Boolean = state.value != null

    /** Sign in with the Google account `googleIdToken` picks. */
    suspend fun signIn(googleIdToken: suspend () -> String): User {
        val api = auth ?: throw notSetUp()
        val r = api.signInWithGoogle(googleIdToken())
        generation++
        keep(r.user, r.refreshToken)
        token = Token(r.idToken, now() + r.expiresInSec * 1000)
        state.value = r.user
        return r.user
    }

    fun signOut() {
        if (state.value != null) forget()
    }

    private suspend fun renew(): String {
        val who = generation
        val person = state.value ?: throw signedOut()
        val refreshToken = secrets.get(REFRESH_ID)?.ifEmpty { null }
        if (refreshToken == null) {
            // The keystore no longer has what was saved (a new phone, a reset): sign in again.
            if (generation == who) forget()
            throw signedOut()
        }
        val r = try {
            auth!!.refresh(refreshToken)
        } catch (e: BuddyError) {
            if (e.code == "signed_out" && generation == who) forget()
            throw e
        }
        if (generation != who) throw signedOut() // signed out (or in as someone else) meanwhile: this token is not theirs
        if (r.refreshToken != refreshToken) keep(person, r.refreshToken)
        token = Token(r.idToken, now() + r.expiresInSec * 1000)
        return r.idToken
    }

    private fun fresh(): String? = token?.takeIf { it.expiresAt - RENEW_EARLY_MS > now() }?.idToken

    /** An ID token for Buddy's server; renewed when it runs out within five minutes, or always with `force`. */
    suspend fun idToken(force: Boolean = false): String {
        if (state.value == null) throw signedOut()
        if (auth == null) throw notSetUp()
        if (!force) fresh()?.let { return it }
        val before = token
        return renewing.withLock {
            if (state.value == null) throw signedOut()
            // Someone renewed while this call waited: theirs is as good as a renewal of its own.
            if (token !== before) fresh()?.let { return@withLock it }
            renew()
        }
    }
}
