"""Build Buddy's characters in Blender and export them for the app.

Run from the repo root:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python art/build_buddies.py -- --out assets/buddies [--only boy-1]

For every entry in CHARACTERS this writes <out>/<id>.glb, a preview render
<out>/previews/<id>.png, and finally <out>/buddies.json for the app.

Every character is the same small robot, made like a glossy vinyl toy: a big
cream head with a dark face screen and glowing eyes, a headphone cup for each
ear and a piece on top, over a small body with stubby arms. A variant (one row
of CHARACTERS) picks the glow colour, the top piece and the colour of the feet.

Every .glb follows the contract in docs/superpowers/specs (section 3):
nodes Root, Head, ArmL, ArmR, and a mesh Face with morph targets blink,
smile and mouthO, in that order. The app animates those by name, so keep them.
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

# One row per character. "top" names the piece on its head (see TOP_PIECES).
# The colours are sRGB: glow lights the eyes, the mouth and the chest, core is
# the bright centre of the eyes, rim the ear rims, top and topGlow the top
# piece and the glow at its base.
CHARACTERS = [
    {"id": "boy-1", "gender": "boy", "defaultName": "Aarav", "top": "sprout",
     "colors": {"glow": "#ffb54c", "core": "#ffd9a0", "rim": "#ffb869",
                "top": "#f7ddbf", "topGlow": "#ffac4d", "feet": "#7a665a"}},
    {"id": "girl-1", "gender": "girl", "defaultName": "Anaya", "top": "bow",
     "colors": {"glow": "#ff8fb1", "core": "#ffd3e0", "rim": "#ff8fb1",
                "top": "#f8cdd5", "topGlow": "#ff8fb1", "feet": "#9b6b7a"}},
]

SHELL = "#f3e8da"   # the glossy cream plastic of the head, body and arms
SCREEN = "#1c1512"  # the face screen's dark glass
SEAM = "#dccdbb"    # the faint seam down the front of the body
GLOW = 1.3          # emission strength of the glowing parts; after the app's tone mapping they show their own colour

# The robot faces -Y and stands on z = 0, about 1.8 tall (2.1 with its top piece).
HEAD_PIVOT = Vector((0, 0, 0.74))  # neck: Head turns and tilts around here
HEAD_CENTER = Vector((0, 0, 0.5))  # shell centre, relative to the pivot
HEAD_SIZE = (0.66, 0.5, 0.53)      # shell half-width, half-depth and half-height: 1.25 wide to 1 tall
HEAD_ROUND = 2.35                  # 2 would be an ellipsoid; higher is boxier, a soft bean

SCREEN_DZ = -0.04                  # the screen's centre, below HEAD_CENTER
SCREEN_SIZE = (0.46, 0.29)         # its half-width and half-height: 70 % and 55 % of the head
SCREEN_ROUND = 4.0                 # its outline is a squircle with this exponent
SCREEN_LIFT = 0.004                # the glass sits just over the shell, inside the lip
LIP_R = 0.02                       # the raised cream lip around the screen
FACE_LIFT = 0.01                   # the glowing face sits just over the glass

EAR_DZ = -0.03                     # the ear cups' centre height
EAR_R = 0.18                       # ear cup radius

EYE_X, EYE_DZ = 0.185, 0.03        # eye centres: either side of the middle, and their height
EYE_W, EYE_TALL = 0.06, 1.45       # open eye: half-width, and how many times as tall it is
ARC_R, ARC_W, ARC_DIP = 0.056, 0.034, 0.3  # smile: arc radius, half-thickness, how far its ends dip (radians)
BLINK_L, BLINK_W, BLINK_DZ = 0.07, 0.015, -0.02  # blink: the line's half-length, half-thickness and height
MOUTH_DZ, MOUTH_R = -0.135, (0.018, 0.036)  # mouthO: the "o"'s height, inner and outer radius

BODY_Z, BODY_SIZE = 0.45, (0.36, 0.3, 0.37)  # body centre height and half-sizes: 55 % of the head's width
BODY_ROUND = 2.4
BODY_FLARE = 0.05                  # the body is this much wider at the bottom, a bean
SHOULDER = Vector((0.35, -0.06, 0.54))  # ArmL's pivot; ArmR is its mirror
ARM_REST = 0.18                    # the arms hang this far out from straight down (radians)
FOOT_X, FOOT_SIZE = 0.165, (0.13, 0.17, 0.085)


# --------------------------------------------------------------- helpers

def srgb_to_linear(hex_color):
    hex_color = hex_color.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(hex_color[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


def mix(hex_a, hex_b, f):
    """The sRGB colour f of the way from hex_a to hex_b."""
    a, b = (tuple(int(h.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)) for h in (hex_a, hex_b))
    return "#" + "".join(f"{round(x + (y - x) * f):02x}" for x, y in zip(a, b))


def material(name, hex_color, roughness=0.35, glow=0.0, tint=None):
    """A Principled BSDF in `hex_color`.

    With `glow` the colour is emitted at that strength (the glTF exporter writes it as
    emissive, with KHR_materials_emissive_strength above 1) and the base is darkened, so
    light falling on the part does not wash its colour out. With `tint` as well, the part
    keeps its own colour and only gives off a little of the tint, a faint warm glow.
    """
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    color = srgb_to_linear(hex_color)
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    if glow:
        if tint is None:
            bsdf.inputs["Base Color"].default_value = (*(c * 0.15 for c in color[:3]), 1.0)
        bsdf.inputs["Emission Color"].default_value = srgb_to_linear(tint) if tint else color
        bsdf.inputs["Emission Strength"].default_value = glow
    mat.use_backface_culling = False
    return mat


def spow(v, p):
    """A power that keeps the sign: spow(-8, 1 / 3) is -2."""
    return math.copysign(abs(v) ** p, v)


def sphere(segments=32, rings=16):
    """A unit UV sphere, poles on Z, as (verts, faces) with the faces turned outward."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    bm.verts.index_update()
    verts = [v.co.copy() for v in bm.verts]
    faces = [[v.index for v in f.verts] for f in bm.faces]
    bm.free()
    return verts, faces


