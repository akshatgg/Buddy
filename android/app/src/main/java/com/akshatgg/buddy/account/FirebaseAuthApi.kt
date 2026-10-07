package com.akshatgg.buddy.account

import android.util.Log
import com.akshatgg.buddy.core.BuddyError
import com.akshatgg.buddy.net.Http
import com.akshatgg.buddy.net.HttpRequest
import com.akshatgg.buddy.net.HttpResponse
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put
import java.io.IOException
import java.net.SocketTimeoutException
import java.net.URI
import java.net.URLEncoder

data class User(val uid: String, val email: String, val name: String, val photo: String)
data class FirebaseSession(val user: User, val idToken: String, val refreshToken: String, val expiresInSec: Long)
data class FreshToken(val idToken: String, val refreshToken: String, val expiresInSec: Long)

private const val IDP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp"
private const val REFRESH_URL = "https://securetoken.googleapis.com/v1/token"
private const val CALL_TIMEOUT_MS = 30_000
private val SIGNED_OUT_REASONS = Regex("TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND|INVALID_GRANT_TYPE|MISSING_REFRESH_TOKEN|PROJECT_NUMBER_MISMATCH")
// The reason a refusal gives is logged only when it is one short word ("invalid_grant", "TOKEN_EXPIRED"):
// anything longer could carry a token.
private val REASON_SHAPE = Regex("^[A-Za-z][A-Za-z0-9_.-]{0,63}$")

internal fun signedOut() = BuddyError("signed_out", "Sign in to use Buddy.")
private fun failed() = BuddyError("sign_in_failed", "Google didn't sign you in. Try again.")
private fun authFailed() = BuddyError("auth_failed", "Couldn't check your sign-in. Try again.")

private fun JsonObject.string(name: String): String? = (this[name] as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull

// Same as JavaScript's encodeURIComponent for what matters here: a space is %20, not +.
private fun encode(text: String) = URLEncoder.encode(text, "UTF-8").replace("+", "%20")

/** Firebase's own sign-in and token-renewal calls, as the Mac makes them in google-signin.js. */
class FirebaseAuthApi(private val http: Http, private val apiKey: String) {

    /**
     * The reason Google (`error`) or Firebase (`error.message`, often followed by words of its own) gives for a refusal,
     * cut at the first space or colon; null unless what is left is one word that is safe to log.
     */
    private fun loggableReason(body: JsonObject?): String? {
        val said = ((body?.get("error") as? JsonObject)?.string("message")) ?: body?.string("error") ?: return null
        val word = said.split(Regex("[\\s:]"))[0]
        return if (REASON_SHAPE.matches(word)) word else null
    }

    /** POST to Google or Firebase; answers the JSON. No connection is `network`; any other failure is `onFail(reason)`. */
    private suspend fun post(url: String, form: String? = null, json: JsonObject? = null, onFail: (String) -> BuddyError): JsonObject {
        val res: HttpResponse = try {
            http.send(
                HttpRequest(
                    url = url,
                    method = "POST",
                    headers = mapOf("content-type" to if (form != null) "application/x-www-form-urlencoded" else "application/json"),
                    body = form ?: json.toString(),
                    timeoutMs = CALL_TIMEOUT_MS,
                ),
            )
        } catch (e: SocketTimeoutException) {
            currentCoroutineContext().ensureActive()
            throw BuddyError("timeout", "Google took too long to answer. Try again.")
        } catch (e: IOException) {
            // Let go of, the read is interrupted and fails like no internet: a cancellation all the same.
            currentCoroutineContext().ensureActive()
            throw BuddyError("network", "Couldn't reach Google. Check your internet.")
        }
        val body = try { Json.parseToJsonElement(res.body) as? JsonObject } catch (e: Exception) { null } // not JSON: judged by the status below
        if (res.status !in 200..299) {
            // The log gets where, the status and the reason as one word, never a token.
            val reason = loggableReason(body)
            Log.w("Buddy", "sign-in: ${URI(url).host} answered ${res.status}${if (reason != null) " ($reason)" else ""}")
            val said = (body?.get("error") as? JsonObject)?.string("message") ?: body?.string("error") ?: ""
            throw onFail(said)
        }
        return body ?: JsonObject(emptyMap())
    }

    suspend fun signInWithGoogle(googleIdToken: String): FirebaseSession {
        val body = post(
            url = "$IDP_URL?key=${encode(apiKey)}",
            onFail = { failed() },
            json = buildJsonObject {
                put("postBody", "id_token=${encode(googleIdToken)}&providerId=google.com")
                put("requestUri", "http://localhost")
                put("returnSecureToken", true)
                put("returnIdpCredential", true)
            },
        )
        val idToken = body.string("idToken")?.ifEmpty { null }
        val refreshToken = body.string("refreshToken")?.ifEmpty { null }
        val uid = body.string("localId")?.ifEmpty { null }
        if (idToken == null || refreshToken == null || uid == null) throw failed()
        val photo = body.string("photoUrl")?.takeIf { it.startsWith("https://") } ?: ""
        val name = body.string("displayName")?.ifEmpty { null } ?: body.string("fullName") ?: ""
        return FirebaseSession(
            user = User(uid, body.string("email") ?: "", name, photo),
            idToken = idToken,
            refreshToken = refreshToken,
            expiresInSec = body.string("expiresIn")?.toLongOrNull()?.takeIf { it != 0L } ?: 3600,
        )
    }

    /** A new ID token for a refresh token. One Firebase no longer takes means the person is signed out. */
    suspend fun refresh(refreshToken: String): FreshToken {
        val body = post(
            url = "$REFRESH_URL?key=${encode(apiKey)}",
            form = "grant_type=refresh_token&refresh_token=${encode(refreshToken)}",
            onFail = { reason -> if (SIGNED_OUT_REASONS.containsMatchIn(reason)) signedOut() else authFailed() },
        )
        val idToken = body.string("id_token")?.ifEmpty { null }
        val fresh = body.string("refresh_token")?.ifEmpty { null }
        if (idToken == null || fresh == null) throw authFailed()
        return FreshToken(idToken, fresh, body.string("expires_in")?.toLongOrNull()?.takeIf { it != 0L } ?: 3600)
    }
}
