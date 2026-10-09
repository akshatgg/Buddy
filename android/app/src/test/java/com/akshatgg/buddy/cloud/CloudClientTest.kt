package com.akshatgg.buddy.cloud

import com.akshatgg.buddy.FakeHttp
import com.akshatgg.buddy.account.Account
import com.akshatgg.buddy.account.FirebaseAuthApi
import com.akshatgg.buddy.ai.Action
import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.AskInput
import com.akshatgg.buddy.ai.ChatTurn
import com.akshatgg.buddy.ai.CheckResult
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.net.Http
import com.akshatgg.buddy.net.HttpRequest
import com.akshatgg.buddy.net.HttpResponse
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.MemoryKeyValue
import com.akshatgg.buddy.store.MemorySecrets
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.net.SocketTimeoutException

class CloudClientTest {
    private val signedIn = """{"idToken":"id","refreshToken":"r","expiresIn":"3600","localId":"u","email":"a@b.c","displayName":"A"}"""
    private val kept = FreeSettings(freeOn = true, limitMode = "daily", limit = 30, usedToday = 2, allowOwnKey = false, blocked = false, isAdmin = false)
    private fun config(usedToday: Int = 2) =
        HttpResponse(200, """{"freeOn":true,"limitMode":"daily","limit":30,"usedToday":$usedToday,"allowOwnKey":false,"blocked":false,"isAdmin":false}""")
    private val serverProblem = "Buddy's server had a problem. Try again."

    private var clock = 5_000_000L
    // What Buddy's server answers, in turn: an HttpResponse, or an exception the request throws. With none left the
    // request fails like no internet.
    private val answers = ArrayDeque<Any>()
    private fun serve(vararg next: Any) = answers.addAll(next)
    private val http = FakeHttp { r ->
        when {
            r.url.contains("identitytoolkit") -> HttpResponse(200, signedIn)
            r.url.contains("securetoken") -> HttpResponse(200, """{"id_token":"fresh","refresh_token":"r","expires_in":"3600"}""")
            else -> when (val next = answers.removeFirstOrNull()) {
                null -> throw IOException("offline")
                is Exception -> throw next
                else -> next as HttpResponse
            }
        }
    }
    private val kv = MemoryKeyValue()
    private val secrets = MemorySecrets()
    private val settings = AppSettings(kv)
    private val account = Account(kv, secrets, FirebaseAuthApi(http, "KEY"), now = { clock })
    private fun client(serverUrl: String = "https://srv", with: Http = http) = CloudClient(with, serverUrl, account, settings, now = { clock })
    private fun toServer() = http.requests.filter { it.url.startsWith("https://srv") }
    private suspend fun error(block: suspend () -> Unit): BuddyError = try { block(); throw AssertionError("no error") } catch (e: BuddyError) { e }
    private suspend fun signIn() = account.signIn { "g" }

    @Test fun settingsAreFetchedWithTheIdTokenKeptAndFetchedAtMostOnceAMinuteUnlessForced() = runTest {
        signIn()
        serve(config(2), config(3), config(4))
        val cloud = client()
        assertEquals(kept, cloud.settings())
        assertEquals(kept, settings.cloud)
        assertEquals(kept, cloud.free.value)
        val req = toServer().single()
        assertEquals(listOf("https://srv/api/config", "GET", "Bearer id", 8_000), listOf(req.url, req.method, req.headers["authorization"], req.timeoutMs))
        assertNull(req.headers["content-type"])

        clock += 59_999
        assertEquals("the kept ones", 2, cloud.settings()?.usedToday)
        assertEquals("not asked again", 1, toServer().size)
        assertEquals(3, cloud.settings(force = true)?.usedToday)
        assertEquals(3, cloud.free.value?.usedToday)
        clock += 60_000
        assertEquals(4, cloud.settings()?.usedToday)
        assertEquals(3, toServer().size)
    }