def blob(size, n=2.0, offset=(0, 0, 0), segments=32, rings=16):
    """A superellipsoid with half-sizes `size`: n = 2 is an ellipsoid, higher is boxier."""
    verts, faces = sphere(segments, rings)
    e = 2.0 / n
    shift = Vector(offset)
    return [Vector((size[0] * spow(v.x, e), size[1] * spow(v.y, e), size[2] * spow(v.z, e))) + shift
            for v in verts], faces


def lathe(profile, segments=48, closed=False):
    """A surface of revolution around +Z from (radius, z) pairs, faces turned outward.

    A radius of 0 is a single point, which closes that end; `closed` joins the last
    pair back to the first, for a ring.
    """
    verts, rows = [], []
    for r, z in profile:
        if r == 0:
            rows.append([len(verts)] * segments)
            verts.append(Vector((0, 0, z)))
        else:
            rows.append(list(range(len(verts), len(verts) + segments)))
            verts += [Vector((r * math.cos(a), r * math.sin(a), z))
                      for a in (2 * math.pi * k / segments for k in range(segments))]
    faces = []
    for lo, hi in list(zip(rows, rows[1:])) + ([(rows[-1], rows[0])] if closed else []):
        for k in range(segments):
            k1 = (k + 1) % segments
            face = list(dict.fromkeys((lo[k], lo[k1], hi[k1], hi[k])))  # next to a point, a triangle
            if len(face) >= 3:
                faces.append(face)
    return verts, faces


def moved(piece, matrix=None, offset=(0, 0, 0)):
    """A (verts, faces) piece turned by the 3x3 `matrix` (a rotation), then moved by `offset`."""
    verts, faces = piece
    shift = Vector(offset)
    return [(matrix @ v if matrix else v.copy()) + shift for v in verts], faces


