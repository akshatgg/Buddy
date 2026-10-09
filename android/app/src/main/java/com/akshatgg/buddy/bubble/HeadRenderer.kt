package com.akshatgg.buddy.bubble

import android.content.Context
import android.opengl.Matrix
import android.view.Surface
import android.view.TextureView
import com.google.android.filament.Box
import com.google.android.filament.Camera
import com.google.android.filament.ColorGrading
import com.google.android.filament.Colors
import com.google.android.filament.EntityManager
import com.google.android.filament.LightManager
import com.google.android.filament.Renderer
import com.google.android.filament.Scene
import com.google.android.filament.SwapChain
import com.google.android.filament.ToneMapper
import com.google.android.filament.View
import com.google.android.filament.Viewport
import com.google.android.filament.android.UiHelper
import com.google.android.filament.gltfio.AssetLoader
import com.google.android.filament.gltfio.FilamentAsset
import com.google.android.filament.gltfio.ResourceLoader
import com.google.android.filament.utils.Utils
import java.nio.ByteBuffer
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.tan

// The camera, as on the Mac: a 28° vertical field of view.
private const val FOV_DEGREES = 28.0
// Space around the head, as a fraction of its size on each side, so a tilt or a squash is not cut off.
private const val MARGIN = 0.12f
// Space above the head, as a fraction of its height, for the float (0.035) and the happy bounce (0.08).
private const val LIFT_MARGIN = 0.12f

/**
 * Draws one buddy's head with Filament, from the Mac's own .glb: only the Head node and what
 * hangs from it (ears, face, screen, shell and the sprout or the bow), since the phone shows no
 * body. The TextureView is see-through, so whatever is behind the head shows around it.
 * Everything here runs on the main thread, on the process's one engine (see SharedEngine).
 *
 * A file that is not a buddy (no model, or no Head) throws from the constructor before anything
 * is made on the engine or the TextureView is touched.
 */
class HeadRenderer(context: Context, textureView: TextureView, characterId: String) {
    companion object {
        init {
            Utils.init()
        }
    }

    private val engine = SharedEngine.engine
    private val assetLoader: AssetLoader
    private val asset: FilamentAsset
    private val resourceLoader: ResourceLoader
    private val renderer: Renderer
    private val scene: Scene
    private val view: View
    private val cameraEntity: Int
    private val camera: Camera
    private val sun: Int
    private val colorGrading: ColorGrading
    private val uiHelper = UiHelper(UiHelper.ContextErrorPolicy.DONT_CHECK)
    private var swapChain: SwapChain? = null

    // Entities, not component instances: an instance can move when another head's components
    // are destroyed, so it is looked up each time it is used.
    private val head: Int // the Head node
    private val headRest = FloatArray(16) // its transform as loaded, which every pose starts from
    private val pivot = FloatArray(3) // the bottom centre of the head, in the Head node's space
    private val headHeight: Float
    private val face: Int // the Face node, 0 if the model has no face
    private val weights: FloatArray
    private val morphIndex: Map<String, Int>
    private val headTransform = FloatArray(16)

    // What the camera frames, in world space: the head's box with room to move.
    private val frameCentre = FloatArray(3)
    private val frameSize = FloatArray(3)

    // Where Clawd is on the view (spotOnScreen): the view's size, and room for the sums.
    private var viewWidth = 0
    private var viewHeight = 0
    private val faceWorld = FloatArray(16)
    private val viewMatrix = DoubleArray(16)
    private val projection = DoubleArray(16)
    private val onScreen = FloatArray(6) // the spot, a step across and a step up from it, in view pixels