    @Test fun outOfReachWithSettingsKeptGivesThemAndIsNotAskedAgainForAMinute() = runTest {
        signIn()
        settings.cloud = kept // from an earlier run
        val cloud = client()
        assertEquals(kept, cloud.free.value)
        serve(SocketTimeoutException("slow")) // then none: like no internet
        assertEquals(kept, cloud.settings())
        clock += 59_999
        assertEquals(kept, cloud.settings())
        assertEquals("not asked again", 1, toServer().size)
        assertEquals(kept, cloud.settings(force = true))
        assertEquals("force still asks", 2, toServer().size)
        clock += 60_000
        cloud.settings()
        assertEquals("a minute later, it is asked again", 3, toServer().size)
    }

    @Test fun outOfReachWithNothingKeptIsAskedAgainAtOnce() = runTest {
        signIn()
        for (failure in listOf(SocketTimeoutException("slow"), IOException("offline"), HttpResponse(500, "<html>"), HttpResponse(503, """{"error":{"code":"server","message":"$serverProblem"}}"""))) {
            val cloud = client()
            val before = toServer().size
            serve(failure, config())
            assertNull("$failure: nothing was ever kept", cloud.settings())
            clock += 1
            assertEquals("$failure: asked again, and this time answered", kept, cloud.settings())
            assertEquals(before + 2, toServer().size)
            cloud.forget()
        }
    }

    @Test fun aTokenTheServerTurnsDownIsRenewedOnceAndTheCallMadeAgain() = runTest {
        signIn()
        serve(HttpResponse(401, "{}"), config())
        assertEquals(kept, client().settings())
        val where = http.requests.map { r -> listOf("identitytoolkit", "securetoken", "/api/config").first { r.url.contains(it) } }
        assertEquals(listOf("identitytoolkit", "/api/config", "securetoken", "/api/config"), where)
        assertEquals(listOf("Bearer id", "Bearer fresh"), toServer().map { it.headers["authorization"] })
    }

    @Test fun turnedDownAgainByTheServerItselfSignsThePersonOutAndForgetsTheSettings() = runTest {
        signIn()
        settings.cloud = kept
        val cloud = client()
        serve(
            HttpResponse(401, "{}"),
            HttpResponse(401, """{"error":{"code":"unauthenticated","message":"Sign in with a Google account whose email is verified."}}"""),
        )
        val e = error { cloud.settings() }
        assertEquals(listOf("signed_out", "Sign in with a Google account whose email is verified."), listOf(e.code, e.message))
        assertFalse(account.isSignedIn())
        assertNull(settings.cloud)
        assertNull(cloud.free.value)
    }

    @Test fun aSecond401ThatIsNotTheServersOwnSignsNobodyOut() = runTest {
        signIn()
        val cloud = client()
        for (body in listOf(
            "<html>Log in</html>", // a hosting page, such as Vercel's Deployment Protection
            """{"error":{"code":"NOT_AUTHORIZED","message":"You are not authorized."}}""",
            """{"error":"unauthenticated"}""",
            """{"error":{"code":"unauthenticated"}}""", // no message: not Buddy's
        )) {
            serve(HttpResponse(401, body), HttpResponse(401, body))
            val e = error { cloud.ask(Action.FIX, AskInput(text = "x")) }
            assertEquals(body, listOf("server", serverProblem), listOf(e.code, e.message))
            assertTrue(body, account.isSignedIn())
        }
    }

    @Test fun theServersOwnErrorsComeThroughInItsWordsAndAnythingElseInBuddys() = runTest {
        signIn()
        val cloud = client()
        serve(
            HttpResponse(403, """{"error":{"code":"blocked","message":"Your free access is paused."}}"""),
            HttpResponse(404, """{"error":{"code":"NOT_FOUND","message":"The page could not be found."}}"""), // the hosting platform's
            HttpResponse(503, """{"error":{"code":"server","message":"$serverProblem"}}"""),
            HttpResponse(200, "not JSON"),
            HttpResponse(200, """{"model":"m"}"""),
        )
        val blocked = error { cloud.ask(Action.FIX, AskInput(text = "x")) }
        assertEquals(listOf("blocked", "Your free access is paused."), listOf(blocked.code, blocked.message))
        repeat(4) {
            val e = error { cloud.ask(Action.FIX, AskInput(text = "x")) }
            assertEquals(listOf("server", serverProblem), listOf(e.code, e.message))
        }
    }

