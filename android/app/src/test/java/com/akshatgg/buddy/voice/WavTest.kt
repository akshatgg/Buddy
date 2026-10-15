package com.akshatgg.buddy.voice

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class WavTest {
    @Test fun aWavIsTheRiffHeaderThenTheSamplesLittleEndian() {
        val wav = Wav.of(shortArrayOf(1, -2, 300))
        assertEquals(44 + 6, wav.size)
        assertEquals("RIFF", String(wav, 0, 4)); assertEquals("WAVE", String(wav, 8, 4)); assertEquals("data", String(wav, 36, 4))
        val b = java.nio.ByteBuffer.wrap(wav).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        assertEquals(36 + 6, b.getInt(4)); assertEquals(1, b.getShort(22).toInt()); assertEquals(16_000, b.getInt(24))
        assertEquals(16, b.getShort(34).toInt()); assertEquals(6, b.getInt(40))
        assertEquals(1, b.getShort(44).toInt()); assertEquals(-2, b.getShort(46).toInt()); assertEquals(300, b.getShort(48).toInt())
    }

    @Test fun theLevelIsTheRmsOfTheSamples() {
        assertEquals(0f, levelOf(ShortArray(10), 10), 0f)
        assertEquals(0.5f, levelOf(ShortArray(10) { 16384 }, 10), 0.001f)
    }

    @Test fun theKeeperKeepsTheLastSamplesAndCountsFromTheFirst() {
        val k = PcmKeeper(4)
        k.add(shortArrayOf(1, 2, 3), 3); k.add(shortArrayOf(4, 5, 9), 2)
        assertArrayEquals(shortArrayOf(2, 3, 4, 5), k.all())
        assertArrayEquals(shortArrayOf(4, 5), k.from(3))
        assertArrayEquals(shortArrayOf(2, 3, 4, 5), k.from(0))
    }
}
