package com.akshatgg.buddy.notify

import android.app.Notification
import android.content.pm.PackageManager
import android.os.Build
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import com.akshatgg.buddy.AppGraph

/**
 * Buddy can read your notifications: on only when the person turns it on in Android's Notification access settings.
 * Each notification posted goes into AppGraph's NotifStore (in memory only), and each one an app takes away leaves it.
 * Nothing is said or shown here: the chat reads the store when the person asks.
 */
class BuddyNotifications : NotificationListenerService() {
    private val store get() = AppGraph.instance.notifs

    override fun onListenerConnected() {
        store.clear()
        // What is in the shade already. Android may refuse while it is still connecting (a SecurityException), or fail
        // to hand the list over; each one in it is read on its own (keep).
        val shown = try {
            activeNotifications
        } catch (e: RuntimeException) {
            Log.w("Buddy", "notifications: could not read the shade")
            null
        }
        shown?.forEach(::keep)
    }

    // Notification access turned off (or Android let go of the listener): nothing heard before is kept.
    override fun onListenerDisconnected() = store.clear()

    override fun onNotificationPosted(sbn: StatusBarNotification) = keep(sbn)

    override fun onNotificationRemoved(sbn: StatusBarNotification) = store.remove(sbn.key)

    /**
     * Keeps one notification. Reading one can throw (a bad parcel in its extras, its app gone): that one is skipped, and
     * only a fixed line is logged, never what it says.
     */
    private fun keep(sbn: StatusBarNotification) {
        if (!store.posted(sbn.key) { notifOf(sbn) }) Log.w("Buddy", "notifications: skipped one that could not be read")
    }

    private fun notifOf(sbn: StatusBarNotification): Notif? {
        val n = sbn.notification ?: return null
        val extras = n.extras ?: return null
        return notifFrom(
            key = sbn.key, pkg = sbn.packageName, own = packageName,
            // A foreground service's own (a music player, a download) can be swiped away on Android 14, so is no
            // longer "ongoing": it is skipped all the same.
            ongoing = sbn.isOngoing || n.flags and Notification.FLAG_FOREGROUND_SERVICE != 0,
            summary = n.flags and Notification.FLAG_GROUP_SUMMARY != 0, category = n.category,
            app = labelOf(sbn.packageName),
            title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
            text = (extras.getCharSequence(Notification.EXTRA_TEXT) ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT))?.toString(),
            at = sbn.postTime,
        )
    }

    /** The app's name. Android 11 and later show it for the apps the manifest's <queries> can see (the home screen's). */
    private fun labelOf(pkg: String): String = try {
        val info = if (Build.VERSION.SDK_INT >= 33) {
            packageManager.getApplicationInfo(pkg, PackageManager.ApplicationInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION") packageManager.getApplicationInfo(pkg, 0)
        }
        packageManager.getApplicationLabel(info).toString()
    } catch (e: PackageManager.NameNotFoundException) {
        pkg
    }
}
