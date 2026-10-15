package com.akshatgg.buddy.voice

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class MicBusTest {
    @Test fun holdingCountsUpAndDown() = runTest {
        val before = MicBus.busy.value
        var inside = -1
        MicBus.holding { inside = MicBus.busy.value }
        assertEquals(before + 1, inside)
        assertEquals(before, MicBus.busy.value)
    }

    @Test fun holdingLetsGoAlsoOnAnException() = runTest {
        val before = MicBus.busy.value
        assertThrows(IllegalStateException::class.java) {
            kotlinx.coroutines.runBlocking { MicBus.holding<Unit> { throw IllegalStateException("x") } }
        }
        assertEquals(before, MicBus.busy.value)
    }

    @Test fun twoAtOnceCountTwo() = runTest {
        val before = MicBus.busy.value
        MicBus.hold(); MicBus.hold()
        assertEquals(before + 2, MicBus.busy.value)
        MicBus.release(); MicBus.release()
        assertEquals(before, MicBus.busy.value)
    }
}
