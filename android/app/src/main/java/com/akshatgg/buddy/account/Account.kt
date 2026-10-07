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

internal fun notSetUp() = BuddyError("not_set_up", "This copy of Buddy isn't set up for sign-in.")

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

    // Sign-in, sign-out and the end of a renewal each change what is saved. They take this lock, and a renewal checks
    // `generation` inside it, so that a sign-out on one thread is never undone by a renewal finishing on another.
    private val commit = Any()

    private fun keep(user: User, refreshToken: String) {
        try {
            secrets.set(REFRESH_ID, refreshToken) // first: if the keystore fails, nothing half-saved is left behind
        } catch (e: Exception) {
            throw BuddyError("no_keychain", "Your phone's keystore is not available, so Buddy cannot keep you signed in.")
        }
        kv.putString(USER_KEY, buildJsonObject {
            put("uid", user.uid); put("email", user.email); put("name", user.name); put("photo", user.photo)
        }.toString())
    }

    private fun forget() = synchronized(commit) {
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
        synchronized(commit) {
            generation++
            keep(r.user, r.refreshToken)
            token = Token(r.idToken, now() + r.expiresInSec * 1000)
            state.value = r.user
        }
        return r.user
    }

    /** Always forgets what is saved, even when nobody usable was signed in: the Mac removes account.json every time. */
    fun signOut() = forget()

    // A renewal that failed is told to everyone who was waiting for it, as the Mac's shared `renewing` promise is.
    @Volatile private var renewals = 0
    @Volatile private var lastFailure: BuddyError? = null

    private suspend fun renewOnce(): String {
        try {
            val id = renew()
            lastFailure = null
            return id
        } catch (e: BuddyError) {
            lastFailure = e
            throw e
        } finally {
            renewals++
        }
    }

    private suspend fun renew(): String {
        val who = generation
        val person = state.value ?: throw signedOut()
        val refreshToken = secrets.get(REFRESH_ID)?.ifEmpty { null }
        if (refreshToken == null) {
            // The keystore no longer has what was saved (a new phone, a reset): sign in again.
            synchronized(commit) { if (generation == who) forget() }
            throw signedOut()
        }
        val r = try {
            auth!!.refresh(refreshToken)
        } catch (e: BuddyError) {
            if (e.code == "signed_out") synchronized(commit) { if (generation == who) forget() }
            throw e
        }
        synchronized(commit) {
            if (generation != who) throw signedOut() // signed out (or in as someone else) meanwhile: this token is not theirs
            if (r.refreshToken != refreshToken) keep(person, r.refreshToken)
            token = Token(r.idToken, now() + r.expiresInSec * 1000)
        }
        return r.idToken
    }

    private fun fresh(): String? = token?.takeIf { it.expiresAt - RENEW_EARLY_MS > now() }?.idToken

    /** An ID token for Buddy's server; renewed when it runs out within five minutes, or always with `force`. */
    suspend fun idToken(force: Boolean = false): String {
        if (state.value == null) throw signedOut()
        if (auth == null) throw notSetUp()
        val before = token
        val seen = renewals
        if (!force) fresh()?.let { return it }
        return renewing.withLock {
            if (state.value == null) throw signedOut()
            // A renewal finished while this call waited: its answer, or its failure, is this call's too.
            if (renewals != seen) {
                lastFailure?.let { throw it }
                if (token !== before) fresh()?.let { return@withLock it }
            }
            renewOnce()
        }
    }
}