class Parts:
    """Pieces gathered into one mesh, each face with a material slot (one draw call per slot)."""

    def __init__(self):
        self.verts, self.faces, self.slots = [], [], []

    def add(self, piece, slot=0):
        """Add a (verts, faces) piece; `slot` is a material slot, or a list of one per face."""
        verts, faces = piece
        start = len(self.verts)
        self.verts += verts
        self.faces += [[start + i for i in f] for f in faces]
        self.slots += slot if isinstance(slot, list) else [slot] * len(faces)


def mesh_object(name, parts, mats, parent=None, location=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in parts.verts], [], parts.faces)
    for mat in mats:
        me.materials.append(mat)
    for poly, slot in zip(me.polygons, parts.slots):
        poly.material_index = slot
        poly.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    return obj


def empty(name, parent=None, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    return obj


def head_front(x, dz, lift=0.0):
    """The point `lift` out from the front of the shell, x across and dz up from its
    centre (head space), and the shell's outward normal there."""
    a, b, c = HEAD_SIZE
    n = HEAD_ROUND
    y = -b * max(1 - abs(x / a) ** n - abs(dz / c) ** n, 0.0) ** (1 / n)
    normal = Vector((spow(x / a, n - 1) / a, spow(y / b, n - 1) / b, spow(dz / c, n - 1) / c)).normalized()
    return Vector((x, y, HEAD_CENTER.z + dz)) + normal * lift, normal


def crown(x):
    """The height of the top of the shell, x across (head space)."""
    a, _, c = HEAD_SIZE
    return HEAD_CENTER.z + c * (1 - abs(x / a) ** HEAD_ROUND) ** (1 / HEAD_ROUND)


def body_flare(z):
    return 1 + BODY_FLARE * (BODY_Z - z) / BODY_SIZE[2]


def body_front(x, z, lift=0.0):
    """Like head_front, on the front of the body; x and z are in Root space."""
    k = body_flare(z)
    a, b, c = BODY_SIZE[0] * k, BODY_SIZE[1] * k, BODY_SIZE[2]
    n = BODY_ROUND
    dz = z - BODY_Z
    y = -b * max(1 - abs(x / a) ** n - abs(dz / c) ** n, 0.0) ** (1 / n)
    normal = Vector((spow(x / a, n - 1) / a, spow(y / b, n - 1) / b, spow(dz / c, n - 1) / c)).normalized()
    return Vector((x, y, z)) + normal * lift, normal


def resample(points, count):
    """`count` points evenly spaced along the closed outline through the 2D `points`."""
    ring = points + points[:1]
    lengths = [0.0]
    for p, q in zip(ring, ring[1:]):
        lengths.append(lengths[-1] + (q - p).length)
    out, i = [], 0
    for k in range(count):
        target = lengths[-1] * k / count
        while lengths[i + 1] < target:
            i += 1
        out.append(ring[i].lerp(ring[i + 1], (target - lengths[i]) / (lengths[i + 1] - lengths[i])))
    return out


def squircle(w, h, power, count):
    """`count` points evenly spaced around a squircle of half-sizes w and h, counter-clockwise from +x."""
    dense = [Vector((w * spow(math.cos(t), 2 / power), h * spow(math.sin(t), 2 / power)))
             for t in (2 * math.pi * k / 2048 for k in range(2048))]
    return resample(dense, count)


def tube(points, normals, radius, sides=10):
    """A round tube along a closed path of points, its rings square to the path and to `normals`."""
    count = len(points)
    verts = []
    for i, (p, n) in enumerate(zip(points, normals)):
        t = points[(i + 1) % count] - points[i - 1]
        t = (t - n * t.dot(n)).normalized()
        side = t.cross(n)
        verts += [p + (side * math.cos(a) + n * math.sin(a)) * radius
                  for a in (2 * math.pi * k / sides for k in range(sides))]
    faces = []
    for i in range(count):
        i1 = (i + 1) % count
        for k in range(sides):
            k1 = (k + 1) % sides
            faces.append([i * sides + k, i1 * sides + k, i1 * sides + k1, i * sides + k1])
    return verts, faces


def fan(outline, place, rings=1):
    """A patch filling a closed, counter-clockwise 2D outline around (0, 0), each point set in
    3D by place(x, y), faces toward the viewer. More `rings` make it finer, for a curved surface."""
    m = len(outline)
    verts = [place(0.0, 0.0)]
    for k in range(1, rings + 1):
        f = k / rings
        verts += [place(p.x * f, p.y * f) for p in outline]
    faces = [[0, 1 + j, 1 + (j + 1) % m] for j in range(m)]
    for k in range(rings - 1):
        lo, hi = 1 + k * m, 1 + (k + 1) * m
        faces += [[lo + j, hi + j, hi + (j + 1) % m, lo + (j + 1) % m] for j in range(m)]
    return verts, faces


# ----------------------------------------------------------------- parts

# An eye is drawn as a stroke: a centre line, s from 0 at its left end to 1 at its
# right end, traced with a round pen. Every shape key moves the same vertices: rings
# out from the centre line (EYE_RINGS, as fractions of the pen's half-width; the
# inner bands are the eye's bright core), each ring a loop around the stroke.
EYE_RINGS = (0.0, 0.22, 0.45, 0.73, 1.0)
EYE_CORE = 2         # the bands inside this ring are the bright core
EYE_ALONG, EYE_CAP = 16, 8  # steps along each side of the stroke, and around each round end


def eye_loop():
    """(s, psi) of each vertex around a ring, counter-clockwise from the right end of the top side.

    psi says which way from the centre line: 0 is the top side, pi the bottom side,
    and the round ends sweep from one to the other.
    """
    loop = [(1 - i / EYE_ALONG, 0.0) for i in range(EYE_ALONG + 1)]
    loop += [(0.0, -math.pi * k / EYE_CAP) for k in range(1, EYE_CAP)]
    loop += [(i / EYE_ALONG, math.pi) for i in range(EYE_ALONG + 1)]
    loop += [(1.0, math.pi * (1 - k / EYE_CAP)) for k in range(1, EYE_CAP)]
    return loop


def oval_angles():
    """Where each vertex of eye_loop() sits around the open eye's oval, counter-clockwise from +x."""
    a = math.pi / 6  # each round end takes this much either side of across
    top = [a + (math.pi - 2 * a) * i / EYE_ALONG for i in range(EYE_ALONG + 1)]
    left = [math.pi - a + 2 * a * k / EYE_CAP for k in range(1, EYE_CAP)]
    bottom = [math.pi + a + (math.pi - 2 * a) * i / EYE_ALONG for i in range(EYE_ALONG + 1)]
    right = [2 * math.pi - a + 2 * a * k / EYE_CAP for k in range(1, EYE_CAP)]
    return top + left + bottom + right


def stroke(line, normal, width):
    """The points of a stroke along line(s), whose unit normal is normal(s), ring by ring."""
    points = []
    for tau in EYE_RINGS:
        for s, psi in eye_loop():
            n = normal(s)
            t = Vector((n.y, -n.x))  # along the line, toward s = 1
            points.append(line(s) + (n * math.cos(psi) + t * math.sin(psi)) * (tau * width))
    return points


def eye_shapes():
    """One eye in 2D (x across, y up, from the eye's centre): its points open, blinking and smiling."""
    tall = EYE_W * EYE_TALL
    open_eye = [Vector((EYE_W * math.cos(a), tall * math.sin(a))) * tau
                for tau in EYE_RINGS for a in oval_angles()]
    blink = stroke(lambda s: Vector((BLINK_L * (2 * s - 1), BLINK_DZ)), lambda s: Vector((0.0, 1.0)), BLINK_W)
    # The smile is the reference's happy eye: a thick arc over the top whose round ends
    # dip a little, like "^ ^". It keeps the open eye's top edge and pulls the rest up under it.
    centre = Vector((0.0, tall - ARC_R - ARC_W))

    def angle(s):
        return math.pi + ARC_DIP - s * (math.pi + 2 * ARC_DIP)

    smile = stroke(lambda s: centre + Vector((math.cos(angle(s)), math.sin(angle(s)))) * ARC_R,
                   lambda s: Vector((math.cos(angle(s)), math.sin(angle(s)))), ARC_W)
    return open_eye, blink, smile


KEYS = ("blink", "smile", "mouthO")  # the Face's morph targets, in the contract's order


def build_face(head, mats):
    """The glowing eyes and the hidden mouth in one mesh, with the morph targets in KEYS.

    Everything is drawn in 2D on the screen and laid onto the curve of the glass, so
    every key stays on it.
    """
    m = len(eye_loop())
    rings = len(EYE_RINGS)
    shapes = {key: [] for key in ("basis", *KEYS)}
    faces, slots = [], []

    def on_glass(x, y):
        return head_front(x, y, FACE_LIFT)[0]

    open_eye, blink, smile = eye_shapes()
    for side in (-1, 1):
        start = len(shapes["basis"])
        for key, points in (("basis", open_eye), ("blink", blink), ("smile", smile), ("mouthO", open_eye)):
            shapes[key] += [on_glass(side * EYE_X + p.x, EYE_DZ + p.y) for p in points]
        for r in range(rings - 1):
            for j in range(m):
                j1 = (j + 1) % m
                faces.append([start + r * m + j, start + (r + 1) * m + j, start + (r + 1) * m + j1, start + r * m + j1])
                slots.append(1 if r < EYE_CORE else 0)

    # The mouth: a small "o" that mouthO opens; at rest all of it sits on one point.
    steps = 32
    start = len(shapes["basis"])
    shut = on_glass(0.0, MOUTH_DZ)
    for radius in MOUTH_R:
        for key in shapes:
            if key != "mouthO":
                shapes[key] += [shut.copy() for _ in range(steps)]
        shapes["mouthO"] += [on_glass(radius * math.cos(a), MOUTH_DZ + radius * math.sin(a))
                             for a in (2 * math.pi * k / steps for k in range(steps))]
    for j in range(steps):
        j1 = (j + 1) % steps
        faces.append([start + j, start + steps + j, start + steps + j1, start + j1])
        slots.append(0)

    parts = Parts()
    parts.add((shapes["basis"], faces), slots)
    face = mesh_object("Face", parts, [mats["glow"], mats["core"]], parent=head)
    face.shape_key_add(name="Basis", from_mix=False)
    for name in KEYS:
        key = face.shape_key_add(name=name, from_mix=False)
        for point, co in zip(key.data, shapes[name]):
            point.co = co
        # Blender 5 starts new keys at 1.0, and the glTF exporter writes these as
        # the mesh's default weights, so every key must start at rest.
        key.value = 0.0
    return face


def build_screen(head, mat):
    """The face screen: dark glass following the curve of the shell (its lip is part of the shell)."""
    outline = squircle(*SCREEN_SIZE, SCREEN_ROUND, 96)
    glass = fan(outline, lambda x, y: head_front(x, SCREEN_DZ + y, SCREEN_LIFT)[0], rings=10)
    parts = Parts()
    parts.add(glass)
    return mesh_object("Screen", parts, [mat], parent=head)


def ear_x():
    """How far out the side of the shell is at the ears' height."""
    a, _, c = HEAD_SIZE
    return a * (1 - abs(EAR_DZ / c) ** HEAD_ROUND) ** (1 / HEAD_ROUND)


def build_head(root, spec, mats):
    head = empty("Head", parent=root, location=HEAD_PIVOT)

    shell, rims = Parts(), Parts()
    shell.add(blob(HEAD_SIZE, HEAD_ROUND, HEAD_CENTER, segments=64, rings=32))
    on_shell = [head_front(p.x, SCREEN_DZ + p.y) for p in squircle(*SCREEN_SIZE, SCREEN_ROUND, 120)]
    shell.add(tube([p for p, _ in on_shell], [n for _, n in on_shell], LIP_R))
    # Headphone-cup ears: a short cream cylinder, its outer rim a glowing ring.
    r = EAR_R
    cup = lathe([(r, -0.12), (r, 0.03), (r - 0.004, 0.052), (r - 0.022, 0.07), (r * 0.6, 0.079), (0, 0.083)])
    rim = lathe([(r - 0.012 + 0.024 * math.cos(t), 0.055 + 0.024 * math.sin(t))
                 for t in (2 * math.pi * k / 12 for k in range(12))], closed=True)
    for side in (-1, 1):
        turn = Matrix.Rotation(side * math.pi / 2, 3, "Y")  # +Z out of the side of the head
        at = (side * ear_x(), 0, HEAD_CENTER.z + EAR_DZ)
        shell.add(moved(cup, turn, at))
        rims.add(moved(rim, turn, at))
    mesh_object("Shell", shell, [mats["shell"]], parent=head)
    mesh_object("EarRims", rims, [mats["rim"]], parent=head)
    build_screen(head, mats["screen"])
    build_face(head, mats)
    TOP_PIECES[spec["top"]](head, mats)
    return head


def leaf(length, width, thick, bend):
    """A petal growing up +Z from the origin, its flat side to the front (-Y).

    Returns (verts, faces) and, for each face, how much it glows: 2 at the base, 1 just
    above it and along the rim on the way up, 0 for the rest. `bend` curls it sideways
    (+X) toward the tip.
    """
    verts, faces = sphere(28, 16)
    out, base, rim = [], [], []
    for v in verts:
        u = (v.z + 1) / 2  # 0 at the base, 1 at the tip
        ring = math.sqrt(max(1 - v.z * v.z, 0.0))
        cx, cy = (v.x / ring, v.y / ring) if ring > 1e-6 else (0.0, 0.0)
        shape = u ** 0.55 * (1 - u) ** 0.85 / 0.391  # 1 at its widest, 40 % of the way up; a soft point
        x = cx * width / 2 * shape + bend * length * u * u
        y = cy * thick / 2 * (0.35 + 0.65 * shape) + 0.3 * width * (cx * shape) ** 2  # its edges curl back
        out.append(Vector((x, y, u * length)))
        base.append(u)
        rim.append(abs(cx))
    glow = []
    for f in faces:
        u = sum(base[i] for i in f) / len(f)
        edge = sum(rim[i] for i in f) / len(f)
        glow.append(2 if u < 0.17 else 1 if u < 0.33 or (edge > 0.9 and u < 0.5) else 0)
    return out, faces, glow


def build_sprout(head, mats):
    """Two petals growing from one point on top of the head, a little off centre:
    the bigger one leans left, the smaller one right."""
    root = Vector((0.07, 0.0, crown(0.07) - 0.03))
    base = root + Vector((0.0, 0.0, 0.07))  # a short stem, then the two petals
    parts = Parts()
    for length, width, lean, twist in ((0.38, 0.18, -0.95, 0.2), (0.28, 0.14, 1.05, -0.25)):
        verts, faces, glow = leaf(length, width, 0.035, bend=0.14 if lean > 0 else -0.14)
        turn = Matrix.Rotation(twist, 3, "Z") @ Matrix.Rotation(lean, 3, "Y")
        parts.add(moved((verts, faces), turn, base), glow)
    stem = lathe([(0.026, 0.0), (0.022, 0.05), (0.024, 0.075), (0.0, 0.085)], 16)
    parts.add(moved(stem, offset=root), 2)
    return mesh_object("Sprout", parts, [mats["top"], mats["topMid"], mats["topGlow"]], parent=head)


def build_bow(head, mats):
    """A small bow on top of the head, a little off centre: two rounded loops, lifted
    into a V, and a glowing knot. It leans forward so it faces the front."""
    parts = Parts()
    for side in (-1, 1):
        verts, faces = sphere(28, 14)
        loop = []
        for v in verts:
            x = 0.13 * side + 0.135 * v.x
            pinch = 0.35 + 0.65 * min(abs(x) / 0.25, 1.0) ** 0.7  # each loop narrows into the knot
            loop.append(Vector((x, 0.05 * v.y, 0.1 * v.z * pinch)))
        parts.add(moved((loop, faces), Matrix.Rotation(-0.25 * side, 3, "Y")), 0)
    parts.add(blob((0.05, 0.048, 0.055), 2.2, segments=16, rings=8), 1)
    turn = Matrix.Rotation(0.22, 3, "Y") @ Matrix.Rotation(-0.35, 3, "X")
    at = Vector((0.17, -0.06, crown(0.17) + 0.03))
    parts.verts = [turn @ v + at for v in parts.verts]
    return mesh_object("Bow", parts, [mats["top"], mats["topGlow"]], parent=head)


TOP_PIECES = {"sprout": build_sprout, "bow": build_bow}


def rounded_triangle(w, h, r, count=48):
    """A triangle pointing down with round corners: its corners' centres are w wide and
    h tall, and r is the corner radius. Counter-clockwise from the bottom corner."""
    corners = [Vector((0.0, -h * 2 / 3)), Vector((w / 2, h / 3)), Vector((-w / 2, h / 3))]
    points = []
    for i, c in enumerate(corners):
        before, after = corners[i - 1], corners[(i + 1) % 3]
        a0 = math.atan2(-(c - before).x, (c - before).y)  # outward normals of the two sides
        a1 = math.atan2(-(after - c).x, (after - c).y)
        while a1 < a0:
            a1 += 2 * math.pi
        points += [c + Vector((math.cos(a), math.sin(a))) * r
                   for a in (a0 + (a1 - a0) * k / 8 for k in range(9))]
    return resample(points, count)


def build_body(root, mats):
    parts = Parts()
    verts, faces = blob(BODY_SIZE, BODY_ROUND, (0, 0, BODY_Z), segments=48, rings=24)
    for v in verts:
        k = body_flare(v.z)
        v.x *= k
        v.y *= k
    parts.add((verts, faces), 0)

    # A faint seam down the front.
    seam, steps = [], 28
    for i in range(steps + 1):
        z = 0.15 + (BODY_Z + BODY_SIZE[2] - 0.05 - 0.15) * i / steps
        seam += [body_front(-0.006, z, 0.0015)[0], body_front(0.006, z, 0.0015)[0]]
    parts.add((seam, [[2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2] for i in range(steps)]), 1)

    # The glowing triangle on the chest, a thin rounded tile pointing down.
    outline = rounded_triangle(0.075, 0.062, 0.02)
    chest_z = 0.49
    top = fan(outline, lambda x, y: body_front(x, chest_z + y, 0.008)[0])
    side = [body_front(p.x, chest_z + p.y, 0.008)[0] for p in outline] + \
           [body_front(p.x, chest_z + p.y, -0.004)[0] for p in outline]
    m = len(outline)
    parts.add(top, 2)
    parts.add((side, [[j, m + j, m + (j + 1) % m, (j + 1) % m] for j in range(m)]), 2)
    return mesh_object("Body", parts, [mats["shell"], mats["seam"], mats["chest"]], parent=root)


def arm():
    """A stubby arm hanging down -Z from the shoulder (the origin), ending in a round
    mitten held a little forward."""
    verts, faces = sphere(24, 16)
    out = []
    for v in verts:
        if v.z >= 0:  # the shoulder end
            out.append(v * 0.07)
        else:  # the mitten, a little flatter front to back
            out.append(Vector((v.x * 0.084, v.y * 0.073 - 0.05, v.z * 0.084 - 0.2)))
    return out, faces


def build_character(spec):
    c = spec["colors"]
    mats = {
        "shell": material("Shell", SHELL, 0.32),
        "screen": material("Screen", SCREEN, 0.15),
        "seam": material("Seam", SEAM, 0.45),
        "feet": material("Feet", c["feet"], 0.4),
        "top": material("Top", c["top"], 0.38, glow=0.12, tint=c["topGlow"]),
        "topMid": material("TopMid", mix(c["top"], c["topGlow"], 0.5), 0.45, glow=0.5, tint=c["topGlow"]),
        # The glowing parts are lights, not mirrors: rough enough that a reflection
        # sliding over them as the head turns cannot wash their colour out.
        "glow": material("Glow", c["glow"], 0.6, glow=GLOW),
        # The chest glows like the eyes but must not share their material: three.js needs
        # another program for a mesh with morph targets, and a material shared by both kinds
        # makes it pick the program again on every frame.
        "chest": material("Chest", c["glow"], 0.6, glow=GLOW),
        "core": material("GlowCore", c["core"], 0.6, glow=GLOW),
        "rim": material("Rim", c["rim"], 0.55, glow=GLOW),
        "topGlow": material("TopGlow", c["topGlow"], 0.55, glow=GLOW),
    }

    root = empty("Root")
    build_body(root, mats)
    feet = Parts()
    for side in (-1, 1):
        feet.add(blob(FOOT_SIZE, 2.3, (FOOT_X * side, -0.05, FOOT_SIZE[2]), segments=32, rings=16))
    mesh_object("Feet", feet, [mats["feet"]], parent=root)

    for name, side in (("ArmL", 1), ("ArmR", -1)):
        parts = Parts()
        parts.add(arm())
        limb = mesh_object(name, parts, [mats["shell"]], parent=root,
                           location=(SHOULDER.x * side, SHOULDER.y, SHOULDER.z))
        limb.rotation_euler = (0, -ARM_REST * side, 0)  # only about Y: the app turns the arms about that axis

    build_head(root, spec, mats)
    return root


# ------------------------------------------------------- scene and output

PREVIEW_TURN = math.radians(15)  # as in the reference: turned a little to its right


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


def bounds():
    """The world-space box around every mesh in the scene, as (low corner, high corner)."""
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ Vector(c) for obj in bpy.context.scene.objects if obj.type == "MESH"
               for c in obj.bound_box]
    return (Vector([min(p[i] for p in corners) for i in range(3)]),
            Vector([max(p[i] for p in corners) for i in range(3)]))