    init {
        // The model first, so that a file that is not a buddy leaves nothing behind.
        val bytes = context.assets.open("$characterId.glb").use { it.readBytes() }
        val buffer = ByteBuffer.allocateDirect(bytes.size).put(bytes).apply { rewind() }
        assetLoader = AssetLoader(engine, SharedEngine.materials, EntityManager.get())
        val loaded = assetLoader.createAsset(buffer)
        if (loaded == null || loaded.getFirstEntityByName("Head") == 0) {
            loaded?.let { assetLoader.destroyAsset(it) }
            assetLoader.destroy()
            error("$characterId.glb has no Head")
        }
        asset = loaded
        head = asset.getFirstEntityByName("Head")
        resourceLoader = ResourceLoader(engine)
        resourceLoader.loadResources(asset)
        asset.releaseSourceData()

        renderer = engine.createRenderer()
        // Clear to see-through every frame: the TextureView is composited over whatever is behind it.
        renderer.clearOptions = renderer.clearOptions.apply {
            clear = true
            clearColor = doubleArrayOf(0.0, 0.0, 0.0, 0.0)
        }
        scene = engine.createScene()
        cameraEntity = EntityManager.get().create()
        camera = engine.createCamera(cameraEntity)
        // An exposure of 1 makes a light's intensity mean what it means to three.js on the Mac,
        // so the Mac's light values carry over as they are.
        camera.setExposure(1f)
        // Khronos PBR Neutral, as on the Mac: it keeps the colours the model was made with (the
        // cream stays cream, the screen stays dark, the eyes stay orange) and only rolls off
        // highlights and glow. Filament's default curve turns the orange glow pale yellow.
        // Filament tone-maps in Rec.2020, where the glow comes out yellower than three.js makes
        // it. The old FILMIC setting has the side effect of tone-mapping in sRGB, as three.js
        // does, while the explicit tone mapper still replaces the filmic curve. That side effect
        // was read in Filament 1.77.1's ColorGrading.cpp and checked on screen against the Mac:
        // after any Filament upgrade, check the eye colours against the Mac again.
        @Suppress("DEPRECATION")
        colorGrading = ColorGrading.Builder()
            .toneMapping(ColorGrading.ToneMapping.FILMIC)
            .toneMapper(ToneMapper.PBRNeutralToneMapper())
            .build(engine)
        view = engine.createView().apply {
            this.scene = this@HeadRenderer.scene
            this.camera = this@HeadRenderer.camera
            blendMode = View.BlendMode.TRANSLUCENT
            colorGrading = this@HeadRenderer.colorGrading
        }

        // The Mac's lights: the studio room, and a soft warm key light from the upper right in front.
        scene.indirectLight = SharedEngine.room
        sun = EntityManager.get().create()
        val key = Colors.toLinear(Colors.RgbType.SRGB, 1f, 0xee / 255f, 0xdd / 255f)
        LightManager.Builder(LightManager.Type.DIRECTIONAL)
            .color(key[0], key[1], key[2])
            .intensity(1.2f)
            .direction(-1.5f, -2.5f, -4f)
            .castShadows(false)
            .build(engine, sun)
        scene.addEntity(sun)

        val tm = engine.transformManager
        tm.getTransform(tm.getInstance(head), headRest)
        fun underHead(entity: Int): Boolean {
            var current = entity
            while (current != 0) {
                if (current == head) return true
                val instance = tm.getInstance(current)
                if (instance == 0) return false
                current = tm.getParent(instance)
            }
            return false
        }
        val parts = asset.renderableEntities.filter(::underHead).toIntArray()
        scene.addEntities(parts)

        // The head's box in world space: the eight corners of every part's box, moved to where it is.
        val rm = engine.renderableManager
        val low = floatArrayOf(Float.MAX_VALUE, Float.MAX_VALUE, Float.MAX_VALUE)
        val high = floatArrayOf(-Float.MAX_VALUE, -Float.MAX_VALUE, -Float.MAX_VALUE)
        val world = FloatArray(16)
        val corner = FloatArray(4)
        val moved = FloatArray(4)
        for (part in parts) {
            val box = rm.getAxisAlignedBoundingBox(rm.getInstance(part), Box())
            tm.getWorldTransform(tm.getInstance(part), world)
            for (i in 0 until 8) {
                for (k in 0..2) {
                    val sign = if ((i shr k) and 1 == 0) -1 else 1
                    corner[k] = box.center[k] + sign * box.halfExtent[k]
                }
                corner[3] = 1f
                Matrix.multiplyMV(moved, 0, world, 0, corner, 0)
                for (k in 0..2) {
                    low[k] = min(low[k], moved[k])
                    high[k] = max(high[k], moved[k])
                }
            }
        }
        headHeight = high[1] - low[1]
        for (k in 0..2) {
            frameCentre[k] = (low[k] + high[k]) / 2
            frameSize[k] = high[k] - low[k]
        }
        frameCentre[1] += headHeight * LIFT_MARGIN / 2
        frameSize[1] += headHeight * LIFT_MARGIN

        // Poses squash and turn the head about its bottom centre, which the Head node's own
        // space needs: the world point through the inverse of the node's world transform.
        val headWorld = FloatArray(16)
        val inverse = FloatArray(16)
        tm.getWorldTransform(tm.getInstance(head), headWorld)
        Matrix.invertM(inverse, 0, headWorld, 0)
        val bottom = floatArrayOf(frameCentre[0], low[1], frameCentre[2], 1f)
        Matrix.multiplyMV(moved, 0, inverse, 0, bottom, 0)
        moved.copyInto(pivot, 0, 0, 3)

        face = asset.getFirstEntityByName("Face")
        val names = if (face != 0) asset.getMorphTargetNames(face) else emptyArray()
        morphIndex = names.withIndex().associate { (i, name) -> name to i }
        weights = FloatArray(names.size)

        textureView.isOpaque = false
        uiHelper.isOpaque = false
        uiHelper.renderCallback = object : UiHelper.RendererCallback {
            override fun onNativeWindowChanged(surface: Surface) {
                swapChain?.let { engine.destroySwapChain(it) }
                swapChain = engine.createSwapChain(surface, uiHelper.swapChainFlags)
            }

            override fun onDetachedFromSurface() {
                // The surface goes as soon as this returns, so the GPU must be done with it first.
                swapChain?.let {
                    engine.destroySwapChain(it)
                    engine.flushAndWait()
                }
                swapChain = null
            }

            override fun onResized(width: Int, height: Int) = resize(width, height)
        }
        uiHelper.attachTo(textureView)
        // On a TextureView that already has its surface (a new buddy on the old one's view),
        // UiHelper reports a size of 0 × 0, so the view's own size is used.
        if (textureView.isAvailable) resize(textureView.width, textureView.height)
    }