    @Test fun noInternetAndAServerThatTakesTooLong() = runTest {
        signIn()
        val cloud = client()
        assertEquals("Couldn't reach Buddy's server. Check your internet.", error { cloud.ask(Action.FIX, AskInput(text = "x")) }.message)
        serve(SocketTimeoutException("slow"))
        val e = error { cloud.ask(Action.FIX, AskInput(text = "x")) }
        assertEquals(listOf("timeout", "Buddy's server took too long to answer. Try again."), listOf(e.code, e.message))
    }

    @Test fun forgetEmptiesTheKeptSettings() {
        settings.cloud = kept
        val cloud = client()
        cloud.forget()
        assertNull(settings.cloud)
        assertNull(cloud.free.value)
        assertNull(cloud.last())
    }

    @OptIn(ExperimentalCoroutinesApi::class) // runCurrent
    @Test fun settingsThatArriveAfterForgetAreNotKept() = runTest {
        signIn()
        settings.cloud = kept
        val gate = CompletableDeferred<HttpResponse>()
        var asked = 0
        val held = object : Http {
            override suspend fun send(request: HttpRequest): HttpResponse { asked++; return gate.await() }
        }
        val cloud = client(with = held)
        val pending = async { cloud.settings(force = true) }
        runCurrent() // the fetch is under way
        cloud.forget()
        gate.complete(HttpResponse(200, """{"freeOn":true,"limitMode":"unlimited","isAdmin":true}"""))
        assertNull("the last known settings, which are none now", pending.await())
        assertNull("nothing was kept", settings.cloud)
        assertNull(cloud.free.value)
        cloud.settings()
        assertEquals("the next call asks the server again", 2, asked)
    }

    @Test fun askSendsOnlyTheInputsItHasAndReadsACheckFromTheText() = runTest {
        signIn()
        val cloud = client()
        val text = "```json\n{\"verdict\":\"problems\",\"problems\":[\"A typo\"],\"corrected\":\"Fixed\"}\n```"
        serve(
            // The server's own reading of the Check, which never reaches the panel.
            HttpResponse(200, buildJsonObject { put("text", text); put("model", "m"); put("check", Json.parseToJsonElement("""{"verdict":"good","problems":[]}""")) }.toString()),
            HttpResponse(200, """{"text":"Fixed","model":"m","check":{"verdict":"good","problems":[]}}"""),
        )
        assertEquals(
            Answer(text, "m", CheckResult.Verdict(good = false, problems = listOf("A typo"), corrected = "Fixed")),
            cloud.ask(Action.CHECK, AskInput(image = "IMG")),
        )
        val req = toServer().single()
        assertEquals(listOf("https://srv/api/ask", "POST", "application/json", "Bearer id"), listOf(req.url, req.method, req.headers["content-type"], req.headers["authorization"]))
        assertEquals(Json.parseToJsonElement("""{"action":"check","image":"IMG"}"""), Json.parseToJsonElement(req.body!!))
        assertEquals("only a Check has one", Answer("Fixed", "m"), cloud.ask(Action.FIX, AskInput(text = "x", tone = "casual")))
        assertEquals(Json.parseToJsonElement("""{"action":"fix","tone":"casual","text":"x"}"""), Json.parseToJsonElement(toServer().last().body!!))
    }

