package com.akshatgg.buddy.bubble

import android.util.Half
import com.google.android.filament.Colors
import com.google.android.filament.Engine
import com.google.android.filament.IndirectLight
import com.google.android.filament.Texture
import com.google.android.filament.gltfio.UbershaderProvider
import com.google.android.filament.utils.IBLPrefilterContext
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sign
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The Mac's studio room, three.js's RoomEnvironment: a white room lit by one ceiling light, with
 * six white boxes on the floor and six glowing panels on the walls and ceiling. Glossy plastic
 * and glass need something to reflect, and on the Mac this room is it. Filament has no such
 * room, so the phone traces the same one (seen from the same point, and tipped back the same
 * way) into a panorama, and turns that into Filament's image-based light: a reflection cubemap
 * for the glossy parts, and spherical harmonics for the soft light the room casts.
 */
internal object StudioRoom {
    // The panorama's size: 1.4° a pixel, so the smallest panel (3° across) still shows.
    const val WIDTH = 256
    const val HEIGHT = 128

    // The Mac tips the room back 0.3 rad (environmentRotation.x = -0.3), so the front panel
    // shows as a reflection across the top of the face screen rather than between the eyes:
    // looking along a world direction is looking 0.3 rad lower in the room.
    private const val TIP = 0.3

    // RoomEnvironment moves its scene 3.5 down, and three.js looks at it from the origin.
    private val EYE = doubleArrayOf(0.0, 3.5, 0.0)
    private val LIGHT = doubleArrayOf(0.418, 16.199, 0.300)
    private const val LIGHT_POWER = 900.0 // candela
    private const val LIGHT_RANGE = 28.0 // three.js fades a point light out to nothing at this distance

    /**
     * A unit cube, scaled, turned about y and moved, as in RoomEnvironment.js. `glow` is a
     * panel's brightness; 0 is a white surface that the ceiling light lights.
     */
    private class Block(
        x: Double, y: Double, z: Double, turn: Double,
        sx: Double, sy: Double, sz: Double, val glow: Double = 0.0,
    ) {
        val cos = cos(turn)
        val sin = sin(turn)
        val half = doubleArrayOf(sx / 2, sy / 2, sz / 2)

        // The eye in the block's own frame (centred and not turned): the same for every ray.
        val eye = doubleArrayOf(
            (EYE[0] - x) * cos - (EYE[2] - z) * sin,
            EYE[1] - y,
            (EYE[0] - x) * sin + (EYE[2] - z) * cos,
        )
    }

    private val room = Block(-0.757, 13.219, 0.717, 0.0, 31.713, 28.305, 28.591)
    private val blocks = listOf(
        Block(-10.906, 2.009, 1.846, -0.195, 2.328, 7.905, 4.651),
        Block(-5.607, -0.754, -0.758, 0.994, 1.970, 1.534, 3.955),
        Block(6.167, 0.857, 7.803, 0.561, 3.927, 6.285, 3.687),
        Block(-2.017, 0.018, 6.124, 0.333, 2.002, 4.566, 2.064),
        Block(2.291, -0.756, -2.621, -0.286, 1.546, 1.552, 1.496),
        Block(-2.193, -0.369, -5.547, 0.516, 3.875, 3.487, 2.986),
        Block(-16.116, 14.37, 8.208, 0.0, 0.1, 2.428, 2.739, glow = 50.0),
        Block(-16.109, 18.021, -8.207, 0.0, 0.1, 2.425, 2.751, glow = 50.0),
        Block(14.904, 12.198, -1.832, 0.0, 0.15, 4.265, 6.331, glow = 17.0),
        Block(-0.462, 8.89, 14.520, 0.0, 4.38, 5.441, 0.088, glow = 43.0),
        Block(3.235, 11.486, -12.541, 0.0, 2.5, 2.0, 0.1, glow = 20.0),
        Block(0.0, 20.0, 0.0, 0.0, 1.0, 0.1, 1.0, glow = 100.0),
    )

    // Scratch space for the tracing below, which runs once, on the main thread: some 400 000
    // ray tests that should not each make garbage.
    private val ray = DoubleArray(3)
    private val face = DoubleArray(3)
    private val normal = DoubleArray(3)
    private val nearestNormal = DoubleArray(3)
    private val d = DoubleArray(3)