    /** Fit the viewport and the camera to the surface. A size of zero (not laid out yet) changes nothing. */
    private fun resize(width: Int, height: Int) {
        if (width == 0 || height == 0) return
        viewWidth = width
        viewHeight = height
        view.viewport = Viewport(0, 0, width, height)
        frameCamera(width.toDouble() / height)
    }

    /** Point the camera at the head, with room around it to float, bounce and tilt. */
    private fun frameCamera(aspect: Double) {
        val fit = max(frameSize[1] * (1 + 2 * MARGIN).toDouble(), frameSize[0] * (1 + 2 * MARGIN) / aspect)
        val distance = fit / 2 / tan(Math.toRadians(FOV_DEGREES / 2))
        camera.setProjection(FOV_DEGREES, aspect, 0.05, distance + 10.0, Camera.Fov.VERTICAL)
        val (x, y, z) = frameCentre.map { it.toDouble() }
        camera.lookAt(x, y, z + distance, x, y, z, 0.0, 1.0, 0.0)
    }

    private fun setMorph(name: String, value: Float) {
        morphIndex[name]?.let { weights[it] = value }
    }

    /** Apply a pose: the face's morphs, and the head's lift, tip, tilt, turn and squash. `float` is Moods.floatOffset(t). */
    fun setPose(pose: Pose, blink: Float, float: Float) {
        if (face != 0 && weights.isNotEmpty()) {
            setMorph("blink", Moods.blinkWeight(pose, blink))
            setMorph("smile", pose.smile)
            setMorph("mouthO", pose.mouthO)
            setMorph("eyeLUp", pose.eyeL)
            setMorph("eyeRUp", pose.eyeR)
            val rm = engine.renderableManager
            rm.setMorphWeights(rm.getInstance(face), weights, 0)
        }
        headRest.copyInto(headTransform)
        Matrix.translateM(headTransform, 0, pivot[0], pivot[1] + (float + pose.lift) * headHeight, pivot[2])
        // The tip up or down last, so that a head turned to the side still tips toward the camera's up and down.
        Matrix.rotateM(headTransform, 0, Math.toDegrees(pose.pitch.toDouble()).toFloat(), 1f, 0f, 0f)
        Matrix.rotateM(headTransform, 0, Math.toDegrees(pose.headTilt.toDouble()).toFloat(), 0f, 0f, 1f)
        Matrix.rotateM(headTransform, 0, Math.toDegrees(pose.yaw.toDouble()).toFloat(), 0f, 1f, 0f)
        Matrix.scaleM(headTransform, 0, pose.scaleX, pose.scaleY, pose.scaleX)
        Matrix.translateM(headTransform, 0, -pivot[0], -pivot[1], -pivot[2])
        val tm = engine.transformManager
        tm.setTransform(tm.getInstance(head), headTransform)
    }

