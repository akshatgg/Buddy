package com.akshatgg.buddy.update

import com.akshatgg.buddy.FakeHttp
import com.akshatgg.buddy.net.HttpResponse
import com.akshatgg.buddy.store.MemoryKeyValue
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest

@OptIn(ExperimentalCoroutinesApi::class)
class UpdaterTest {
    private val apk = "the new Buddy".toByteArray()
    private val sha = MessageDigest.getInstance("SHA-256").digest(apk).joinToString("") { "%02x".format(it) }
    private val url = "https://github.com/akshatgg/Buddy/releases/download/android-v1.2.4/Buddy-Android.apk"

    private fun release(tag: String, name: String = APK_NAME, draft: Boolean = false, pre: Boolean = false, link: String = url, digest: String? = "sha256:$sha") =
        """{"tag_name":"$tag","draft":$draft,"prerelease":$pre,"assets":[{"name":"$name","size":${apk.size},"browser_download_url":"$link"${digest?.let { ",\"digest\":\"$it\"" } ?: ""}}]}"""

    @Test fun theNewestPublishedAndroidReleaseIsFoundInTheList() {
        val json = "[" + listOf(
            release("v1.2.9"), // the Mac and Windows: not Android
            release("android-v1.2.3"),
            release("android-v1.2.4"),
            release("android-v1.3.0", draft = true),
            release("android-v1.4.0", pre = true),
            release("android-v1.5.0", name = "other.apk"),
            release("android-v1.6.0", link = "https://evil.example/Buddy-Android.apk"),
        ).joinToString(",") + "]"
        val found = AppUpdate.newestAndroid(json)!!
        assertEquals("1.2.4", found.version)
        assertEquals(url, found.apkUrl)
        assertEquals(apk.size.toLong(), found.size)
        assertEquals(sha, found.sha256)
        assertNull(AppUpdate.newestAndroid("[]"))
        assertNull(AppUpdate.newestAndroid("not json"))
        assertNull(AppUpdate.newestAndroid("[" + release("android-v1.2.4", digest = "md5:x") + "]")?.sha256)
    }

    @Test fun newerIsByVersionNumber() {
        assertTrue(AppUpdate.isNewer("1.2.4", "1.2.3"))
        assertTrue(AppUpdate.isNewer("1.10.0", "1.9.9"))
        assertFalse(AppUpdate.isNewer("1.2.3", "1.2.3"))
        assertFalse(AppUpdate.isNewer("1.2.2", "1.2.3-debug"))
        assertFalse(AppUpdate.isNewer("nonsense", "1.2.3"))
    }

    private class Setup(scope: TestScope, list: String, val canInstall: Boolean = true, val body: ByteArray, var status: Int = 200) {
        val dir: File = Files.createTempDirectory("updates").toFile()
        val installed = mutableListOf<String>()
        var allowed = canInstall
        val http = FakeHttp { HttpResponse(status, list) }
        val updater = Updater(
            http, "1.2.3", dir, MemoryKeyValue(), scope.backgroundScope,
            download = { _, file, progress -> file.writeBytes(body); progress(body.size.toLong()) },
            canInstall = { allowed },
            install = { file -> installed += file.readText() },
            now = { 1_000_000L },
        )
    }

    @Test fun aNewerVersionIsOfferedAndUpdateNowDownloadsChecksAndInstallsIt() = runTest {
        val s = Setup(this, "[" + release("android-v1.2.4") + "]", body = apk)
        s.updater.check()
        runCurrent()
        assertTrue(s.updater.state.value is UpdateState.Available)
        assertEquals("Buddy-Android", s.http.requests.single().headers["User-Agent"])
        s.updater.updateNow()
        runCurrent()
        assertEquals(listOf("the new Buddy"), s.installed)
        assertTrue(s.updater.state.value is UpdateState.Installing)
        s.updater.installEnded(InstallEnd.DECLINED)
        assertTrue("the person said no: offered again", s.updater.state.value is UpdateState.Available)
        s.updater.updateNow()
        runCurrent()
        s.updater.installEnded(InstallEnd.CONFLICT)
        val conflict = s.updater.state.value as UpdateState.Failed
        assertEquals(UPDATE_CONFLICT, conflict.message)
        assertNull("nothing to try again: another key's Buddy is not replaced", conflict.release)
    }

    @Test fun upToDate_andAFailedLookIsQuietUnlessAsked_andLooksAreNotRepeatedTooOften() = runTest {
        val s = Setup(this, "[" + release("android-v1.2.3") + "]", body = apk)
        s.updater.check()
        runCurrent()
        assertEquals(UpdateState.UpToDate, s.updater.state.value)
        s.updater.check()
        runCurrent()
        assertEquals("a look on its own is not repeated within hours", 1, s.http.requests.size)
        s.status = 500
        s.updater.check(asked = true)
        runCurrent()
        assertEquals(UPDATE_OFFLINE, (s.updater.state.value as UpdateState.Failed).message)
    }

    @Test fun firstAllowInstalling_thenItGoesOn_andADamagedDownloadIsNotInstalled() = runTest {
        val s = Setup(this, "[" + release("android-v1.2.4") + "]", canInstall = false, body = apk)
        s.updater.check()
        runCurrent()
        s.updater.updateNow()
        runCurrent()
        assertTrue(s.updater.state.value is UpdateState.NeedsPermission)
        assertTrue(s.installed.isEmpty())
        s.updater.resumed()
        runCurrent()
        assertTrue("still not allowed: still asking", s.updater.state.value is UpdateState.NeedsPermission)
        s.allowed = true
        s.updater.resumed()
        runCurrent()
        assertEquals(1, s.installed.size)

        val bad = Setup(this, "[" + release("android-v1.2.4") + "]", body = "tampered!!!!!".toByteArray())
        bad.updater.check()
        runCurrent()
        bad.updater.updateNow()
        runCurrent()
        assertEquals(UPDATE_DAMAGED, (bad.updater.state.value as UpdateState.Failed).message)
        assertTrue(bad.installed.isEmpty())
        assertFalse(File(bad.dir, APK_NAME).exists())
    }
}