    /**
     * How far along `d` a ray from the eye meets the block: where it goes in, or with `inside`
     * (the room around the eye) where it goes out. NaN if it misses. `normal` gets the face's
     * normal, facing the eye.
     */
    private fun hit(block: Block, inside: Boolean): Double {
        // In the block's own frame: centred and not turned.
        val origin = block.eye
        ray[0] = d[0] * block.cos - d[2] * block.sin
        ray[1] = d[1]
        ray[2] = d[0] * block.sin + d[2] * block.cos
        var near = Double.NEGATIVE_INFINITY
        var far = Double.POSITIVE_INFINITY
        var nearAxis = 0
        var farAxis = 0
        for (k in 0..2) {
            if (ray[k] == 0.0) {
                if (abs(origin[k]) > block.half[k]) return Double.NaN
                continue
            }
            val t1 = (-block.half[k] - origin[k]) / ray[k]
            val t2 = (block.half[k] - origin[k]) / ray[k]
            if (min(t1, t2) > near) { near = min(t1, t2); nearAxis = k }
            if (max(t1, t2) < far) { far = max(t1, t2); farAxis = k }
        }
        val t = if (inside) far else near
        if (near > far || t <= 0) return Double.NaN
        val axis = if (inside) farAxis else nearAxis
        face.fill(0.0)
        face[axis] = -sign(ray[axis])
        normal[0] = face[0] * block.cos + face[2] * block.sin
        normal[1] = face[1]
        normal[2] = -face[0] * block.sin + face[2] * block.cos
        return t
    }

    /** What the eye sees along a world direction: a panel's glow, or a white surface lit by the ceiling light. */
    private fun radiance(x: Double, y: Double, z: Double): Double {
        d[0] = x
        d[1] = y * cos(TIP) - z * sin(TIP)
        d[2] = y * sin(TIP) + z * cos(TIP)
        var nearest = hit(room, inside = true)
        normal.copyInto(nearestNormal)
        var glow = 0.0
        for (block in blocks) {
            val t = hit(block, inside = false)
            if (t.isNaN() || t >= nearest) continue
            nearest = t
            glow = block.glow
            normal.copyInto(nearestNormal)
        }
        if (glow > 0) return glow
        // A white matte surface: the light's illuminance over π, as three.js lights it.
        val lx = LIGHT[0] - (EYE[0] + d[0] * nearest)
        val ly = LIGHT[1] - (EYE[1] + d[1] * nearest)
        val lz = LIGHT[2] - (EYE[2] + d[2] * nearest)
        val distance = sqrt(lx * lx + ly * ly + lz * lz)
        val facing = (lx * nearestNormal[0] + ly * nearestNormal[1] + lz * nearestNormal[2]) / distance
        if (facing <= 0) return 0.0
        val fade = (1 - (distance / LIGHT_RANGE).pow(4)).coerceIn(0.0, 1.0)
        return LIGHT_POWER * facing / (distance * distance) * fade * fade / PI
    }

    /**
     * The world direction that pixel (i, j) of Filament's panorama looks along, into `out`, and
     * the solid angle the pixel covers. The top row looks straight up and the middle column
     * along +z; Filament reads the panorama back mirrored, so the columns left of the middle
     * look towards +x.
     */
    fun direction(i: Int, j: Int, out: DoubleArray): Double {
        val elevation = (0.5 - (j + 0.5) / HEIGHT) * PI
        val azimuth = ((i + 0.5) / WIDTH * 2 - 1) * PI
        out[0] = -cos(elevation) * sin(azimuth)
        out[1] = sin(elevation)
        out[2] = cos(elevation) * cos(azimuth)
        return (2 * PI / WIDTH) * (PI / HEIGHT) * cos(elevation)
    }

    /** The room's radiance through every pixel of the panorama, row by row from the top. */
    private fun trace(): DoubleArray {
        val look = DoubleArray(3)
        return DoubleArray(WIDTH * HEIGHT) { k ->
            direction(k % WIDTH, k / WIDTH, look)
            radiance(look[0], look[1], look[2])
        }
    }

