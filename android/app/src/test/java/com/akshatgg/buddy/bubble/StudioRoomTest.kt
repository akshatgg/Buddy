package com.akshatgg.buddy.bubble

import org.junit.Assert.assertEquals
import org.junit.Test

class StudioRoomTest {
    private val size = StudioRoom.WIDTH * StudioRoom.HEIGHT

    /** A panorama of `radiance` along each pixel's direction. */
    private fun panorama(radiance: (x: Double, y: Double, z: Double) -> Double): DoubleArray {
        val d = DoubleArray(3)
        return DoubleArray(size) { k ->
            StudioRoom.direction(k % StudioRoom.WIDTH, k / StudioRoom.WIDTH, d)
            radiance(d[0], d[1], d[2])
        }
    }

    @Test fun anEvenRoomLightsEveryWayWithItsOwnBrightness() {
        val sh = StudioRoom.harmonics(panorama { _, _, _ -> 2.0 })
        assertEquals(2.0, sh[0], 1e-3)
        for (i in 1 until 9) assertEquals("term $i", 0.0, sh[i], 1e-3)
    }

    @Test fun aRoomBrighterTowardsPlusXLightsThePlusXSideMore() {
        // Radiance 1 + x gives 1 + (2/3)·n.x, the cosine lobe over π, all in the x term.
        val sh = StudioRoom.harmonics(panorama { x, _, _ -> 1 + x })
        assertEquals(1.0, sh[0], 1e-3)
        assertEquals(2.0 / 3, sh[3], 1e-3)
        for (i in listOf(1, 2, 4, 5, 6, 7, 8)) assertEquals("term $i", 0.0, sh[i], 1e-3)
    }

    @Test fun thePixelsCoverTheWholeSphere() {
        val d = DoubleArray(3)
        var total = 0.0
        for (j in 0 until StudioRoom.HEIGHT) for (i in 0 until StudioRoom.WIDTH) total += StudioRoom.direction(i, j, d)
        assertEquals(4 * Math.PI, total, 1e-3)
    }
}