def render_preview(path):
    scene = bpy.context.scene
    pick_engine(scene)
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    for view in ("Khronos PBR Neutral", "Standard"):  # Neutral is the curve the app tone-maps with
        try:
            scene.view_settings.view_transform = view
            break
        except TypeError:
            continue

    # Frame the robot the way the app does (frameCamera in buddy.js), a little closer.
    low, high = bounds()
    centre, size = (low + high) / 2, high - low
    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_data.lens = 90
    half_fov = math.atan(cam_data.sensor_width / 2 / cam_data.lens)
    distance = max(size.x, size.z) * 1.12 / 2 / math.tan(half_fov) + size.y / 2
    cam = bpy.data.objects.new("PreviewCam", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = centre + Matrix.Rotation(PREVIEW_TURN, 3, "Z") @ Vector((0, -distance, 0))
    cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam

    world = bpy.data.worlds.new("PreviewStudio")
    world.use_nodes = True
    sky = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    sky.inputs["Color"].default_value = (0.95, 0.9, 0.84, 1.0)
    sky.inputs["Strength"].default_value = 0.35
    scene.world = world

    # Warm, soft studio light. The long strip above the camera is what the face screen
    # reflects across its top, like the tipped-back room in the app.
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
        "file": f"{s['id']}.glb", "preview": f"previews/{s['id']}.png", "accent": s["colors"]["glow"],
    } for s in CHARACTERS]
    with open(os.path.join(out, "buddies.json"), "w") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")


if __name__ == "__main__":  # Blender runs the script as __main__; importing it only defines the builders
    main()
