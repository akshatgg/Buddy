package com.akshatgg.buddy.account

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.akshatgg.buddy.core.BuddyError
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/** Asks the person which Google account to use, and answers Google's ID token for it. */
interface GoogleIdTokens {
    suspend fun pick(activity: Activity): String
}

/** Android's own Google account picker. `webClientId` is the Google web client Firebase knows. */
class CredentialManagerGoogle(private val webClientId: String) : GoogleIdTokens {
    override suspend fun pick(activity: Activity): String {
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetSignInWithGoogleOption.Builder(webClientId).build())
            .build()
        val credential = try {
            CredentialManager.create(activity).getCredential(activity, request).credential
        } catch (e: GetCredentialCancellationException) {
            throw BuddyError("sign_in_denied", "You didn't finish signing in with Google. Try again.")
        } catch (e: NoCredentialException) {
            throw BuddyError("sign_in_failed", "Add a Google account to this phone, then try again.")
        } catch (e: GetCredentialException) {
            throw BuddyError("sign_in_failed", "Google didn't sign you in. Try again.")
        }
        if (credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            throw BuddyError("sign_in_failed", "Google didn't sign you in. Try again.")
        }
        return try {
            GoogleIdTokenCredential.createFrom(credential.data).idToken
        } catch (e: Exception) {
            throw BuddyError("sign_in_failed", "Google didn't sign you in. Try again.")
        }
    }
}
