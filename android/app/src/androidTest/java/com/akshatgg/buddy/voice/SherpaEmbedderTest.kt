package com.akshatgg.buddy.voice

import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** The real voice-check engine on a device: the same voice scores higher than another one (tools/android-voice-check.sh). */
@RunWith(AndroidJUnit4::class)
class SherpaEmbedderTest {
    // tools/android-voice-check.sh pushes these into the app's files dir (run-as) before the test.
    private val dir = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "voice-check-test")

    @Test fun sameVoiceScoresHigherThanAnother() {
        val model = File(dir, "campplus-zh-en-advanced.onnx")
        assumeTrue("run tools/android-voice-check.sh", model.isFile)
        SherpaEmbedder(model).use { e ->
            fun wav(name: String) = File(dir, name).readBytes().let { b ->
                ShortArray((b.size - 44) / 2) { i -> ((b[44 + 2 * i + 1].toInt() shl 8) or (b[44 + 2 * i].toInt() and 0xff)).toShort() }
            }
            val takes = (1..5).map { e.embed(wav("a-e$it.wav"))!! }
            val setup = Setup()
            var last: SetupStep? = null
            takes.forEach { last = setup.add(it) }
            assertEquals("done", last!!.step)
            val t0 = System.nanoTime()
            val mine = e.embed(wav("a-t1.wav"))
            val ms = (System.nanoTime() - t0) / 1e6
            val other = e.embed(wav("b-t1.wav"))
            Log.i("BuddyVoiceCheck", "embed ms=$ms mine=${MyVoiceRules.cosine(last!!.profile, mine)} other=${MyVoiceRules.cosine(last!!.profile, other)}")
            assertTrue(MyVoiceRules.isMe(last!!.profile, mine))
            assertFalse(MyVoiceRules.isMe(last!!.profile, other))
            assertEquals(192, mine!!.size)
        }
    }
}