    @Test fun aChatSendsItsFieldsHistoryAsMessagesAndFactsAsAList() = runTest {
        signIn()
        val cloud = client()
        serve(HttpResponse(200, """{"text":"{\"kind\":\"answer\"}","model":"m"}"""))
        val input = AskInput(
            message = "fix this", selection = "i am go", history = listOf(ChatTurn("you", "hi"), ChatTurn("buddy", "Hello!")),
            facts = listOf("Your boss is Mr. Sharma."), appName = "Gmail", userName = "Akshat", step = 1,
        )
        assertEquals("{\"kind\":\"answer\"}", cloud.ask(Action.CHAT, input).text)
        val body = """{"action":"chat","message":"fix this","selection":"i am go","history":[{"from":"you","text":"hi"},{"from":"buddy","text":"Hello!"}],"facts":["Your boss is Mr. Sharma."],"appName":"Gmail","userName":"Akshat","step":1}"""
        assertEquals(Json.parseToJsonElement(body), Json.parseToJsonElement(toServer().single().body!!))
    }

    @Test fun aCopyWithNoServerCallsNothing() = runTest {
        settings.cloud = kept
        val cloud = client(serverUrl = "")
        for (e in listOf(error { cloud.ask(Action.FIX, AskInput(text = "x")) }, error { cloud.settings() })) {
            assertEquals(listOf("not_set_up", "This copy of Buddy isn't set up for sign-in."), listOf(e.code, e.message))
        }
        assertEquals(emptyList<HttpRequest>(), http.requests)
    }
    @Test fun voiceOnIsReadFromTheSettingsAndAnythingOddReadsAsOff() = runTest {
        signIn()
        val cloud = client()
        serve(HttpResponse(200, """{"freeOn":false,"voiceOn":true}"""))
        assertTrue(cloud.voiceOn())
        assertTrue("kept with the settings", settings.cloud!!.voiceOn)
        assertTrue("and read back", FreeSettings.fromJson(settings.cloud!!.toJson())!!.voiceOn)
        for (odd in listOf("""{}""", """{"voiceOn":"true"}""", """{"voiceOn":1}""", """{"voiceOn":null}""")) {
            assertFalse(odd, FreeSettings.read(Json.parseToJsonElement(odd) as JsonObject).voiceOn)
        }
        cloud.forget()
        assertFalse("off when it was never known (no internet, nothing kept)", cloud.voiceOn())
    }

    @Test fun transcribeSendsTheRecordingAsBase64WithTheIdTokenAndGivesTheWords() = runTest {
        signIn()
        val cloud = client()
        serve(HttpResponse(200, """{"text":"Kal mujhe chutti chahiye."}"""))
        assertEquals("Kal mujhe chutti chahiye.", cloud.transcribe(byteArrayOf(0, 1, 2, -1, 127)))
        val req = toServer().single()
        assertEquals(
            listOf("https://srv/api/transcribe", "POST", "application/json", "Bearer id", 45_000),
            listOf(req.url, req.method, req.headers["content-type"], req.headers["authorization"], req.timeoutMs),
        )
        assertEquals(Json.parseToJsonElement("""{"audio":"AAEC/38=","mime":"audio/mp4"}"""), Json.parseToJsonElement(req.body!!))
    }

    @Test fun transcribeErrorsComeThroughInTheServersWords() = runTest {
        signIn()
        val cloud = client()
        val said = listOf(
            "voice_off" to "Voice isn't set up yet.",
            "voice_busy" to "Voice is busy right now. Type, or try again in a minute.",
            "upstream" to "I couldn't write down what you said. Try again.",
            "bad_request" to "That recording didn't come through. Try again.",
        )
        serve(
            HttpResponse(503, """{"error":{"code":"voice_off","message":"Voice isn't set up yet."}}"""),
            HttpResponse(429, """{"error":{"code":"voice_busy","message":"Voice is busy right now. Type, or try again in a minute."}}"""),
            HttpResponse(502, """{"error":{"code":"upstream","message":"I couldn't write down what you said. Try again."}}"""),
            HttpResponse(400, """{"error":{"code":"bad_request","message":"That recording didn't come through. Try again."}}"""),
            HttpResponse(200, """{"model":"m"}"""), // no words in it
        )
        for ((code, message) in said) {
            val e = error { cloud.transcribe(byteArrayOf(1)) }
            assertEquals(listOf(code, message), listOf(e.code, e.message))
        }
        val e = error { cloud.transcribe(byteArrayOf(1)) }
        assertEquals(listOf("server", serverProblem), listOf(e.code, e.message))
    }

