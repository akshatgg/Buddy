package com.akshatgg.buddy

import android.app.Application

/** Buddy's process: it makes the objects that every screen and the floating buddy share. */
class BuddyApp : Application() {
    override fun onCreate() {
        super.onCreate()
        AppGraph.instance = AppGraph(this)
    }
}
