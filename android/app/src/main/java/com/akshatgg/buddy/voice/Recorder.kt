package com.akshatgg.buddy.voice

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import java.io.File

/** Records the microphone into a file. stop() finishes the file; it throws when nothing could be recorded. */
interface Recorder {
    fun start(file: File)
    fun stop()
}

/** The phone's microphone, as AAC in MP4 (the server's `audio/mp4`): mono, 16 kHz, 64 kbps, about 480 KB a minute. */
class MediaRecorderRecorder(private val context: Context) : Recorder {
    private var recorder: MediaRecorder? = null

    override fun start(file: File) {
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        try {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(1)
            r.setAudioSamplingRate(16_000)
            r.setAudioEncodingBitRate(64_000)
            r.setOutputFile(file.path)
            r.prepare()
            r.start()
        } catch (e: Exception) {
            r.release()
            throw e
        }
        recorder = r
    }

    override fun stop() {
        val r = recorder ?: return
        recorder = null
        try {
            r.stop() // throws when stopped before anything was recorded
        } finally {
            r.release()
        }
    }
}
