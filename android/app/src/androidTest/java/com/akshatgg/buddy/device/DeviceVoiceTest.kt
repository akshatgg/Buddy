package com.akshatgg.buddy.device

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.akshatgg.buddy.AppGraph
import com.akshatgg.buddy.voice.ModelState
import com.akshatgg.buddy.voice.TtsSpeaker
import com.akshatgg.buddy.voice.VoiceWords
import com.akshatgg.buddy.voice.VoiceModel
import com.akshatgg.buddy.voice.VoskSpotters
import com.akshatgg.buddy.update.ApkInstaller
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class DeviceVoiceTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun ttsSpeaksAQuestionAndReturns(): Unit = runBlocking {
        val tts = TtsSpeaker(context)
        val t0 = System.currentTimeMillis()
        tts.say("Do you want me to call Prince Sharma?")
        val took = System.currentTimeMillis() - t0
        android.util.Log.i("EmuTest", "tts say took ${took}ms")
        // 20 s is the speaker's own timeout: finishing sooner means the engine really reported done (or failed to start)
        assertTrue("say took $took ms", took < 19_000)
    }

    @Test fun ttsEngineStartsAndHasALanguage() {
        val ready = java.util.concurrent.CountDownLatch(1)
        var status = -99
        var langResult = -99
        lateinit var engine: android.speech.tts.TextToSpeech
        engine = android.speech.tts.TextToSpeech(context) { s -> status = s; if (s == android.speech.tts.TextToSpeech.SUCCESS) langResult = engine.setLanguage(java.util.Locale("en", "IN")); ready.countDown() }
        assertTrue(ready.await(15, java.util.concurrent.TimeUnit.SECONDS))
        android.util.Log.i("EmuTest", "tts status=$status lang(en-IN)=$langResult engine=${engine.defaultEngine}")
        engine.shutdown()
        assertEquals(android.speech.tts.TextToSpeech.SUCCESS, status)
    }

    @Test fun theVoiceModelDownloadsChecksUnpacksAndVoskLoadsWithTheGrammar(): Unit = runBlocking {
        val shared = AppGraph.instance.shared
        val root = File(context.cacheDir, "emu-voice-model").also { it.deleteRecursively() }
        val model = VoiceModel(root, shared.voiceModel, ApkInstaller::download, CoroutineScope(SupervisorJob() + Dispatchers.IO))
        assertEquals(ModelState.Missing, model.state.value)
        val t0 = System.currentTimeMillis()
        model.fetch()
        android.util.Log.i("EmuTest", "model fetch ${System.currentTimeMillis() - t0}ms")
        assertEquals(ModelState.Ready, model.state.value)
        assertTrue(model.ready())
        assertTrue(File(model.folder(), "am/final.mdl").isFile)
        assertTrue(File(root, "${shared.voiceModel.name}.zip.part").exists().not())
        // a second fetch is instant (already there)
        model.fetch()

        // Vosk with the real grammar: the words of the "send" question, minus what the model does not know
        val words = VoiceWords.YES + VoiceWords.NO + listOf("send", "it", "please", "ji", "de", "call") 
        val grammar = VoiceWords.grammar("send", words.toSet() - shared.voiceModelMissing)
        val spotters = VoskSpotters(model.folder())
        try {
            val spotter = spotters.make(grammar.phrases)
            val silence = ShortArray(16_000)
            repeat(3) { spotter.accept(silence, silence.size) }
            val json = spotter.finish()
            android.util.Log.i("EmuTest", "vosk silence -> $json")
            assertTrue(json, json.contains("\"text\""))
            spotter.close()

            // real speech, if the host pushed it: /data/local/tmp/yes.pcm (16 kHz mono s16le, "yes")
            val raw = android.os.ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("cat /data/local/tmp/yes.pcm")).use { it.readBytes() }
            if (raw.size > 1000) {
                val pcm = ShortArray(raw.size / 2) { ((raw[2 * it + 1].toInt() shl 8) or (raw[2 * it].toInt() and 0xff)).toShort() }
                val s2 = spotters.make(grammar.phrases)
                var heard = ""
                var i = 0
                while (i < pcm.size) { val n = minOf(4000, pcm.size - i); s2.accept(pcm.copyOfRange(i, i + n), n)?.let { heard += it }; i += n }
                heard += s2.finish()
                android.util.Log.i("EmuTest", "vosk speech -> $heard")
                assertTrue(heard, heard.contains("yes"))
                s2.close()
            }
        } finally { spotters.close() }
        root.deleteRecursively()
    }
}
