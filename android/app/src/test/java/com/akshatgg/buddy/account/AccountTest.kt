package com.akshatgg.buddy.account

import com.akshatgg.buddy.FakeHttp
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.net.HttpResponse
import com.akshatgg.buddy.store.MemoryKeyValue
import com.akshatgg.buddy.store.MemorySecrets
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountTest {
    private val signedIn = """{"idToken":"id-1","refreshToken":"r-1","expiresIn":"3600","localId":"u1","email":"a@b.c","displayName":"Asha","photoUrl":"http://not-https"}"""
    private var clock = 1_000_000L
    private val kv = MemoryKeyValue()
    private val secrets = MemorySecrets()
    private fun account(http: FakeHttp) = Account(kv, secrets, FirebaseAuthApi(http, "KEY"), now = { clock })
    private suspend fun error(block: suspend () -> Unit): BuddyError = try { block(); throw AssertionError("no error") } catch (e: BuddyError) { e }

    @Test fun signingInKeepsTheUserAndTheRefreshTokenApart() = runTest {
        val http = FakeHttp { HttpResponse(200, signedIn) }
        val a = account(http)
        val user = a.signIn { "google-token" }
        assertEquals(User("u1", "a@b.c", "Asha", ""), user)
        assertEquals("r-1", secrets.get("account.refresh"))
        assertTrue(http.requests.single().url.startsWith("https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=KEY"))
        assertTrue(http.requests.single().body!!.contains("id_token=google-token&providerId=google.com"))
        assertEquals("id-1", a.idToken())
        assertTrue(account(FakeHttp { HttpResponse(500, "") }).isSignedIn()) // a new start remembers them
    }

    @Test fun anIdTokenIsRenewedFiveMinutesEarlyAndOnlyOnceForEveryone() = runTest {
        var refreshes = 0
        val http = FakeHttp { r ->
            if (r.url.contains("securetoken")) { refreshes++; HttpResponse(200, """{"id_token":"id-2","refresh_token":"r-2","expires_in":"3600"}""") }
            else HttpResponse(200, signedIn)
        }
        val a = account(http)
        a.signIn { "g" }
        clock += 3600_000L - 299_000L
        val both = listOf(async { a.idToken() }, async { a.idToken() }).map { it.await() }
        assertEquals(listOf("id-2", "id-2"), both)
        assertEquals(1, refreshes)
        assertEquals("r-2", secrets.get("account.refresh"))
        assertTrue(http.requests.last().body!!.contains("grant_type=refresh_token&refresh_token=r-1"))
    }

    @Test fun aRefreshTokenFirebaseNoLongerTakesSignsThePersonOut() = runTest {
        val http = FakeHttp { r -> if (r.url.contains("securetoken")) HttpResponse(400, """{"error":{"message":"TOKEN_EXPIRED"}}""") else HttpResponse(200, signedIn) }
        val a = account(http)
        a.signIn { "g" }
        val e = error { a.idToken(force = true) }
        assertEquals("signed_out", e.code)
        assertFalse(a.isSignedIn()); assertNull(a.user.value); assertNull(secrets.get("account.refresh"))
    }

    @Test fun otherRefusalsAndNoInternetKeepThePersonSignedIn() = runTest {
        var mode = "ok"
        val http = FakeHttp { r ->
            when {
                !r.url.contains("securetoken") -> HttpResponse(200, signedIn)
                mode == "busy" -> HttpResponse(503, """{"error":{"message":"UNAVAILABLE"}}""")
                else -> throw java.io.IOException("offline")
            }
        }
        val a = account(http)
        a.signIn { "g" }
        mode = "busy"
        assertEquals("auth_failed", error { a.idToken(force = true) }.code)
        mode = "offline"
        assertEquals("Couldn't reach Google. Check your internet.", error { a.idToken(force = true) }.message)
        assertTrue(a.isSignedIn())
    }

    @Test fun signingOutForgetsEverything() = runTest {
        val a = account(FakeHttp { HttpResponse(200, signedIn) })
        a.signIn { "g" }
        a.signOut()
        assertFalse(a.isSignedIn())
        assertEquals("signed_out", error { a.idToken() }.code)
        assertNull(kv.getString("account.user"))
    }

    @Test fun aCopyWithoutFirebaseSaysItIsNotSetUp() = runTest {
        val a = Account(kv, secrets, auth = null)
        assertEquals("not_set_up", error { a.signIn { "g" } }.code)
    }
}