    /**
     * Where the point (x, y, z) of the head (its own space; the face's is the same) is on the view as the head is posed
     * now, for Clawd (ClawdView): into `out`, the spot (x, y in view pixels), the pixels one unit of the head takes
     * across and up there, and the head's tilt in degrees. False when there is no face or the view is not laid out.
     */
    fun spotOnScreen(x: Float, y: Float, z: Float, out: FloatArray): Boolean {
        if (face == 0 || viewWidth == 0 || viewHeight == 0) return false
        val tm = engine.transformManager
        tm.getWorldTransform(tm.getInstance(face), faceWorld)
        camera.getViewMatrix(viewMatrix)
        camera.getProjectionMatrix(projection)
        val step = 0.1f
        if (!project(x, y, z, 0) || !project(x + step, y, z, 2) || !project(x, y + step, z, 4)) return false
        out[0] = onScreen[0]
        out[1] = onScreen[1]
        out[2] = hypot(onScreen[2] - onScreen[0], onScreen[3] - onScreen[1]) / step
        out[3] = hypot(onScreen[4] - onScreen[0], onScreen[5] - onScreen[1]) / step
        out[4] = Math.toDegrees(atan2((onScreen[3] - onScreen[1]).toDouble(), (onScreen[2] - onScreen[0]).toDouble())).toFloat()
        return true
    }

    /** A point of the face (its own space) on the view, in pixels from the top left, into onScreen[at], [at + 1]. */
    private fun project(x: Float, y: Float, z: Float, at: Int): Boolean {
        // Column-major, as Filament and android.opengl.Matrix keep them: the face's world, the camera's view, then its lens.
        val wx = faceWorld[0] * x + faceWorld[4] * y + faceWorld[8] * z + faceWorld[12]
        val wy = faceWorld[1] * x + faceWorld[5] * y + faceWorld[9] * z + faceWorld[13]
        val wz = faceWorld[2] * x + faceWorld[6] * y + faceWorld[10] * z + faceWorld[14]
        val v = DoubleArray(4) { r -> viewMatrix[r] * wx + viewMatrix[4 + r] * wy + viewMatrix[8 + r] * wz + viewMatrix[12 + r] }
        val c = DoubleArray(4) { r -> projection[r] * v[0] + projection[4 + r] * v[1] + projection[8 + r] * v[2] + projection[12 + r] * v[3] }
        if (c[3] <= 0.0) return false
        onScreen[at] = (((c[0] / c[3]) + 1) / 2 * viewWidth).toFloat()
        onScreen[at + 1] = ((1 - (c[1] / c[3])) / 2 * viewHeight).toFloat()
        return true
    }

    /** Draw one frame, if there is a surface to draw on. */
    fun render(frameTimeNanos: Long) {
        val target = swapChain ?: return
        if (!uiHelper.isReadyToRender) return
        if (renderer.beginFrame(target, frameTimeNanos)) {
            renderer.render(view)
            renderer.endFrame()
        }
    }

    /**
     * Free everything this head made, and let go of the TextureView, which keeps showing the
     * last frame until something else draws on it. The shared engine stays, for the next head.
     * The renderer is no use after this.
     */
    fun destroy() {
        uiHelper.detach() // destroys the swap chain, through onDetachedFromSurface
        engine.destroyRenderer(renderer)
        engine.destroyView(view)
        engine.destroyScene(scene)
        engine.destroyCameraComponent(cameraEntity)
        engine.destroyColorGrading(colorGrading)
        engine.destroyEntity(sun)
        assetLoader.destroyAsset(asset)
        resourceLoader.destroy()
        assetLoader.destroy()
        EntityManager.get().destroy(sun)
        EntityManager.get().destroy(cameraEntity)
    }
}
