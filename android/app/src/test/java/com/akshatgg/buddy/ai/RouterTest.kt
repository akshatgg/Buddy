package com.akshatgg.buddy.ai

import com.akshatgg.buddy.FakeHttp
import com.akshatgg.buddy.TestShared
import com.akshatgg.buddy.account.Account
import com.akshatgg.buddy.account.FirebaseAuthApi
import com.akshatgg.buddy.ai.providers.Providers
import com.akshatgg.buddy.cloud.CloudClient
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.net.HttpRequest
import com.akshatgg.buddy.net.HttpResponse
import com.akshatgg.buddy.store.AppSettings
import com.akshatgg.buddy.store.MemoryKeyValue
import com.akshatgg.buddy.store.MemorySecrets
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class RouterTest {
    private val signedIn = """{"idToken":"id","refreshToken":"r","expiresIn":"3600","localId":"u","email":"a@b.c","displayName":"A"}"""
    private var config = """{"freeOn":true,"limitMode":"unlimited","limit":null,"usedToday":0,"allowOwnKey":false,"blocked":false,"isAdmin":false}"""
    private var askAnswer: HttpResponse = HttpResponse(200, """{"text":"free answer","model":"server-model"}""")
    private var serverDown = false
    private val calls = mutableListOf<String>()
    private val http = FakeHttp { r: HttpRequest ->
        when {
            r.url.contains("identitytoolkit") -> HttpResponse(200, signedIn)
            r.url.startsWith("https://srv") && serverDown -> throw IOException("down")
            r.url == "https://srv/api/config" -> { calls += "config"; HttpResponse(200, config) }
            r.url == "https://srv/api/ask" -> { calls += "ask"; askAnswer }
            r.url.startsWith("https://api.anthropic.com") -> { calls += "own"; HttpResponse(200, """{"content":[{"type":"text","text":"own answer"}]}""") }
            else -> error("unexpected ${r.url}")
        }
    }
    private val kv = MemoryKeyValue()
    private val secrets = MemorySecrets()
    private val settings = AppSettings(kv)
    private val account = Account(kv, secrets, FirebaseAuthApi(http, "KEY"))
    private val cloud = CloudClient(http, "https://srv", account, settings)
    private val router = Router(account, cloud, settings, secrets, Providers(TestShared.shared, http), Prompts(TestShared.shared))
    private val write = AskInput(instruction = "mail likho")
    private suspend fun error(block: suspend () -> Unit): BuddyError = try { block(); throw AssertionError("no error") } catch (e: BuddyError) { e }
    private suspend fun signIn() = account.signIn { "g" }

    @Test fun nobodyUsesBuddyWithoutSigningIn() = runTest {
        assertEquals("Sign in to use Buddy.", error { router.ask(Action.WRITE, write) }.message)
    }

    @Test fun freeModeOnAnswersFromTheServer() = runTest {
        signIn()
        assertEquals("free answer", router.ask(Action.WRITE, write).text)
        assertEquals(listOf("config", "ask"), calls)
    }

    @Test fun freeModeOffUsesTheOwnKeyOrAsksForOne() = runTest {
        signIn()
        config = config.replace("\"freeOn\":true", "\"freeOn\":false")
        assertEquals("Add your API key in Settings first.", error { router.ask(Action.WRITE, write) }.message)
        secrets.set("anthropic", "sk-ant-k")
        assertEquals("own answer", router.ask(Action.WRITE, write).text)
    }

    @Test fun aUsedUpDayGoesStraightToTheOwnKeyWhenAllowed() = runTest {
        signIn()
        config = """{"freeOn":true,"limitMode":"daily","limit":2,"usedToday":2,"allowOwnKey":true,"blocked":false,"isAdmin":false}"""
        secrets.set("anthropic", "sk-ant-k")
        assertEquals("own answer", router.ask(Action.WRITE, write).text)
        assertEquals(listOf("config", "own"), calls)
    }

    @Test fun theDailyLimitSaysWhatToDo() = runTest {
        signIn()
        config = """{"freeOn":true,"limitMode":"daily","limit":2,"usedToday":1,"allowOwnKey":true,"blocked":false,"isAdmin":false}"""
        askAnswer = HttpResponse(429, """{"error":{"code":"free_limit","message":"You've used today's 2 free requests. They come back at midnight."}}""")
        val e = error { router.ask(Action.WRITE, write) }
        assertEquals("need_key", e.code)
        assertEquals("You've used today's 2 free requests. Add your own key in Settings to keep going, or wait until midnight.", e.message)
        secrets.set("anthropic", "sk-ant-k")
        assertEquals("own answer", router.ask(Action.WRITE, write).text)
    }

    @Test fun blockedPeopleArePausedUnlessTheirOwnKeyIsAllowed() = runTest {
        signIn()
        config = """{"freeOn":true,"limitMode":"daily","limit":5,"usedToday":0,"allowOwnKey":false,"blocked":true,"isAdmin":false}"""
        assertEquals("Your free access is paused.", error { router.ask(Action.WRITE, write) }.message)
    }

    @Test fun aServerNeverReachedFallsBackToTheOwnKey() = runTest {
        signIn()
        serverDown = true
        assertEquals("Couldn't reach Buddy's server. Check your internet.", error { router.ask(Action.WRITE, write) }.message)
        secrets.set("anthropic", "sk-ant-k")
        assertEquals("own answer", router.ask(Action.WRITE, write).text)
    }

    @Test fun aModelThatCannotSeeIsSaidBeforeAsking() = runTest {
        signIn()
        config = config.replace("\"freeOn\":true", "\"freeOn\":false")
        settings.provider = "groq"; secrets.set("groq", "gsk_k"); settings.setModel("groq", "llama-3.3-70b-versatile")
        assertEquals("no_vision", error { router.ask(Action.CHECK, AskInput(image = "IMG")) }.code)
    }

    // ---- the rows of the routing table the tests above leave out ----

    @Test fun blockedPeopleWhoseOwnKeyIsAllowedUseIt() = runTest {
        signIn()
        config = """{"freeOn":true,"limitMode":"daily","limit":5,"usedToday":0,"allowOwnKey":true,"blocked":true,"isAdmin":false}"""
        secrets.set("anthropic", "sk-ant-k")
        assertEquals("own answer", router.ask(Action.WRITE, write).text)
        assertEquals(listOf("config", "own"), calls)
    }

    @Test fun theDailyLimitWithoutOwnKeysIsTheServersOwnWordsAndASavedKeyStaysUnused() = runTest {
        signIn()
        config = """{"freeOn":true,"limitMode":"daily","limit":2,"usedToday":1,"allowOwnKey":false,"blocked":false,"isAdmin":false}"""
        askAnswer = HttpResponse(429, """{"error":{"code":"free_limit","message":"You've used today's 2 free requests. They come back at midnight."}}""")
        secrets.set("anthropic", "sk-ant-k")
        val e = error { router.ask(Action.WRITE, write) }
        assertEquals("free_limit", e.code)
        assertEquals("You've used today's 2 free requests. They come back at midnight.", e.message)
        assertEquals(listOf("config", "ask", "config"), calls) // the settings are fetched again after the refusal
    }

    @Test fun freeModeTurnedOffMeanwhileFetchesTheSettingsAgainAndRoutesAgain() = runTest {
        signIn()
        cloud.settings() // free mode on, as last known
        config = config.replace("\"freeOn\":true", "\"freeOn\":false")
        askAnswer = HttpResponse(403, """{"error":{"code":"free_off","message":"Free AI is off. Add your own key in Settings."}}""")
        secrets.set("anthropic", "sk-ant-k")
        assertEquals("own answer", router.ask(Action.WRITE, write).text)
        assertEquals(listOf("config", "ask", "config", "own"), calls)
    }

    @Test fun otherFailuresOfTheFreeRouteArePassedOnWithNoSecondFetch() = runTest {
        signIn()
        askAnswer = HttpResponse(502, """{"error":{"code":"upstream","message":"Buddy couldn't answer. Try again."}}""")
        secrets.set("anthropic", "sk-ant-k")
        assertEquals("Buddy couldn't answer. Try again.", error { router.ask(Action.WRITE, write) }.message)
        assertEquals(listOf("config", "ask"), calls)
    }

    @Test fun inputThatIsNotValidIsRefusedBeforeTheServerIsAsked() = runTest {
        signIn()
        assertEquals("bad_request", error { router.ask(Action.WRITE, AskInput(instruction = " ")) }.code)
        assertEquals(listOf("config"), calls)
    }

    @Test fun aCheckIsReadOnTheOwnRouteToo() = runTest {
        signIn()
        config = config.replace("\"freeOn\":true", "\"freeOn\":false")
        secrets.set("anthropic", "sk-ant-k")
        val out = router.ask(Action.CHECK, AskInput(image = "IMG"))
        assertEquals(CheckResult.Raw("own answer"), out.check)
        val body = http.requests.last { it.url.startsWith("https://api.anthropic.com") }.body!!
        assertTrue(body.contains("\"model\":\"claude-haiku-4-5-20251001\"") && body.contains("\"max_tokens\":1024"))
    }

    @Test fun theModelIsThePersonsPickElseTheFirstFallbackAndTheListIsTheFallbackWithoutAKey() = runTest {
        assertEquals("gemini-flash-latest", router.modelFor("gemini"))
        settings.setModel("gemini", "gemini-pro-latest")
        assertEquals("gemini-pro-latest", router.modelFor("gemini"))
        assertEquals(listOf("gpt-4.1-mini", "gpt-4.1"), router.listModels("openai"))
        assertEquals(emptyList<String>(), http.requests)
    }
}
