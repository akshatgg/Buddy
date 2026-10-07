package com.akshatgg.buddy.account

import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.net.Http
import com.akshatgg.buddy.net.HttpRequest
import com.akshatgg.buddy.net.HttpResponse
import com.akshatgg.buddy.store.MemoryKeyValue
import com.akshatgg.buddy.store.MemorySecrets
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import com.akshatgg.buddy.store.Secrets
import org.junit.Test

class AccountConcurrencyTest {
    private val signedIn = """{"idToken":"id-1","refreshToken":"r-1","expiresIn":"3600","localId":"u1","email":"a@b.c","displayName":"Asha"}"""
    private val signedIn2 = """{"idToken":"id-B","refreshToken":"r-B","expiresIn":"3600","localId":"u2","email":"b@b.c","displayName":"Bo"}"""
    private var clock = 1_000_000L
    private val kv = MemoryKeyValue()
    private val secrets = MemorySecrets()

    class GateHttp(var signInBody: String, val refreshAnswer: suspend () -> HttpResponse) : Http {
        var refreshes = 0
        override suspend fun send(request: HttpRequest): HttpResponse =
            if (request.url.contains("securetoken")) { refreshes++; refreshAnswer() } else HttpResponse(200, signInBody)
    }

    private suspend fun err(block: suspend () -> Any): Any = try { block() } catch (e: BuddyError) { e.code }

    @Test fun concurrentCallsShareOneRefreshWhenItReallySuspends() = runTest {
        val gate = CompletableDeferred<HttpResponse>()
        val http = GateHttp(signedIn) { gate.await() }
        val a = Account(kv, secrets, FirebaseAuthApi(http, "KEY"), now = { clock })
        a.signIn { "g" }
        clock += 3600_000L - 299_000L
        val calls = List(3) { async { a.idToken() } }
        runCurrent()
        gate.complete(HttpResponse(200, """{"id_token":"id-2","refresh_token":"r-2","expires_in":"3600"}"""))
        assertEquals(listOf("id-2", "id-2", "id-2"), calls.map { it.await() })
        assertEquals(1, http.refreshes)
    }

    @Test fun forcedConcurrentCallsShareOneRefresh() = runTest {
        val gate = CompletableDeferred<HttpResponse>()
        val http = GateHttp(signedIn) { gate.await() }
        val a = Account(kv, secrets, FirebaseAuthApi(http, "KEY"), now = { clock })
        a.signIn { "g" }
        val calls = List(2) { async { a.idToken(force = true) } }
        runCurrent()
        gate.complete(HttpResponse(200, """{"id_token":"id-2","refresh_token":"r-2","expires_in":"3600"}"""))
        assertEquals(listOf("id-2", "id-2"), calls.map { it.await() })
        assertEquals(1, http.refreshes)
    }

    @Test fun signOutDuringRenewalKeepsNothing() = runTest {
        val gate = CompletableDeferred<HttpResponse>()
        val http = GateHttp(signedIn) { gate.await() }
        val a = Account(kv, secrets, FirebaseAuthApi(http, "KEY"), now = { clock })
        a.signIn { "g" }
        val call = async { err { a.idToken(force = true) } }
        val waiter = async { err { a.idToken(force = true) } }
        runCurrent()
        a.signOut()
        gate.complete(HttpResponse(200, """{"id_token":"id-2","refresh_token":"r-2","expires_in":"3600"}"""))
        assertEquals("signed_out", call.await())
        assertEquals("signed_out", waiter.await())
        assertNull(secrets.get("account.refresh")); assertNull(kv.getString("account.user")); assertNull(a.user.value)
        assertEquals("signed_out", err { a.idToken() })
        assertEquals(1, http.refreshes)
    }

