package com.akshatgg.buddy.voice

import com.akshatgg.buddy.core.BuddyError
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.security.MessageDigest

class SpeakerModelFileTest {
    @get:Rule val tmp = TemporaryFolder()

    private val good = ByteArray(1000) { (it % 251).toByte() }
    private fun sha(b: ByteArray) = MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }
    private fun spec(b: ByteArray = good) = SpeakerModelSpec("m", "m.onnx", "https://x/m.onnx", sha(b), b.size.toLong(), 192)
    private fun root() = File(tmp.root, "voice-model")
    private fun model(scope: TestScope, spec: SpeakerModelSpec = spec(), dl: suspend (String, File, (Long) -> Unit) -> Unit) =
        SpeakerModelFile(root(), spec, dl, scope.backgroundScope)

    @Test fun aBodyWithTheRightHashAndSizeIsReady() = runTest {
        val m = model(this) { _, f, _ -> f.writeBytes(good) }
        assertFalse(m.ready())
        assertEquals(ModelState.Missing, m.state.value)
        m.fetch()
        assertTrue(m.ready())
        assertEquals(ModelState.Ready, m.state.value)
        assertTrue(m.file().isFile)
        assertEquals(listOf("m.onnx", "m.onnx.ok"), root().list()!!.sorted())
    }

    @Test fun stateGoesThroughGetting() = runTest {
        val seen = mutableListOf<ModelState>()
        lateinit var m: SpeakerModelFile
        m = model(this) { _, f, _ -> seen += m.state.value; f.writeBytes(good) }
        m.fetch()
        assertEquals(listOf<ModelState>(ModelState.Getting(0)), seen)
        assertEquals(ModelState.Ready, m.state.value)
    }

    @Test fun aWrongHashLeavesNothingAndFails() = runTest {
        val m = model(this) { _, f, _ -> f.writeBytes(ByteArray(good.size) { 7 }) }
        try { m.fetch(); fail() } catch (e: BuddyError) { assertEquals("model_failed", e.code) }
        assertFalse(m.ready())
        assertEquals(emptyList<String>(), root().list()!!.toList())
        assertEquals(ModelState.Failed, m.state.value)
    }

    @Test fun aWrongSizeLeavesNothing() = runTest {
        val m = model(this) { _, f, _ -> f.writeBytes(good.copyOf(good.size - 1)) }
        try { m.fetch(); fail() } catch (e: BuddyError) { assertEquals("model_failed", e.code) }
        assertEquals(emptyList<String>(), root().list()!!.toList())
    }

    @Test fun aDownloadThatThrowsLeavesNothing() = runTest {
        val m = model(this) { _, f, _ -> f.writeBytes(good.copyOf(10)); throw java.io.IOException("offline") }
        try { m.fetch(); fail() } catch (e: BuddyError) { assertEquals("model_failed", e.code) }
        assertFalse(m.ready())
        assertEquals(emptyList<String>(), root().list()!!.toList())
        assertEquals(ModelState.Failed, m.state.value)
    }

    @Test fun progressIsAPercentOfTheBytes() = runTest {
        val seen = mutableListOf<ModelState>()
        lateinit var m: SpeakerModelFile
        m = model(this) { _, f, progress -> progress(good.size / 2L); seen += m.state.value; f.writeBytes(good) }
        m.fetch()
        assertEquals(listOf<ModelState>(ModelState.Getting(50)), seen)
    }

    @Test fun generationGrowsWithEachNewFile() = runTest {
        val m = model(this) { _, f, _ -> f.writeBytes(good) }
        assertEquals(0, m.generation)
        m.fetch()
        assertEquals(1, m.generation)
        m.fetch() // already there: nothing new
        assertEquals(1, m.generation)
        m.file().delete()
        m.fetch()
        assertEquals(2, m.generation)
    }

    @Test fun aFileWithoutItsOkFileIsNotReady() = runTest {
        root().mkdirs(); File(root(), "m.onnx").writeBytes(good)
        assertFalse(model(this) { _, _, _ -> }.ready())
    }
}
