package com.akshatgg.buddy.net

import com.akshatgg.buddy.account.Account
import com.akshatgg.buddy.account.FirebaseAuthApi
import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.AskInput
import com.akshatgg.buddy.ai.providers.ProviderHttp
import com.akshatgg.buddy.cloud.CloudClient
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.MemoryKeyValue
import com.akshatgg.buddy.store.MemorySecrets
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.InterruptedIOException

/**
 * A request whose caller lets go of it can still end in an IOException: a read that is interrupted, or whose connection
 * is closed under it, fails with one. Every layer that turns an IOException into "no internet" must pass the
 * cancellation on as one instead.
 */
@OptIn(ExperimentalCoroutinesApi::class) // runCurrent
class LetGoRequestsTest {
    private val signedIn = """{"idToken":"id","refreshToken":"r","expiresIn":"3600","localId":"u","email":"a@b.c","displayName":"A"}"""

    // Signs in at once; anything else waits until it is let go of, then fails as an interrupted read does.
    private val http = object : Http {
        override suspend fun send(request: HttpRequest): HttpResponse {
            if (request.url.contains("identitytoolkit")) return HttpResponse(200, signedIn)
            try {
                awaitCancellation()
            } catch (e: CancellationException) {
                throw InterruptedIOException("interrupted")
            }
        }
    }

    /** How `call` ends when its caller lets go of it. */
    private fun TestScope.endWhenLetGo(call: suspend () -> Unit): Throwable? {
        var ended: Throwable? = null
        val job = launch {
            try {
                call()
            } catch (t: Throwable) {
                ended = t
                throw t
            }
        }
        runCurrent()
        job.cancel()
        runCurrent()
        return ended
    }

    @Test fun anAiLetGoOfIsCancelledNotOffline() = runTest {
        val ended = endWhenLetGo { ProviderHttp.requestJson(http, "Claude", "https://api.anthropic.com/v1/messages") }
        assertTrue("ended with $ended", ended is CancellationException)
    }

    @Test fun buddysServerLetGoOfIsCancelledNotOffline() = runTest {
        val kv = MemoryKeyValue()
        val account = Account(kv, MemorySecrets(), FirebaseAuthApi(http, "KEY"))
        account.signIn { "g" }
        val cloud = CloudClient(http, "https://srv", account, AppSettings(kv))
        val ended = endWhenLetGo { cloud.ask(Action.WRITE, AskInput(instruction = "x")) }
        assertTrue("ended with $ended", ended is CancellationException)
    }

    @Test fun googleLetGoOfIsCancelledNotOffline() = runTest {
        val ended = endWhenLetGo { FirebaseAuthApi(http, "KEY").refresh("r") }
        assertTrue("ended with $ended", ended is CancellationException)
    }
}
