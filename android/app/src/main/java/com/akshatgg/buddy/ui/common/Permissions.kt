package com.akshatgg.buddy.ui.common

import android.Manifest
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.activity.result.ActivityResultLauncher
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.net.toUri
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.akshatgg.buddy.store.AppSettings

/** What Buddy is allowed: to float over other apps, and to show its notification (with "Turn off"). */
data class Allowed(val float: Boolean, val notifications: Boolean)

fun Context.allowed() = Allowed(
    float = Settings.canDrawOverlays(this),
    notifications = NotificationManagerCompat.from(this).areNotificationsEnabled(),
)

/** What Buddy is allowed, read again every time the screen comes back (from the phone's settings, or Android's question). */
@Composable
fun rememberAllowed(): State<Allowed> {
    val context = LocalContext.current
    val allowed = remember { mutableStateOf(context.allowed()) }
    LifecycleResumeEffect(Unit) {
        allowed.value = context.allowed()
        onPauseOrDispose {}
    }
    return allowed
}

private fun Context.open(intent: Intent) {
    try {
        startActivity(intent)
    } catch (e: ActivityNotFoundException) {
        Log.w("Buddy", "settings: no screen for ${intent.action}") // a phone without this screen: nothing to open
    }
}

/** Android's "Display over other apps" screen, for Buddy. */
fun Context.openFloatSettings() = open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, "package:$packageName".toUri()))

/**
 * Android's Accessibility settings, where Buddy can type for you is turned on or off: Android lets no app turn its own
 * service on or off, nor open its page there directly.
 */
fun Context.openAccessibilitySettings() = open(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))

/**
 * Buddy's App info page in the phone's settings: its ⋮ menu has "Allow restricted settings", which Android asks for
 * before Buddy can type for you can be turned on in an app that did not come from an app store.
 */
fun Context.openAppInfo() = open(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:$packageName".toUri()))

/** The app that installed Buddy (the Play Store, a browser, a file manager…), or null when Android does not say. */
fun Context.installer(): String? = try {
    if (Build.VERSION.SDK_INT >= 30) {
        packageManager.getInstallSourceInfo(packageName).installingPackageName
    } else {
        @Suppress("DEPRECATION")
        packageManager.getInstallerPackageName(packageName)
    }
} catch (e: Exception) {
    null
}

private fun Context.openNotificationSettings() =
    open(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName))

/**
 * Ask to allow notifications. On Android 13 and later that is Android's own question (`ask`), while it still asks:
 * after two no's it no longer does, and only the phone's settings for Buddy can allow them. Before 13 they are on
 * unless the person turned them off there.
 */
fun Activity.askForNotifications(settings: AppSettings, ask: ActivityResultLauncher<String>) {
    if (Build.VERSION.SDK_INT >= 33 && (
            !settings.notificationsAsked ||
                ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.POST_NOTIFICATIONS)
            )
    ) {
        settings.notificationsAsked = true
        ask.launch(Manifest.permission.POST_NOTIFICATIONS)
    } else {
        openNotificationSettings()
    }
}