    /**
     * The soft light a panorama of radiances casts, as the nine spherical harmonics in the
     * polynomial form Filament's shader evaluates: 1, y, z, x, yx, yz, 3z²-1, zx, x²-y². Each is
     * the panorama projected on it, times the harmonic's constant squared and the Lambert lobe
     * over π (1, 2/3, 1/4 for the three bands): what Filament calls pre-scaled irradiance.
     */
    fun harmonics(values: DoubleArray): DoubleArray {
        val sums = DoubleArray(9)
        val look = DoubleArray(3)
        for (k in values.indices) {
            val w = values[k] * direction(k % WIDTH, k / WIDTH, look)
            val (x, y, z) = look
            sums[0] += w
            sums[1] += w * y
            sums[2] += w * z
            sums[3] += w * x
            sums[4] += w * y * x
            sums[5] += w * y * z
            sums[6] += w * (3 * z * z - 1)
            sums[7] += w * z * x
            sums[8] += w * (x * x - y * y)
        }
        val band0 = 1 / (4 * PI)
        val band1 = 1 / (2 * PI)
        val scale = doubleArrayOf(
            band0, band1, band1, band1,
            15 / (16 * PI), 15 / (16 * PI), 5 / (64 * PI), 15 / (16 * PI), 15 / (64 * PI),
        )
        return DoubleArray(9) { sums[it] * scale[it] }
    }

    /**
     * The room as Filament's image-based light, with the Mac's hemisphere light (warm from above,
     * a little darker from below) added to its soft part, since Filament has no hemisphere light.
     * `prefilter` turns the panorama into the reflection cubemap; the caller keeps it, since
     * freeing it waits for the GPU to finish (over a second on the emulator), which would hold up
     * the main thread.
     */
    fun build(engine: Engine, prefilter: IBLPrefilterContext): IndirectLight {
        val values = trace()
        val harmonics = harmonics(values)

        // The Mac's HemisphereLight(0xfff3e6, 0xd9cbbd, 0.5): sky and ground mixed by the normal's
        // height, over π for the Lambert lobe, which is a constant plus a slope in y.
        val sky = Colors.toLinear(Colors.RgbType.SRGB, 1f, 0xf3 / 255f, 0xe6 / 255f)
        val ground = Colors.toLinear(Colors.RgbType.SRGB, 0xd9 / 255f, 0xcb / 255f, 0xbd / 255f)
        val hemisphere = 0.5 / PI
        val sh = FloatArray(27)
        for (i in 0 until 9) for (c in 0..2) sh[i * 3 + c] = harmonics[i].toFloat()
        for (c in 0..2) {
            sh[c] += ((sky[c] + ground[c]) / 2 * hemisphere).toFloat()
            sh[3 + c] += ((sky[c] - ground[c]) / 2 * hemisphere).toFloat()
        }
        val light = IndirectLight.Builder().irradiance(3, sh).intensity(1f)

        // The prefilter makes the panorama's mip levels itself, which needs a format the GPU can
        // draw into. A GPU that cannot gets the soft light alone, rather than Filament's abort.
        val format = Texture.InternalFormat.R11F_G11F_B10F
        if (!Texture.isTextureFormatMipmappable(engine, format)) return light.build(engine)
        val pixels = ByteBuffer.allocateDirect(values.size * 3 * 2).order(ByteOrder.nativeOrder())
        for (value in values) {
            val half = Half.toHalf(value.toFloat())
            repeat(3) { pixels.putShort(half) }
        }
        pixels.rewind()
        val panorama = Texture.Builder()
            .width(WIDTH).height(HEIGHT).levels(0xff)
            .sampler(Texture.Sampler.SAMPLER_2D)
            .format(format)
            .usage(Texture.Usage.DEFAULT or Texture.Usage.GEN_MIPMAPPABLE)
            .build(engine)
        panorama.setImage(engine, 0, Texture.PixelBufferDescriptor(pixels, Texture.Format.RGB, Texture.Type.HALF))
        val toCubemap = IBLPrefilterContext.EquirectangularToCubemap(prefilter)
        val specular = IBLPrefilterContext.SpecularFilter(prefilter)
        val cubemap = toCubemap.run(panorama)
        val reflections = specular.run(cubemap)
        engine.destroyTexture(panorama)
        engine.destroyTexture(cubemap)
        specular.destroy()
        toCubemap.destroy()
        return light.reflections(reflections).build(engine)
    }
}

/**
 * One Filament engine for every head in the process (the Welcome window shows two, and the
 * bubble a third): one GPU context and one render thread however many heads are on screen, and
 * the studio room's light made once. Every head is made, drawn and freed on the main thread.
 * The engine is made with the first head and kept for the life of the process: an engine made
 * after another one has drawn gets black reflections (seen on the emulator, whether or not the
 * first one was destroyed), and keeping it also spares rebuilding the GPU context and the room
 * each time a window opens or the phone turns.
 */
internal object SharedEngine {
    val engine: Engine = Engine.create()
    val materials = UbershaderProvider(engine)
    private val prefilter = IBLPrefilterContext(engine)
    val room: IndirectLight = StudioRoom.build(engine, prefilter)
}
