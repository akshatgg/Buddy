package com.akshatgg.buddy.voice

import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@OptIn(ExperimentalCoroutinesApi::class)
class VoiceModelTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun zip(vararg entries: Pair<String, String>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { z -> for ((n, c) in entries) { z.putNextEntry(ZipEntry(n)); z.write(c.toByteArray()); z.closeEntry() } }
        return out.toByteArray()
    }
    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
    private val good = zip("m/am/final.mdl" to "mdl", "m/graph/Gr.fst" to "fst")
    private fun spec(b: ByteArray = good) = ModelSpec("m", "https://x/m.zip", sha(b), b.size.toLong())
    private fun model(spec: ModelSpec, scope: TestScope, dl: suspend (String, File, (Long) -> Unit) -> Unit) =
        VoiceModel(File(tmp.root, "voice-model"), spec, dl, scope.backgroundScope)

    @Test fun fetchUnpacksTheModelAndChecksIt() = runTest {
        val m = model(spec(), this) { _, f, _ -> f.writeBytes(good) }
        assertFalse(m.ready())
        m.fetch()
        assertTrue(m.ready())
        assertTrue(File(m.folder(), "am/final.mdl").isFile)
        assertEquals(ModelState.Ready, m.state.value)
        assertEquals(listOf("m"), File(tmp.root, "voice-model").list()!!.toList())
    }

    @Test fun aDownloadWithAnotherSha256IsThrownAwayAndNothingIsReady() = runTest {
        val m = model(spec(), this) { _, f, _ -> f.writeBytes("other".toByteArray()) }
        try { m.fetch(); fail() } catch (e: BuddyError) { assertEquals("model_failed", e.code) }
        assertFalse(m.ready())
        assertEquals(emptyList<String>(), File(tmp.root, "voice-model").list()!!.toList())
        assertEquals(ModelState.Failed, m.state.value)
    }

    @Test fun aZipWhoseEntryLeavesTheFolderIsRefused() = runTest {
        val evil = zip("m/am/final.mdl" to "x", "../evil" to "x")
        val m = model(spec(evil), this) { _, f, _ -> f.writeBytes(evil) }
        try { m.fetch(); fail() } catch (e: BuddyError) { assertEquals("model_failed", e.code) }
        assertFalse(m.ready())
        assertFalse(File(tmp.root, "evil").exists())
        assertFalse(File(tmp.root, "voice-model/evil").exists())
    }

    @Test fun aModelWithoutItsAcousticFileIsRefused() = runTest {
        val bad = zip("m/graph/Gr.fst" to "x")
        val m = model(spec(bad), this) { _, f, _ -> f.writeBytes(bad) }
        try { m.fetch(); fail() } catch (e: BuddyError) { assertEquals("model_failed", e.code) }
        assertFalse(m.ready())
    }

    @Test fun fetchInBackgroundRunsOnceAtATime() = runTest(UnconfinedTestDispatcher()) {
        val gate = CompletableDeferred<Unit>()
        var calls = 0
        val m = VoiceModel(File(tmp.root, "voice-model"), spec(), { _, f, _ -> calls++; gate.await(); f.writeBytes(good) }, backgroundScope)
        m.fetchInBackground(); m.fetchInBackground()
        gate.complete(Unit)
        assertEquals(1, calls)
        assertTrue(m.ready())
    }

    @Test fun progressIsAPercentOfTheBytes() = runTest {
        val seen = mutableListOf<ModelState>()
        lateinit var m: VoiceModel
        m = model(spec(), this) { _, f, progress -> progress(good.size / 2L); seen += m.state.value; f.writeBytes(good) }
        m.fetch()
        assertEquals(listOf<ModelState>(ModelState.Getting(50)), seen)
    }
}