    @Test fun signOutAndInAsSomeoneElseDuringRenewal() = runTest {
        val gate = CompletableDeferred<HttpResponse>()
        val http = GateHttp(signedIn) { gate.await() }
        val a = Account(kv, secrets, FirebaseAuthApi(http, "KEY"), now = { clock })
        a.signIn { "g" }
        val call = async { err { a.idToken(force = true) } }
        runCurrent()
        a.signOut()
        http.signInBody = signedIn2
        a.signIn { "g2" }
        gate.complete(HttpResponse(200, """{"id_token":"id-2","refresh_token":"r-2","expires_in":"3600"}"""))
        assertEquals("signed_out", call.await())
        assertEquals("r-B", secrets.get("account.refresh"))
        assertEquals("id-B", a.idToken())
        assertEquals("u2", a.user.value?.uid)
    }

    @Test fun signedOutAnswerDuringSignOutAndInDoesNotForgetTheNewPerson() = runTest {
        val gate = CompletableDeferred<HttpResponse>()
        val http = GateHttp(signedIn) { gate.await() }
        val a = Account(kv, secrets, FirebaseAuthApi(http, "KEY"), now = { clock })
        a.signIn { "g" }
        val call = async { err { a.idToken(force = true) } }
        runCurrent()
        a.signOut()
        http.signInBody = signedIn2
        a.signIn { "g2" }
        gate.complete(HttpResponse(400, """{"error":{"message":"TOKEN_EXPIRED"}}"""))
        assertEquals("signed_out", call.await())
        assertEquals("u2", a.user.value?.uid)
        assertEquals("r-B", secrets.get("account.refresh"))
    }

    @Test fun aFailedRefreshIsToldToEveryoneWhoWaitedForIt() = runTest {
        val gate = CompletableDeferred<HttpResponse>()
        val http = GateHttp(signedIn) { gate.await() }
        val a = Account(kv, secrets, FirebaseAuthApi(http, "KEY"), now = { clock })
        a.signIn { "g" }
        val calls = List(3) { async { err { a.idToken(force = true) } } }
        runCurrent()
        gate.complete(HttpResponse(503, """{"error":{"message":"UNAVAILABLE"}}"""))
        assertEquals(listOf<Any>("auth_failed", "auth_failed", "auth_failed"), calls.map { it.await() })
        assertEquals(1, http.refreshes)
        assertEquals("u1", a.user.value?.uid)
    }

    @Test fun signOutForgetsEvenWhenNothingUsableWasSaved() = runTest {
        kv.putString("account.user", "{\"uid\":\"u1\"}") // a user whose refresh secret is gone
        val a = Account(kv, secrets, FirebaseAuthApi(GateHttp(signedIn) { HttpResponse(500, "") }, "KEY"), now = { clock })
        assertFalse(a.isSignedIn())
        a.signOut()
        assertNull(kv.getString("account.user"))
    }

    @Test fun aKeystoreThatFailsIsSaidSo() = runTest {
        val broken = object : Secrets by secrets {
            override fun set(id: String, value: String) = throw IllegalStateException("keystore")
        }
        val a = Account(kv, broken, FirebaseAuthApi(GateHttp(signedIn) { HttpResponse(500, "") }, "KEY"), now = { clock })
        assertEquals("no_keychain", err { a.signIn { "g" } })
        assertNull(kv.getString("account.user"))
    }

    @Test fun aCopyWithoutFirebaseSaysNotSetUpForATokenToo() = runTest {
        kv.putString("account.user", "{\"uid\":\"u1\"}"); secrets.set("account.refresh", "r")
        val a = Account(kv, secrets, auth = null)
        assertEquals("not_set_up", err { a.idToken() })
    }

    @Test fun aTimeoutIsSaidSo() = runTest {
        val http = object : Http {
            override suspend fun send(request: HttpRequest): HttpResponse = throw java.net.SocketTimeoutException()
        }
        val a = Account(kv, secrets, FirebaseAuthApi(http, "KEY"), now = { clock })
        val e = try { a.signIn { "g" }; null } catch (e: BuddyError) { e }
        assertEquals("timeout", e?.code)
        assertEquals("Google took too long to answer. Try again.", e?.message)
    }
}
