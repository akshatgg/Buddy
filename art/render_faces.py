"""Render each buddy's head with every eye shape, side by side, to judge the shapes.

Run from the repo root:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python art/render_faces.py -- --out art/out [--only boy-1]

For every character this writes <out>/faces-<id>.png: its head from the front, first with
the eyes open, then with each key in FACES, left to right, each named under it. The robot
is built by art/build_buddies.py, so the pictures show exactly the shapes the app gets, and
rendered with the previews' settings, camera and lights, so the two cannot drift apart.
"""

import math
import os
import sys
import tempfile

import bpy
import numpy as np  # Blender comes with numpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_buddies as buddies  # importing only defines the builders; main() runs under __main__

FACES = ("open", "blink", "smile", "heart", "swirl", "sad", "half", "sleep")  # "open" is the rest pose
TILE = 640                # each face is a square picture this many pixels wide
PAPER = "#fff5e9"         # the background: the website's cream
INK = "#2a1e17"           # the names under the faces: the website's ink
HIDDEN = ("Body", "Feet", "ArmL", "ArmR")  # only the head is shown


def head_box():
    """The world-space box around the head's meshes, as (low corner, high corner)."""
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(c) for obj in bpy.context.scene.objects
               if obj.type == "MESH" and obj.parent and obj.parent.name == "Head" for c in obj.bound_box]
    return (Vector([min(p[i] for p in corners) for i in range(3)]),
            Vector([max(p[i] for p in corners) for i in range(3)]))


def set_up(scene):
    """Set the scene up to render the head alone, TILE pixels square, and return the name label's text.

    It hides Body, Feet and the arms; gives the scene the previews' render settings, camera and lights
    (build_buddies.stage), with the camera straight in front of the head; and puts a name label under it.
    """
    for name in HIDDEN:
        scene.objects[name].hide_render = True

    # Straight in front of the head, with room under it for the name.
    low, high = head_box()
    room = 0.32
    centre = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, (low.z - room + high.z) / 2))
    buddies.stage(TILE, centre, max(high.x - low.x, high.z - low.z + room) * 1.08, high.y - low.y)

    text = bpy.data.curves.new("Name", "FONT")
    text.align_x = "CENTER"
    text.size = 0.15
    text.materials.append(buddies.material("Ink", INK, 0.9, glow=1.0))
    label = bpy.data.objects.new("Name", text)
    label.location = (centre.x, low.y, low.z - room * 0.7)
    label.rotation_euler = (math.pi / 2, 0, 0)  # standing up, facing the camera
    bpy.context.collection.objects.link(label)
    return text


def render_faces(spec, out_path):
    buddies.reset_scene()
    buddies.build_character(spec)
    scene = bpy.context.scene
    text = set_up(scene)
    keys = scene.objects["Face"].data.shape_keys.key_blocks

    with tempfile.TemporaryDirectory() as tmp:
        paths = []
        for i, name in enumerate(FACES):
            for key in list(keys)[1:]:  # all but the Basis
                key.value = 1.0 if key.name == name else 0.0
            text.body = name
            scene.render.filepath = os.path.join(tmp, f"{i}.png")
            bpy.ops.render.render(write_still=True)
            paths.append(scene.render.filepath)
        save_row(paths, out_path)


def save_row(paths, out_path):
    """Put the pictures at `paths` side by side on PAPER and save them as one PNG."""
    paper = np.array([int(PAPER[i:i + 2], 16) / 255 for i in (1, 3, 5)], dtype=np.float32)
    row = np.empty((TILE, TILE * len(paths), 4), dtype=np.float32)
    for i, path in enumerate(paths):
        image = bpy.data.images.load(path)
        pixels = np.empty(TILE * TILE * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)  # an 8-bit PNG gives its sRGB values, straight alpha
        pixels = pixels.reshape(TILE, TILE, 4)
        alpha = pixels[:, :, 3:]
        row[:, i * TILE:(i + 1) * TILE, :3] = pixels[:, :, :3] * alpha + paper * (1 - alpha)
        bpy.data.images.remove(image)
    row[:, :, 3] = 1.0
    out = bpy.data.images.new("Faces", TILE * len(paths), TILE, alpha=False)
    out.pixels.foreach_set(row.ravel())
    out.filepath_raw = out_path
    out.file_format = "PNG"
    out.save()


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1] if "--out" in argv else "art/out"
    only = argv[argv.index("--only") + 1] if "--only" in argv else None
    out = os.path.abspath(out)
    os.makedirs(out, exist_ok=True)
    for spec in buddies.CHARACTERS:
        if only and spec["id"] != only:
            continue
        path = os.path.join(out, f"faces-{spec['id']}.png")
        render_faces(spec, path)
        print(f"[faces] rendered {spec['id']} to {path}")


if __name__ == "__main__":
    main()
