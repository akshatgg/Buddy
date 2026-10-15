package com.akshatgg.buddy.apps

import android.content.ActivityNotFoundException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class AppOpenerTest {
    private val youTube = LauncherApp("YouTube", "com.google.android.youtube", "Main")
    private val music = LauncherApp("YouTube Music", "com.google.android.apps.youtube.music", "Music")
    private val camera = LauncherApp("Camera", "com.android.camera", "Cam")

    private class FakeLauncher(val list: List<LauncherApp>, val fails: Exception? = null) : Launcher {
        val started = mutableListOf<LauncherApp>()
        override suspend fun apps() = list
        override fun start(app: LauncherApp) { fails?.let { throw it }; started += app }
    }

    @Test fun buddyIsNotOneOfTheAppsNorOneWithNoName() {
        val buddy = LauncherApp("Buddy", "com.akshatgg.buddy", "Main")
        val blank = LauncherApp(" ", "com.x", "X")
        assertEquals(listOf(youTube, camera), launcherApps(listOf(youTube, buddy, blank, camera), own = "com.akshatgg.buddy"))
    }
    @Test fun theOneAppOpens() = runTest {
        val l = FakeLauncher(listOf(youTube, music, camera))
        assertEquals(Opened.Done("YouTube"), AppOpener(l).open("youtube"))
        assertEquals(listOf(youTube), l.started)
    }
    @Test fun twoAppsAskWhichOneAndOpenNothing() = runTest {
        val l = FakeLauncher(listOf(youTube, music))
        assertEquals(Opened.Say("Which one: YouTube or YouTube Music?"), AppOpener(l).open("you"))
        assertEquals(emptyList<LauncherApp>(), l.started)
    }
    @Test fun noSuchApp() = runTest {
        assertEquals(Opened.Say("I couldn't find Netflix on this phone."), AppOpener(FakeLauncher(listOf(camera))).open("Netflix"))
    }
    @Test fun aStartThatFailsSaysSo() = runTest {
        val l = FakeLauncher(listOf(camera), fails = ActivityNotFoundException("gone"))
        assertEquals(Opened.Say("I couldn't open Camera."), AppOpener(l).open("camera"))
    }
}