    @Test fun anEmptyOrTooBigRecordingIsNotSent() = runTest {
        signIn()
        val cloud = client()
        for (audio in listOf(ByteArray(0), ByteArray(2_000_001))) {
            val e = error { cloud.transcribe(audio) }
            assertEquals(listOf("bad_request", "That recording didn't come through. Try again."), listOf(e.code, e.message))
        }
        assertEquals(emptyList<HttpRequest>(), toServer())
        serve(HttpResponse(200, """{"text":"ok"}"""))
        assertEquals("2 MB is still taken", "ok", cloud.transcribe(ByteArray(2_000_000)))
    }

    // ---- Claude mode ----

    private val offline = "None of your computers is sharing right now. Keep Buddy open on one, with Settings → Claude Code → Show my sessions on my other devices on."
    private val gone = "That session is not running any more. Pick another one."

    @Test fun remoteLookAsksForTheSessionsWithTheIdTokenAndReadsThem() = runTest {
        signIn()
        val cloud = client()
        serve(HttpResponse(200, """{"online":true,"sessions":[{"id":"s-1","name":"buddy","status":"working","canTalk":true},{"id":"s_2","name":"web","status":"waiting","canTalk":false}],"feed":null}"""))
        assertEquals(
            RemoteLook(true, listOf(RemoteSession("s-1", "buddy", "working", true), RemoteSession("s_2", "web", "waiting", false)), null),
            cloud.remoteLook(),
        )
        val req = toServer().single()
        assertEquals(listOf("https://srv/api/remote/phone", "GET", "Bearer id", 10_000), listOf(req.url, req.method, req.headers["authorization"], req.timeoutMs))
        assertNull(req.body)
        assertNull(req.headers["content-type"])
    }

    @Test fun remoteLookAtASessionAsksForItAndReadsItsItems() = runTest {
        signIn()
        val cloud = client()
        serve(
            HttpResponse(200, """{"online":true,"sessions":[{"id":"s-1","name":"buddy","status":"done","canTalk":true}],"feed":{"id":"s-1","name":"buddy","status":"done","canTalk":true,"items":[{"id":1,"kind":"you","text":"fix the tests"},{"id":2,"kind":"tool","text":"Bash(npm test)"},{"id":3,"kind":"result","text":"1 failed","error":true},{"id":4,"kind":"claude","text":"Fixed."}]}}"""),
            HttpResponse(200, """{"online":true,"sessions":[{"id":"s-1","name":"buddy","status":"working","canTalk":true}],"feed":null}"""),
        )
        val session = RemoteSession("s-1", "buddy", "done", true)
        val items = listOf(RemoteItem(1, "you", "fix the tests"), RemoteItem(2, "tool", "Bash(npm test)"), RemoteItem(3, "result", "1 failed", error = true), RemoteItem(4, "claude", "Fixed."))
        assertEquals(RemoteLook(true, listOf(session), RemoteFeed(session, items)), cloud.remoteLook("s-1"))
        assertEquals("https://srv/api/remote/phone?session=s-1", toServer().single().url)
        assertNull("not sent yet by the computer", cloud.remoteLook("s-1").feed)
    }

