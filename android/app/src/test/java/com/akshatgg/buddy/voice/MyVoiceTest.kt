package com.akshatgg.buddy.voice

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class MyVoiceTest {
    @get:Rule val tmp = TemporaryFolder()

    private val ME = FloatArray(192).also { it[0] = 1f }
    private val OTHER = FloatArray(192).also { it[1] = 1f }
    private fun clip(ms: Int) = ShortArray(ms * 16)
    private val spec = SpeakerModelSpec("m", "m.onnx", "https://x/m.onnx", "abc", 10, 192)

    private var on = false
    private fun file() = File(tmp.root, "my-voice.json")
    private fun voice(on: Boolean, embed: (ShortArray) -> FloatArray? = { null }): MyVoice = voiceWith(on) { Embedder(embed) }
    private fun voiceWith(on: Boolean, embedder: () -> Embedder?): MyVoice {
        this.on = on
        return MyVoice(file(), spec, embedder, { this.on }, { this.on = it }, { "2026-10-16T00:00:00Z" })
    }

    @Test fun offAllowsEverythingWithoutChecking() {
        var calls = 0
        val v = voice(on = false, embed = { calls++; OTHER })
        assertTrue(v.allows(null)); assertTrue(v.allows(clip(800)))
        assertEquals(0, calls)
    }

    @Test fun onOnlyTheOwnerPasses() {
        var next: FloatArray? = ME
        val v = voice(on = true, embed = { next })
        v.save(ME)
        assertTrue(v.allows(clip(800)))
        next = OTHER; assertFalse(v.allows(clip(800)))
        next = ME; assertFalse("too short", v.allows(clip(300)))
        assertFalse("too long", v.allows(clip(3100)))
        assertFalse("no clip", v.allows(null))
        next = null; assertFalse(v.allows(clip(800)))
    }

    @Test fun noProfileOrAnotherModelIsANo() {
        val v = voice(on = true, embed = { ME })
        assertFalse(v.allows(clip(800))); assertFalse(v.profileUsable())
        file().writeText(MyVoiceRules.profileJson(ME, "x", "now"))
        assertFalse(v.allows(clip(800))); assertFalse(v.profileUsable())
        file().writeText("not json")
        assertFalse(v.allows(clip(800)))
    }

    @Test fun embedderMissingOrThrowingIsANo() {
        val missing = voiceWith(true) { null }
        missing.save(ME)
        assertFalse(missing.allows(clip(800)))
        val throwing = voice(on = true, embed = { error("engine") })
        throwing.save(ME)
        assertFalse(throwing.allows(clip(800)))
        assertNull(throwing.embed(clip(800)))
        val loadFails = MyVoice(file(), spec, { error("load") }, { true }, {})
        assertFalse(loadFails.allows(clip(800)))
    }

    @Test fun saveWritesTheFileAndTurnsOn() {
        val v = voice(on = false, embed = { ME })
        v.save(ME)
        assertTrue(on)
        assertEquals(MyVoiceRules.profileJson(ME, spec.sha256, "2026-10-16T00:00:00Z"), file().readText())
        assertEquals(listOf("my-voice.json"), tmp.root.list()!!.toList())
        assertTrue(v.profileUsable())
        v.save(OTHER) // saving again replaces it
        assertTrue(MyVoiceRules.isMe(OTHER, MyVoiceRules.readProfile(file().readText(), spec)))
    }

    @Test fun offDeletesTheFile() {
        val v = voice(on = true, embed = { ME })
        v.save(ME)
        v.off()
        assertFalse(file().exists()); assertFalse(on)
        assertFalse(v.profileUsable())
    }

    @Test fun embedForSetupChecksTheLength() {
        val v = voice(on = false, embed = { ME })
        assertNotNull(v.embed(clip(800)))
        assertNull(v.embed(clip(300)))
        assertNull(v.embed(clip(3100)))
    }
}

class RunWithinTest {
    @Test fun anAnswerInTimeIsGiven() = assertEquals(true, runWithin(2_000) { true })

    @Test fun aCheckThatTakesTooLongIsNull() {
        val t0 = System.nanoTime()
        assertNull(runWithin(100) { Thread.sleep(5_000); true })
        assertTrue((System.nanoTime() - t0) / 1_000_000 < 2_000)
    }

    @Test fun aCheckThatThrowsIsNull() = assertNull(runWithin<Boolean>(2_000) { error("engine") })
}
