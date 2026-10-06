"""Build Buddy's characters in Blender and export them for the app.

Run from the repo root:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python art/build_buddies.py -- --out assets/buddies [--only boy-1]

For every entry in CHARACTERS this writes <out>/<id>.glb, a preview render
<out>/previews/<id>.png, and finally <out>/buddies.json for the app.

Every .glb follows the contract in docs/superpowers/specs (section 3):
nodes Root, Head, ArmL, ArmR, and a mesh Face with morph targets blink,
smile and mouthO. The app animates those by name, so keep them.
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

CHARACTERS = [
    {"id": "boy-1", "gender": "boy", "defaultName": "Aarav", "hair": "short",
     "colors": {"skin": "#e8b48f", "hair": "#3b2a20", "outfit": "#3fb6a8", "accent": "#2b7f76"}},
    {"id": "girl-1", "gender": "girl", "defaultName": "Anaya", "hair": "bob",
     "colors": {"skin": "#ecbc98", "hair": "#2a1b18", "outfit": "#ff7a8a", "accent": "#ffd166"}},
]

HEAD_PIVOT = Vector((0, 0, 1.0))   # neck: Head turns and tilts around here
HEAD_CENTER = Vector((0, 0, 0.45))  # head sphere centre, relative to the pivot
HEAD_R = 0.62


# --------------------------------------------------------------- helpers

def srgb_to_linear(hex_color):
    hex_color = hex_color.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(hex_color[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


def material(name, hex_color, roughness=0.55):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = srgb_to_linear(hex_color)
    bsdf.inputs["Roughness"].default_value = roughness
    mat.use_backface_culling = False
    return mat


def mesh_object(name, bm, mat, parent=None, location=(0, 0, 0), smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for poly in me.polygons:
            poly.use_smooth = True
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    return obj


def sphere(radius=1.0, scale=(1, 1, 1), offset=(0, 0, 0), segments=32, rings=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    bmesh.ops.transform(bm, matrix=Matrix.Diagonal((*scale, 1)), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(offset), verts=bm.verts)
    return bm


def empty(name, parent=None, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    return obj


def add_modifiers(obj, solidify=0.0, subsurf=1):
    if solidify:
        mod = obj.modifiers.new("Solidify", "SOLIDIFY")
        mod.thickness = solidify
        mod.offset = 1.0
    if subsurf:
        mod = obj.modifiers.new("Subsurf", "SUBSURF")
        mod.levels = subsurf
        mod.render_levels = subsurf


def on_head(x, dz, inset=0.012):
    """A point on the front of the head sphere (front is -Y), relative to the pivot."""
    y = -math.sqrt(max(HEAD_R ** 2 - x ** 2 - dz ** 2, 0.0)) + inset
    return Vector((x, y, HEAD_CENTER.z + dz))


def facing(point):
    """Z rotation that turns a part on the head surface to face outward."""
    return math.atan2(point.x, -point.y)


def merge(bm, part):
    """Append the bmesh `part` to `bm` and free it."""
    tmp = bpy.data.meshes.new("tmp")
    part.to_mesh(tmp)
    part.free()
    bm.from_mesh(tmp)
    bpy.data.meshes.remove(tmp)


def place(part, az, el, radius, spin=0.0):
    """Set a part built facing -Y onto a sphere around the head centre.

    az turns from the front (0) toward +X, el lifts toward the crown; the part's
    -Y ends up pointing out of the head, its +Z up the head, and `spin` turns it
    around that outward axis.
    """
    out = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
    side = Vector((math.cos(az), math.sin(az), 0.0))
    frame = Matrix((side, -out, out.cross(side))).transposed()
    bmesh.ops.rotate(part, cent=(0, 0, 0), matrix=frame @ Matrix.Rotation(spin, 3, "Y"), verts=part.verts)
    bmesh.ops.translate(part, vec=HEAD_CENTER + out * radius, verts=part.verts)
    return part


def lock(length, width, thick=0.05, flare=0.0, radius=HEAD_R):
    """A clump of hair facing -Y: round at the top, pointed at the bottom tip.

    It curves to hug a sphere of `radius`; `flare` lifts the tip away from it.
    """
    bm = sphere(1, (width, thick, length), segments=12, rings=8)
    for v in bm.verts:
        down = max(0.0, -v.co.z / length)  # 0 at the middle, 1 at the tip
        v.co.x *= 1.0 - 0.6 * down
        v.co.y += v.co.z ** 2 / (2 * radius) - flare * down ** 2
    return bm


def spike(length, radius, lean=0.5):
    """A soft, flame-shaped tuft standing out of the head (-Y), leaning `lean` radians up the head."""
    bm = sphere(1, (radius, radius * 0.75, length), offset=(0, 0, length * 0.3), segments=16, rings=12)
    for v in bm.verts:
        up = max(0.0, v.co.z / length)  # 0 at the root, 1 at the tip
        v.co.x *= 1.0 - 0.5 * up
        v.co.y = v.co.y * (1.0 - 0.5 * up) - 0.25 * radius * up ** 2  # curls a little at the tip
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2 - lean, 3, "X"), verts=bm.verts)
    return bm


# ----------------------------------------------------------------- parts

def build_face(head, mats, lashes=False):
    """Eyes, eye shine and mouth in one mesh, with the blink/smile/mouthO keys."""
    bm = bmesh.new()
    groups = {}  # part name -> list of vertex indices

    def add(part, part_bm, location, rot_z):
        part_bm.verts.ensure_lookup_table()
        bmesh.ops.rotate(part_bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_z, 3, "Z"), verts=part_bm.verts)
        bmesh.ops.translate(part_bm, vec=location, verts=part_bm.verts)
        tmp = bpy.data.meshes.new("tmp")
        part_bm.to_mesh(tmp)
        part_bm.free()
        start = len(bm.verts)
        bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
        groups.setdefault(part, []).extend(range(start, len(bm.verts)))

    material_index = {"eye": 0, "shine": 1, "mouth": 2}
    for side in (-1, 1):
        eye_at = on_head(0.22 * side, 0.0)
        add(f"eye{side}", sphere(1, (0.095, 0.05, 0.135), segments=24, rings=12), eye_at, facing(eye_at))
        # A big shine up top and a small one below: glossy, cartoon eyes.
        for offset, size in (((0.03 * side, -0.04, 0.055), 0.032), ((-0.035 * side, -0.035, -0.065), 0.016)):
            add(f"shine{side}", sphere(1, (size, 0.02, size * 1.2), segments=12, rings=8),
                eye_at + Vector(offset), facing(eye_at))
        if lashes:  # two flicks at the outer corner, in the eye's colour
            for x, z, angle, length in ((0.085, 0.105, 0.8, 0.045), (0.105, 0.06, 0.35, 0.04)):
                lash = sphere(1, (length, 0.015, 0.014), segments=12, rings=6)
                bmesh.ops.rotate(lash, cent=(0, 0, 0), matrix=Matrix.Rotation(-angle * side, 3, "Y"), verts=lash.verts)
                add(f"lash{side}", lash, eye_at + Vector((x * side, -0.01, z)), facing(eye_at))
    bend = 2.6  # the mouth rests in a small smile
    mouth_at = on_head(0.0, -0.19)
    mouth_bm = sphere(1, (0.085, 0.03, 0.028), segments=24, rings=12)
    for v in mouth_bm.verts:
        v.co.z += bend * v.co.x ** 2
    add("mouth", mouth_bm, mouth_at, 0.0)

    me = bpy.data.meshes.new("Face")
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
        part = next(p for p, idx in groups.items() if poly.vertices[0] in idx)
        poly.material_index = material_index["eye" if part.startswith(("eye", "lash")) else
                                              "shine" if part.startswith("shine") else "mouth"]
    for key in ("eye", "shine", "mouth"):
        me.materials.append(mats[key])

    face = bpy.data.objects.new("Face", me)
    bpy.context.collection.objects.link(face)
    face.parent = head

    face.shape_key_add(name="Basis", from_mix=False)

    def centre(indices):
        return sum((me.vertices[i].co for i in indices), Vector()) / len(indices)

    blink = face.shape_key_add(name="blink", from_mix=False)
    for side in (-1, 1):
        eye = groups[f"eye{side}"]
        c = centre(eye)
        for i in eye + groups.get(f"lash{side}", []):  # lashes fold down with the lid
            co = me.vertices[i].co
            blink.data[i].co = Vector((co.x, co.y, c.z - 0.02 + (co.z - c.z) * 0.08))
        for i in groups[f"shine{side}"]:
            blink.data[i].co = c  # shine shrinks into the closed eye

    mouth = groups["mouth"]
    c = mouth_at

    def flat_z(co):  # the mouth before its resting smile was bent in
        return co.z - bend * (co.x - c.x) ** 2

    smile = face.shape_key_add(name="smile", from_mix=False)
    for i in mouth:
        co = me.vertices[i].co
        dx = (co.x - c.x) * 1.4
        smile.data[i].co = Vector((c.x + dx, co.y, c.z + (flat_z(co) - c.z) * 0.6 + 3.5 * dx * dx))
    mouth_o = face.shape_key_add(name="mouthO", from_mix=False)
    for i in mouth:
        co = me.vertices[i].co
        mouth_o.data[i].co = Vector((c.x + (co.x - c.x) * 0.65, co.y, c.z + (flat_z(co) - c.z) * 2.4))
    # Blender 5 starts new keys at 1.0, and the glTF exporter writes these as
    # the mesh's default weights, so every key must start at rest.
    for key in (blink, smile, mouth_o):
        key.value = 0.0
    return face


def build_hair(style, head, mat):
    r = HEAD_R + 0.035
    bm = sphere(r, offset=HEAD_CENTER + Vector((0, 0.02, 0.02)), segments=40, rings=20)
    cz = HEAD_CENTER.z
    if style == "short":
        # Cap: open the face and the ears, keep the back down to the neck.
        doomed = [v for v in bm.verts
                  if (v.co.y < -0.18 and v.co.z < cz + 0.3)
                  or (v.co.z < cz - 0.25 and v.co.y < 0.25) or (v.co.z < cz - 0.42)
                  or (abs(v.co.x) > 0.4 and v.co.z < cz + 0.02 and v.co.y < 0.12)]
    else:  # "bob": the sides come down past the cheeks and flare out
        doomed = [v for v in bm.verts
                  if (v.co.y < -0.34 and v.co.z < cz + 0.26)
                  or (v.co.y < -0.2 and v.co.z < cz - 0.26)  # under the side locks
                  or (v.co.z < cz - 0.46)]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    if style == "bob":
        for v in bm.verts:
            low = max(0.0, (cz - 0.05 - v.co.z) / 0.4)
            v.co.x *= 1 + 0.2 * low ** 2
            v.co.y = max(v.co.y, 0.02 + (v.co.y - 0.02) * (1 + 0.12 * low ** 2))  # out and back, never forward
    hair = mesh_object("Hair", bm, mat, parent=head)
    add_modifiers(hair, solidify=0.03, subsurf=1)

    # Locks and spikes are closed shapes: they need no solidify.
    tufts = bmesh.new()
    if style == "short":
        # A short fringe swept to one side, and a tuft of spikes on the crown.
        for az, length in ((-0.78, 0.1), (-0.45, 0.13), (-0.12, 0.12), (0.2, 0.14), (0.52, 0.11), (0.82, 0.09)):
            merge(tufts, place(lock(length, 0.13, flare=0.01), az, 0.52, r + 0.005, spin=-0.6))
        for az, el, length in ((-0.5, 0.86, 0.18), (0.05, 0.98, 0.22), (0.58, 0.84, 0.18)):
            merge(tufts, place(spike(length, 0.16, lean=1.2), az, el, r - 0.05, spin=0.3 + 1.1 * az))
    else:
        # Straight bangs over the forehead, and three long locks each side that flare out.
        for i in range(7):
            merge(tufts, place(lock(0.13, 0.11), -0.9 + 0.3 * i, 0.44, r + 0.005))
        for side in (-1, 1):
            for az, el, length, flare in ((0.92, -0.02, 0.3, 0.05), (1.2, -0.1, 0.32, 0.08), (1.5, -0.12, 0.3, 0.08)):
                merge(tufts, place(lock(length, 0.1, flare=flare), az * side, el, r + 0.005))
    add_modifiers(mesh_object("HairTufts", tufts, mat, parent=head), subsurf=1)
    return hair


def build_bow(head, mat):
    """A bow up on one side of the hair, turned toward the front so it shows."""
    bm = bmesh.new()
    for side in (-1, 1):
        wing = sphere(1, (0.17, 0.055, 0.115), offset=(0.16 * side, 0, 0), segments=20, rings=10)
        for v in wing.verts:  # pinch each wing in toward the knot
            v.co.z *= 0.45 + 0.55 * min(abs(v.co.x) / 0.33, 1.0)
        merge(bm, wing)
    merge(bm, sphere(0.065, segments=16, rings=8))
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(-0.7, 3, "X"), verts=bm.verts)  # tip it to the front
    place(bm, 0.6, 0.74, HEAD_R + 0.1, spin=0.3)
    return mesh_object("Bow", bm, mat, parent=head)


def build_character(spec):
    c = spec["colors"]
    mats = {
        "skin": material("Skin", c["skin"], 0.6),
        "hair": material("Hair", c["hair"], 0.45),
        "outfit": material("Outfit", c["outfit"], 0.6),
        "accent": material("Accent", c["accent"], 0.5),
        "eye": material("Eye", "#1b1420", 0.15),
        "shine": material("Shine", "#ffffff", 0.2),
        "mouth": material("Mouth", "#7a2e2e", 0.5),
        "blush": material("Blush", "#ff9aa2", 0.7),
    }

    root = empty("Root")
    torso = sphere(1, (0.5, 0.42, 0.55), offset=(0, 0, 0.58))
    if spec["gender"] == "girl":  # a dress: the lower half flares out a little
        for v in torso.verts:
            low = max(0.0, (0.62 - v.co.z) / 0.55)
            v.co.x *= 1 + 0.3 * low
            v.co.y *= 1 + 0.15 * low
    body = mesh_object("Body", torso, mats["outfit"], parent=root)
    add_modifiers(body, subsurf=1)
    feet = bmesh.new()
    for side in (-1, 1):
        part = sphere(1, (0.17, 0.2, 0.1), offset=(0.2 * side, -0.05, 0.08), segments=20, rings=10)
        tmp = bpy.data.meshes.new("tmp")
        part.to_mesh(tmp)
        part.free()
        feet.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    mesh_object("Feet", feet, mats["accent"], parent=root)

    for name, side in (("ArmL", 1), ("ArmR", -1)):
        bm = sphere(1, (0.12, 0.12, 0.27), offset=(0, 0, -0.22), segments=20, rings=10)
        arm = mesh_object(name, bm, mats["skin"], parent=root, location=(0.46 * side, 0, 0.92))
        arm.rotation_euler = (0, -0.3 * side, 0)

    head = empty("Head", parent=root, location=HEAD_PIVOT)
    skin = sphere(HEAD_R, offset=HEAD_CENTER, segments=40, rings=20)
    for side in (-1, 1):  # small ears
        merge(skin, place(sphere(1, (0.075, 0.06, 0.1), segments=16, rings=8), 1.5 * side, -0.05, HEAD_R - 0.01))
    mesh_object("HeadSkin", skin, mats["skin"], parent=head)
    blush = bmesh.new()
    for side in (-1, 1):
        at = on_head(0.36 * side, -0.1, inset=0.02)
        part = sphere(1, (0.09, 0.02, 0.05), segments=16, rings=8)
        bmesh.ops.rotate(part, cent=(0, 0, 0), matrix=Matrix.Rotation(facing(at), 3, "Z"), verts=part.verts)
        bmesh.ops.translate(part, vec=at, verts=part.verts)
        tmp = bpy.data.meshes.new("tmp")
        part.to_mesh(tmp)
        part.free()
        blush.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)
    mesh_object("Blush", blush, mats["blush"], parent=head)
    build_face(head, mats, lashes=spec["gender"] == "girl")
    build_hair(spec["hair"], head, mats["hair"])
    if spec["gender"] == "girl":
        build_bow(head, mats["accent"])
    return root


# ------------------------------------------------------- scene and output

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def pick_engine(scene):
    engines = [i.identifier for i in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    for name in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        if name in engines:
            try:
                scene.render.engine = name
                return name
            except TypeError:
                continue
    return scene.render.engine


def render_preview(path):
    scene = bpy.context.scene
    pick_engine(scene)
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    try:
        scene.view_settings.view_transform = "Standard"  # plain sRGB, as three.js shows it in the app
    except TypeError:
        pass

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 90
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (0.0, -7.2, 1.12)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam

    world = bpy.data.worlds.new("PreviewSky")
    world.use_nodes = True
    sky = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    sky.inputs["Color"].default_value = (0.85, 0.88, 1.0, 1.0)
    sky.inputs["Strength"].default_value = 0.5
    scene.world = world

    for name, loc, energy in (("Key", (2.5, -4, 4), 300), ("Fill", (-3, -3, 2), 150), ("Rim", (0, 3, 3), 300)):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.size = 3
        light = bpy.data.objects.new(name, light_data)
        light.location = loc
        light.rotation_euler = (Vector((0, 0, 1.2)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        bpy.context.collection.objects.link(light)

    bpy.ops.render.render(write_still=True)
    for obj in (cam, *[o for o in scene.objects if o.type == "LIGHT"]):
        bpy.data.objects.remove(obj)


def export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,
        export_morph=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1] if "--out" in argv else "assets/buddies"
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    out = os.path.abspath(out)
    os.makedirs(os.path.join(out, "previews"), exist_ok=True)

    for spec in CHARACTERS:
        if only and spec["id"] != only:
            continue
        reset_scene()
        build_character(spec)
        export_glb(os.path.join(out, f"{spec['id']}.glb"))
        render_preview(os.path.join(out, "previews", f"{spec['id']}.png"))
        print(f"[buddies] built {spec['id']}")

    manifest = [{
        "id": s["id"], "gender": s["gender"], "defaultName": s["defaultName"],
        "file": f"{s['id']}.glb", "preview": f"previews/{s['id']}.png", "accent": s["colors"]["outfit"],
    } for s in CHARACTERS]
    with open(os.path.join(out, "buddies.json"), "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")


main()