    @Test fun remoteLookLeavesOutWhatIsOdd() = runTest {
        signIn()
        val cloud = client()
        serve(
            HttpResponse(200, """{"online":"true","sessions":"none","feed":[]}"""),
            HttpResponse(200, """{"online":true,"sessions":[{"id":"bad id"},{"name":"no id"},{"id":"a","name":"  ","status":"sleeping"},{"id":"a","name":"twice"},7],"feed":{"id":"a","items":[{"id":1,"kind":"poem","text":"x"},{"id":"2","kind":"you","text":"y"},{"id":1,"kind":"you","text":"again"},{"id":3,"kind":"you"},{"id":4,"kind":"claude","text":"ok","error":"yes"}]}}"""),
        )
        assertEquals(RemoteLook(false, emptyList(), null), cloud.remoteLook())
        val a = RemoteSession("a", "Claude Code", "sleeping", false)
        assertEquals(
            RemoteLook(true, listOf(a), RemoteFeed(RemoteSession("a", "Claude Code", "idle", false), listOf(RemoteItem(1, "event", "x"), RemoteItem(4, "claude", "ok")))),
            cloud.remoteLook("a"),
        )
    }

    @Test fun remoteLookReadsWhichComputerASessionRunsOn() = runTest {
        signIn()
        val cloud = client()
        serve(HttpResponse(200, """{"online":true,"sessions":[{"id":"a","name":"buddy","status":"idle","canTalk":true,"device":"Akshat's MacBook Air"},{"id":"b","name":"web","status":"idle","canTalk":true,"device":"  "},{"id":"c","name":"api","status":"idle","canTalk":true,"device":7}],"feed":{"id":"a","name":"buddy","status":"idle","canTalk":true,"device":"Akshat's MacBook Air","items":[]}}"""))
        val r = cloud.remoteLook("a")
        assertEquals(listOf("Akshat's MacBook Air", null, null), r.sessions.map { it.device })
        assertEquals("Akshat's MacBook Air", r.feed?.session?.device)
    }

    @Test fun remoteSendAndStopPostTheirAction() = runTest {
        signIn()
        val cloud = client()
        serve(HttpResponse(200, """{"sent":true}"""), HttpResponse(200, "{}"))
        cloud.remoteSend("s-1", "run the tests")
        cloud.remoteStop()
        val (send, stop) = toServer()
        assertEquals(
            listOf("https://srv/api/remote/phone", "POST", "application/json", "Bearer id", 10_000),
            listOf(send.url, send.method, send.headers["content-type"], send.headers["authorization"], send.timeoutMs),
        )
        assertEquals(Json.parseToJsonElement("""{"action":"send","session":"s-1","text":"run the tests"}"""), Json.parseToJsonElement(send.body!!))
        assertEquals(listOf("https://srv/api/remote/phone", "POST", "application/json"), listOf(stop.url, stop.method, stop.headers["content-type"]))
        assertEquals(Json.parseToJsonElement("""{"action":"stop"}"""), Json.parseToJsonElement(stop.body!!))
    }

    @Test fun claudeModesErrorsComeThroughInTheServersWords() = runTest {
        signIn()
        val cloud = client()
        serve(
            HttpResponse(404, """{"error":{"code":"not_found","message":"$gone"}}"""),
            HttpResponse(409, """{"error":{"code":"mac_offline","message":"$offline"}}"""),
            HttpResponse(400, """{"error":{"code":"bad_request","message":"Type something first."}}"""),
            HttpResponse(500, "<html>"),
        )
        val notFound = error { cloud.remoteLook("s-1") }
        assertEquals(listOf("not_found", gone), listOf(notFound.code, notFound.message))
        val offline = error { cloud.remoteSend("s-1", "hi") }
        assertEquals(listOf("mac_offline", this@CloudClientTest.offline), listOf(offline.code, offline.message))
        val bad = error { cloud.remoteSend("s-1", " ") }
        assertEquals(listOf("bad_request", "Type something first."), listOf(bad.code, bad.message))
        val other = error { cloud.remoteStop() }
        assertEquals(listOf("server", serverProblem), listOf(other.code, other.message))
    }
}
