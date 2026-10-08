package com.akshatgg.buddy.bubble

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Settings
import com.akshatgg.buddy.AppGraph

/**
 * "Always on", as the Mac's login item: once the buddy is turned on it comes back after the phone restarts and after
 * Buddy is updated, until the person turns it off inside Buddy. Without the "Display over other apps" permission
 * there is nowhere for it to float, so it waits for the app to ask for that again.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (AppGraph.instance.settings.buddyOn && Settings.canDrawOverlays(context)) BubbleService.start(context)
    }
}
