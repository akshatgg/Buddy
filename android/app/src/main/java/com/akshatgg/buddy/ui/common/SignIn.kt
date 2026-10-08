package com.akshatgg.buddy.ui.common

import android.util.Log
import com.akshatgg.buddy.account.Account
import com.akshatgg.buddy.cloud.CloudClient
import com.akshatgg.buddy.core.BuddyError

/**
 * Sign in with the Google account the person picks, then fetch their free-mode settings, as the Mac's
 * account:sign-in. A fetch that fails is only logged (by kind): the screens show the last known settings. But the
 * server can turn a new sign-in down, which signs the person out again, and that is not a sign-in that worked.
 */
suspend fun signInWithGoogle(account: Account, cloud: CloudClient, pick: suspend () -> String) {
    account.signIn(pick)
    val failure = try {
        cloud.settings(force = true)
        null
    } catch (e: BuddyError) {
        Log.w("Buddy", "could not fetch the free settings: ${e.code}")
        e
    }
    if (!account.isSignedIn()) throw BuddyError("signed_out", failure?.message ?: "Sign-in didn't finish. Try again.")
}
