"""Render the robot for Buddy's app icon: boy-1 alone, 1024 px, on a transparent background.

Run from the repo root (npm run build:icon does this, then build/MakeIcon.swift sets the
render on the icon's plate):

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python art/render_icon.py -- --out art/out/robot.png

The robot is built by art/build_buddies.py, the same builders as the app's character, so the
icon cannot drift from it. The lights are the previews' lights, a little stronger.
"""

import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_buddies as buddies  # importing only defines the builders; main() runs under __main__

CHARACTER = "boy-1"
SIZE = 1024
FILL = 0.94                  # the robot's longer side takes this much of the frame
TURN = math.radians(15)      # the camera's turn to the robot's right, as in the previews


def render_robot(path):
    spec = next(s for s in buddies.CHARACTERS if s["id"] == CHARACTER)
    buddies.reset_scene()
    buddies.build_character(spec)

    scene = bpy.context.scene
    buddies.pick_engine(scene)
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = path
    try:
        scene.eevee.taa_render_samples = 128  # smooth edges against the plate
    except AttributeError:
        pass
    for view in ("Khronos PBR Neutral", "Standard"):  # Neutral is the curve the app tone-maps with
        try:
            scene.view_settings.view_transform = view
            break
        except TypeError:
            continue

    # Frame the robot, perspective as in the app and the previews.
    low, high = buddies.bounds()
    centre, size = (low + high) / 2, high - low
    cam_data = bpy.data.cameras.new("IconCam")
    cam_data.lens = 90
    half_fov = math.atan(cam_data.sensor_width / 2 / cam_data.lens)
    distance = max(size.x, size.z) / FILL / 2 / math.tan(half_fov) + size.y / 2
    cam = bpy.data.objects.new("IconCam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = centre + Matrix.Rotation(TURN, 3, "Z") @ Vector((0, -distance, 0))
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    world = bpy.data.worlds.new("IconStudio")
    world.use_nodes = True
    sky = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    sky.inputs["Color"].default_value = (0.95, 0.9, 0.84, 1.0)
    sky.inputs["Strength"].default_value = 0.35
    scene.world = world

    # Warm, soft studio light: key, fill, rim, and the long strip above the camera that the
    # face screen reflects across its top.
    for name, offset, energy, extent, color in (
            ("Key", (2.4, -4.0, 3.0), 280, (1.6, 1.6), (1.0, 0.93, 0.85)),
            ("Fill", (-3.4, -3.0, 1.0), 130, (4.0, 4.0), (1.0, 0.96, 0.92)),
            ("Rim", (-1.5, 3.5, 3.2), 240, (3.0, 3.0), (1.0, 0.92, 0.82)),
            ("Top", (0.0, -4.4, 3.4), 170, (6.0, 0.7), (1.0, 0.97, 0.93))):
        light_data = bpy.data.lights.new(name, "AREA")
        light_data.energy = energy
        light_data.shape = "RECTANGLE"
        light_data.size, light_data.size_y = extent
        light_data.color = color
        light = bpy.data.objects.new(name, light_data)
        light.location = centre + Vector(offset)
        light.rotation_euler = (-Vector(offset)).to_track_quat("-Z", "Y").to_euler()
        bpy.context.collection.objects.link(light)

    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1] if "--out" in argv else "art/out/robot.png"
    out = os.path.abspath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    render_robot(out)
    print(f"[icon] rendered {CHARACTER} to {out}")


if __name__ == "__main__":
    main()
