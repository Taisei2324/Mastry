# ==============================================================================
#  MASTRY — Scroll-Scrubbed 3D Hero  ·  Blender rebuild
#  A full, hyperreal Cycles recreation of the web piece, baked as an animation.
#
#  Japan (Mt. Fuji, morning, wet volcanic stone) ─► the bottle falls into the
#  sea ─► a 180° underwater "turn" through murk, god-rays and caustics ─►
#  the bottle rises into Greece (Mediterranean cliffs, golden hour, limestone).
#
#  What this script builds
#  -----------------------
#   • A real ocean to the horizon (Ocean modifier, gentle swell + foam)
#   • A physical-sky world that shifts morning → golden hour across the turn
#   • A submerged volume domain: murk + volumetric god-rays (density animated)
#   • Animated fake caustics on the seabed (robust, render-cheap)
#   • Wet stone shelf + procedural boulder shorelines (volcanic ⇄ limestone)
#   • Distant scenery: a displaced Fuji (Japan) and rugged cliffs (Greece)
#   • The MASTRY bottle: imports assets/bottle.glb, else a detailed procedural
#     stand-in (glass + liquid + wrap label + cap + fizz + condensation)
#   • Rising bubbles + entry splash + Greek-side runoff (particle systems)
#   • The EXACT camera path & bottle pose from the web timeline, baked to
#     keyframes over the whole frame range so scroll ⇄ frame maps 1:1
#
#  HOW TO RUN
#  ----------
#   1. Open Blender 4.2+  (Scripting workspace).
#   2. Keep this file next to its  assets/  folder (bottle.glb, label.jpg),
#      OR set CONFIG["asset_dir"] below to that folder's absolute path.
#   3. Open this .py in the Text Editor and press  ▶ Run Script  (Alt+P).
#   4. The scene builds instantly. Scrub the timeline, or F12 to render a frame,
#      or Render ▸ Render Animation for the full sequence.
#
#  Scroll on the web later: every frame N corresponds to progress = (N-1)/FRAMES.
#  Render the sequence to an image-strip / video and drive its frame by scroll.
#
#  Notes
#   • Cycles + GPU is auto-enabled if available (falls back to CPU cleanly).
#   • Every subsystem is toggleable in CONFIG and wrapped so one failure won't
#     abort the whole build — check the System Console for a build report.
#   • If the underwater "turn" spins the wrong way for your taste, flip
#     CONFIG["roll_sign"] / CONFIG["spin_sign"].
# ==============================================================================

import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix, Quaternion, Euler

PI = math.pi

# ------------------------------------------------------------------------------
#  CONFIG  — tune everything here
# ------------------------------------------------------------------------------
CONFIG = {
    # --- render ---
    "engine":          "CYCLES",     # "CYCLES" (photoreal) or "BLENDER_EEVEE_NEXT"
    "samples":         256,
    "use_denoise":     True,
    "res_x":           1920,
    "res_y":           1080,
    "fps":             30,
    "frames":          300,          # progress 0..1 baked across this many frames (0..300 => 301 frames)
    "view_transform":  "AgX",        # "AgX" (4.x default) or "Filmic"
    "look":            "AgX - Medium High Contrast",  # set "" for None / Filmic looks
    "try_gpu":         True,

    # --- assets ---
    "asset_dir":       "",           # absolute path to the folder holding bottle.glb / label.jpg. "" = auto-resolve
    "prefer_glb":      True,         # try to import bottle.glb; fall back to procedural if missing/failed
    "bottle_glb_name": "bottle.glb",
    "label_img_name":  "label.jpg",

    # --- subsystem toggles ---
    "build_world":       True,
    "build_ocean":       True,
    "build_seabed":      True,
    "build_volume":      True,       # underwater murk + god-rays
    "build_caustics":    True,
    "build_near_japan":  True,       # wet volcanic shelf + boulders
    "build_near_greece": True,       # limestone shelf + boulders
    "build_far_japan":   True,       # Fuji
    "build_far_greece":  True,       # cliffs
    "build_bottle":      True,
    "build_condensation":True,
    "build_particles":   True,       # bubbles + splash + runoff
    "bake_animation":    True,

    # --- ocean look (waves are kept gentle for a product hero) ---
    "ocean_spatial":     6.0,        # tile size (m). Smaller = shorter wavelengths near the bottle
    "ocean_repeat":      28,
    "ocean_wave_scale":  0.11,
    "ocean_choppiness":  0.6,
    "ocean_wind":        4.0,
    "ocean_smallest":    0.008,
    "ocean_foam":        0.72,
    "ocean_resolution":  14,         # render resolution of the FFT grid (higher = crisper + heavier)

    # --- turn direction ---
    "roll_sign":  1.0,
    "spin_sign":  1.0,
}

# progress at which the world hard-swaps Japan -> Greece (hidden under peak murk)
SWAP_P = 0.585

# ------------------------------------------------------------------------------
#  SCENE CONSTANTS  (meters, taken verbatim from the web piece — Three.js Y-up)
# ------------------------------------------------------------------------------
BOTTLE_H = 0.25
HALF     = PI / 2.0

STAND_J = (0.0,  0.155, -0.045)   # upright on Japan stone
H1      = (0.0,  0.030, -0.012)   # hinge: rear base edge on the stone lip
REST_UW = (0.0, -0.075,  0.170)   # submerged horizontal rest
READY_G = (0.0, -0.063,  0.113)   # pre-hinge pose at the Greek ledge (mirror)
H2      = (0.0, -0.030, -0.012)   # hinge on the (mirrored) Greek lip
STAND_G = (0.0, -0.155, -0.045)   # upright on Greek stone

# palette (sRGB hex, from the web COL{})
HEX = {
    "deepJ": "#22424e", "deepG": "#175d72",
    "horJ":  "#dee5e9", "horG":  "#f6ddb0",
    "sunJ":  "#fff3e0", "sunG":  "#ffca7a",
    "murk":  "#0e2b31",
    "rockJ": "#3a3e40", "rockG": "#c9bda4",
    "shelfJ":"#4a4d4f", "shelfG":"#bdb19c",
    "sand":  "#b9a888",
    "uwlight":"#6db8c6",
    "foam":  "#eef4f5",
}

# ==============================================================================
#  MATH — easing + the web GSAP timeline, replicated exactly
# ==============================================================================
def clamp(v, a, b): return max(a, min(b, v))
def lerp(a, b, t):  return a + (b - a) * t
def sstep(a, b, v):
    t = clamp((v - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)

def e_none(t): return t
def e_p1_in(t):  return t * t
def e_p1_out(t): return 1.0 - (1.0 - t) * (1.0 - t)
def e_p1_io(t):  return 2 * t * t if t < 0.5 else 1.0 - ((-2 * t + 2) ** 2) / 2.0
def e_p2_io(t):  return 4 * t * t * t if t < 0.5 else 1.0 - ((-2 * t + 2) ** 3) / 2.0

# initial P{} values
P0 = {
    "camA": PI, "camD": 1.32, "camH": 0.175, "roll": 0.0,
    "lookX": 0.06, "lookY": 0.128, "lookZ": -0.045,
    "tip": 0.0, "rise": 0.0, "blend": 0.0,
    "splash1": 0.0, "splash2": 0.0,
}

# (start, duration, ease, {prop: end})  — mirrors buildTimeline() exactly
TWEENS = [
    (0.00, 0.20, e_p1_io, {"camD": 0.84, "camH": 0.150, "lookY": 0.120}),
    (0.20, 0.15, e_p1_io, {"camA": 1.5 * PI, "lookX": 0.0, "camD": 0.94, "camH": 0.105}),
    (0.35, 0.15, e_none,  {"tip": 1.0}),
    (0.35, 0.15, e_p1_in, {"lookY": 0.010, "lookZ": 0.095, "camH": 0.052, "camD": 0.90}),
    (0.483,0.09, e_none,  {"splash1": 1.0}),
    (0.50, 0.05, e_p1_io, {"camH": -0.088, "lookY": -0.072, "lookZ": 0.165}),
    (0.515,0.20, e_p2_io, {"roll": PI, "blend": 1.0, "camA": 2.5 * PI}),
    (0.65, 0.15, e_none,  {"rise": 1.0}),
    (0.652,0.10, e_none,  {"splash2": 1.0}),
    (0.65, 0.15, e_p1_io, {"camH": -0.108, "lookY": -0.118, "lookZ": -0.015}),
    (0.80, 0.20, e_p1_io, {"camA": 3.0 * PI, "lookX": 0.055, "camD": 1.26,
                           "camH": -0.168, "lookY": -0.138, "lookZ": -0.045}),
]
TWEENS.sort(key=lambda t: t[0])

def pv(prop, p):
    """Value of a P property at progress p (sequential non-overlapping GSAP tweens)."""
    val = P0[prop]
    for (start, dur, ez, props) in TWEENS:
        if prop not in props:
            continue
        end = props[prop]
        if p <= start:
            return val
        elif p >= start + dur:
            val = end
        else:
            return val + (end - val) * ez((p - start) / dur)
    return val

def murk_val(p):
    """murk has overlapping tweens in the web; modelled explicitly here."""
    if p < 0.50:  return 0.0
    if p < 0.555: return lerp(0.0, 0.85, e_p1_in((p - 0.50) / 0.055))
    if p < 0.60:  return 0.85
    if p < 0.65:  return lerp(0.85, 0.12, e_p1_out((p - 0.60) / 0.10))
    if p < 0.71:
        m065 = lerp(0.85, 0.12, e_p1_out(0.5))     # value handed to the 0.65 tween
        return lerp(m065, 0.0, (p - 0.65) / 0.06)
    return 0.0

# --- vector helpers (Three-space) ---
def vsub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def vadd(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def vlerp(a, b, t): return (lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t))
def rotx(v, th):
    c, s = math.cos(th), math.sin(th)
    return (v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c)

def bottle_pose(p):
    """Returns (pos_three, tip_angle, spin_angle) matching poseBottle()."""
    tip  = pv("tip", p)
    rise = pv("rise", p)
    if rise <= 0.0:
        th = HALF * (tip ** 1.35)
        pos = vadd(rotx(vsub(STAND_J, H1), th), H1)
        dd = sstep(0.86, 1.0, tip)
        pos = (pos[0], pos[1] - 0.138 * (dd ** 1.55), pos[2] + 0.057 * dd)
        return pos, th, 0.0
    spin = PI * sstep(0.10, 0.92, rise)
    if rise < 0.42:
        u = sstep(0.0, 1.0, rise / 0.42)
        pos = vlerp(REST_UW, READY_G, u)
        th = HALF
    else:
        u = sstep(0.0, 1.0, (rise - 0.42) / 0.58)
        th = HALF + HALF * u
        pos = vadd(rotx(vsub(STAND_G, H2), th - PI), H2)
    return pos, th, spin

# --- Three.js (Y-up) -> Blender (Z-up) : (x,y,z) -> (x,-z,y), handedness preserved
def T2B(v):
    return Vector((v[0], -v[2], v[1]))

def camera_matrix(p):
    """Full Blender camera matrix_world for progress p (exact lookAt + roll)."""
    camA = pv("camA", p); camD = pv("camD", p); camH = pv("camH", p); roll = pv("roll", p)
    lx, ly, lz = pv("lookX", p), pv("lookY", p), pv("lookZ", p)
    d = camD * 1.0   # frameK == 1 for a landscape frame (aspect >= 1)
    eye    = Vector((lx + math.sin(camA) * d, camH, lz + math.cos(camA) * d))
    target = Vector((lx, ly, lz))
    up     = Vector((0.0, 1.0, 0.0))
    z = (eye - target).normalized()          # camera +Z (backwards)
    x = up.cross(z).normalized()             # right
    y = z.cross(x)                           # up
    if abs(roll) > 1e-9:                      # camera.rotateZ(roll) about the view axis
        q = Quaternion(z, CONFIG["roll_sign"] * roll)
        x = q @ x; y = q @ y
    xb, yb, zb, pb = T2B(x), T2B(y), T2B(z), T2B(eye)
    return Matrix((
        (xb.x, yb.x, zb.x, pb.x),
        (xb.y, yb.y, zb.y, pb.y),
        (xb.z, yb.z, zb.z, pb.z),
        (0.0,  0.0,  0.0,  1.0),
    ))

def bottle_transform(p):
    """Returns (blender_location, blender_quaternion) for the bottle control."""
    pos, th, spin = bottle_pose(p)
    loc = T2B(pos)
    # Three q = Rx(th) * Ry(spin)  ->  Blender Rx'(th) * Rz'(spin)  (Y->Z under T2B)
    q = Quaternion((1, 0, 0), th) @ Quaternion((0, 0, 1), CONFIG["spin_sign"] * spin)
    return loc, q

# ==============================================================================
#  COLOR + NODE + MESH HELPERS
# ==============================================================================
def _s2l(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def hexlin(h, a=1.0):
    h = h.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (_s2l(r), _s2l(g), _s2l(b), a)

def set_in(node, names, value):
    if isinstance(names, str):
        names = [names]
    for n in names:
        if n in node.inputs:
            try:
                node.inputs[n].default_value = value
                return node.inputs[n]
            except Exception:
                pass
    return None

def principled(nodes, links, name="mat"):
    n = nodes.new("ShaderNodeBsdfPrincipled")
    return n

def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree.nodes, m.node_tree.links

def clear_default_bsdf(nodes, links, out_name="Material Output"):
    """Return (output_node). Keeps the output, removes the stock Principled."""
    out = None
    for n in list(nodes):
        if n.type == "OUTPUT_MATERIAL":
            out = n
        elif n.type == "BSDF_PRINCIPLED":
            nodes.remove(n)
    if out is None:
        out = nodes.new("ShaderNodeOutputMaterial")
    return out

# --- mesh builders (mostly hand-built to stay version-robust) ---
def obj_from_pydata(name, verts, faces, coll, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.validate()
    if smooth:
        for pgon in me.polygons:
            pgon.use_smooth = True
    me.update()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob

def lathe(profile_rz, segments):
    """Revolve a (radius,z) profile around the Z axis -> (verts, faces)."""
    verts, faces = [], []
    n = len(profile_rz)
    for j in range(segments):
        ang = 2.0 * PI * j / segments
        c, s = math.cos(ang), math.sin(ang)
        for (r, z) in profile_rz:
            verts.append((r * c, r * s, z))
    for j in range(segments):
        j2 = (j + 1) % segments
        for i in range(n - 1):
            a = j * n + i
            b = j * n + i + 1
            c = j2 * n + i + 1
            d = j2 * n + i
            faces.append((a, b, c, d))
    return verts, faces

def tube(radius, z0, z1, segments, uv_v=True):
    """Open cylinder wall (for the label) with clean wrap UVs -> verts, faces, uvs."""
    verts, faces = [], []
    for j in range(segments + 1):
        ang = 2.0 * PI * j / segments
        c, s = math.cos(ang), math.sin(ang)
        verts.append((radius * c, radius * s, z0))
        verts.append((radius * c, radius * s, z1))
    for j in range(segments):
        a = 2 * j; b = 2 * j + 1; c = 2 * j + 3; d = 2 * j + 2
        faces.append((a, c, d, b))
    return verts, faces

def cyl_solid(radius, z0, z1, segments):
    """Capped cylinder -> verts, faces."""
    verts = [(0, 0, z0), (0, 0, z1)]
    for j in range(segments):
        ang = 2.0 * PI * j / segments
        c, s = math.cos(ang), math.sin(ang)
        verts.append((radius * c, radius * s, z0))
        verts.append((radius * c, radius * s, z1))
    faces = []
    for j in range(segments):
        j2 = (j + 1) % segments
        b0 = 2 + 2 * j; t0 = 3 + 2 * j
        b1 = 2 + 2 * j2; t1 = 3 + 2 * j2
        faces.append((b0, b1, t1, t0))   # side
        faces.append((0, b1, b0))        # bottom fan
        faces.append((1, t0, t1))        # top fan
    return verts, faces

def add_uvsphere_into(bm, center, radius, u=8, v=6):
    try:
        res = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=radius)
    except TypeError:
        res = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, diameter=radius * 2.0)
    for vert in res["verts"]:
        vert.co += Vector(center)
    return res

def make_collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c

# ==============================================================================
#  RESET
# ==============================================================================
def purge_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for blocks in (bpy.data.meshes, bpy.data.materials, bpy.data.textures,
                   bpy.data.images, bpy.data.node_groups, bpy.data.lights,
                   bpy.data.cameras, bpy.data.particles, bpy.data.actions):
        for b in list(blocks):
            try: blocks.remove(b)
            except Exception: pass

# ==============================================================================
#  ASSET RESOLUTION
# ==============================================================================
def resolve_asset_dir():
    if CONFIG["asset_dir"]:
        d = bpy.path.abspath(CONFIG["asset_dir"])
        if os.path.isdir(d):
            return d
    candidates = []
    if bpy.data.filepath:
        candidates.append(os.path.join(os.path.dirname(bpy.data.filepath), "assets"))
        candidates.append(os.path.dirname(bpy.data.filepath))
    try:
        txt = bpy.context.space_data.text
        if txt and txt.filepath:
            base = os.path.dirname(bpy.path.abspath(txt.filepath))
            candidates.append(os.path.join(base, "assets"))
            candidates.append(base)
    except Exception:
        pass
    try:
        base = os.path.dirname(os.path.abspath(__file__))
        candidates.append(os.path.join(base, "assets"))
        candidates.append(base)
    except Exception:
        pass
    for d in candidates:
        if d and os.path.isdir(d):
            return d
    return ""

# ==============================================================================
#  WORLD  — physical sky, morning -> golden hour
# ==============================================================================
def build_world():
    world = bpy.data.worlds.new("MASTRY_World")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg  = nt.nodes.new("ShaderNodeBackground")
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "NISHITA"
    sky.sun_elevation = math.radians(14.0)
    sky.sun_rotation  = math.radians(20.0)
    try:
        sky.altitude = 120.0
        sky.air_density  = 1.1
        sky.dust_density = 1.6
        sky.ozone_density = 1.0
        sky.sun_intensity = 0.7
        sky.sun_size = math.radians(1.5)
    except Exception:
        pass
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(sky.outputs[0], bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    return {"sky": sky, "bg": bg, "out": out, "world": world}

# ==============================================================================
#  SUN + UNDERWATER LIGHT
# ==============================================================================
def build_lights(coll):
    sd = bpy.data.lights.new("Sun", "SUN")
    sd.energy = 4.0
    sd.angle  = math.radians(1.5)
    sd.color  = hexlin(HEX["sunJ"])[:3]
    sun = bpy.data.objects.new("Sun", sd)
    sun.rotation_euler = Euler((math.radians(52.0), 0.0, math.radians(35.0)), "XYZ")
    coll.objects.link(sun)

    ud = bpy.data.lights.new("UW_Light", "POINT")
    ud.energy = 0.0
    ud.color  = hexlin(HEX["uwlight"])[:3]
    ud.shadow_soft_size = 0.5
    uw = bpy.data.objects.new("UW_Light", ud)
    uw.location = T2B((0.12, -0.03, 0.17))
    coll.objects.link(uw)
    return {"sun_obj": sun, "sun_data": sd, "uw_obj": uw, "uw_data": ud}

# ==============================================================================
#  OCEAN
# ==============================================================================
def build_ocean(coll):
    bm = bmesh.new()
    try:
        bmesh.ops.create_grid(bm, x_segments=2, y_segments=2, size=1.0)
    except TypeError:
        bmesh.ops.create_grid(bm, x_segments=2, y_segments=2, size=1.0, calc_uvs=True)
    me = bpy.data.meshes.new("Ocean")
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new("Ocean", me)
    coll.objects.link(ob)

    mod = ob.modifiers.new("Ocean", "OCEAN")
    mod.geometry_mode   = "GENERATE"
    mod.spatial_size    = CONFIG["ocean_spatial"]
    mod.repeat_x        = CONFIG["ocean_repeat"]
    mod.repeat_y        = CONFIG["ocean_repeat"]
    mod.wave_scale      = CONFIG["ocean_wave_scale"]
    mod.choppiness      = CONFIG["ocean_choppiness"]
    mod.wind_velocity   = CONFIG["ocean_wind"]
    mod.wave_alignment  = 0.55
    mod.smallest_wave   = CONFIG["ocean_smallest"]
    mod.random_seed     = 7
    try:
        mod.resolution          = CONFIG["ocean_resolution"]
        mod.viewport_resolution = min(CONFIG["ocean_resolution"], 8)
    except Exception:
        try: mod.resolution = CONFIG["ocean_resolution"]
        except Exception: pass
    mod.use_foam = True
    try:
        mod.foam_coverage   = CONFIG["ocean_foam"]
        mod.foam_layer_name = "foam"
    except Exception:
        pass

    # --- water material : glass water + foam via a MixShader (all stable nodes)
    mat, nodes, links = new_mat("Water")
    out = clear_default_bsdf(nodes, links)
    water = nodes.new("ShaderNodeBsdfPrincipled")
    set_in(water, "Base Color", hexlin(HEX["deepJ"]))
    set_in(water, "Roughness", 0.02)
    set_in(water, "IOR", 1.333)
    set_in(water, ["Transmission Weight", "Transmission"], 1.0)
    foam = nodes.new("ShaderNodeBsdfPrincipled")
    set_in(foam, "Base Color", hexlin(HEX["foam"]))
    set_in(foam, "Roughness", 0.55)
    mixsh = nodes.new("ShaderNodeMixShader")
    attr  = nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "foam"
    ramp  = nodes.new("ShaderNodeValToRGB")
    try:
        ramp.color_ramp.elements[0].position = 0.05
        ramp.color_ramp.elements[1].position = 0.5
    except Exception:
        pass
    links.new(attr.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], mixsh.inputs["Fac"])
    links.new(water.outputs[0], mixsh.inputs[1])
    links.new(foam.outputs[0], mixsh.inputs[2])
    links.new(mixsh.outputs[0], out.inputs["Surface"])
    ob.data.materials.append(mat)

    return {"obj": ob, "mod": mod, "mat": mat, "water_bsdf": water}

# ==============================================================================
#  SEABED  (+ animated fake caustics)
# ==============================================================================
def build_seabed(coll):
    seg = 120
    bm = bmesh.new()
    try:
        bmesh.ops.create_grid(bm, x_segments=seg, y_segments=seg, size=20.0)
    except TypeError:
        bmesh.ops.create_grid(bm, x_segments=seg, y_segments=seg, size=20.0, calc_uvs=True)
    # gentle rolling sand + ripples
    for v in bm.verts:
        x, y = v.co.x, v.co.y
        h  = 0.35 * math.sin(x * 0.5 + 1.3) * math.cos(y * 0.42 + 0.7)
        h += 0.12 * math.sin(x * 1.7 + y * 1.3)
        h += 0.03 * math.sin(x * 6.0 + 0.5) * math.sin(y * 5.3)
        v.co.z += h
    me = bpy.data.meshes.new("Seabed")
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new("Seabed", me)
    ob.location = (0.0, 0.0, -6.0)
    coll.objects.link(ob)

    mat, nodes, links = new_mat("Seabed")
    out = clear_default_bsdf(nodes, links)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    set_in(bsdf, "Base Color", hexlin(HEX["sand"]))
    set_in(bsdf, "Roughness", 0.95)
    # sand micro-bump
    ncoord = nodes.new("ShaderNodeTexCoord")
    nnoise = nodes.new("ShaderNodeTexNoise")
    nnoise.inputs["Scale"].default_value = 30.0
    nbump = nodes.new("ShaderNodeBump")
    nbump.inputs["Strength"].default_value = 0.15
    links.new(ncoord.outputs["Object"], nnoise.inputs["Vector"])
    links.new(nnoise.outputs["Fac"], nbump.inputs["Height"])
    links.new(nbump.outputs["Normal"], bsdf.inputs["Normal"])

    result = out
    caustic_nodes = None
    if CONFIG["build_caustics"]:
        # additive caustic emission, animated + keyframed to appear during the turn
        emit = nodes.new("ShaderNodeEmission")
        emit.inputs["Color"].default_value = (0.55, 0.92, 0.98, 1.0)
        emit.inputs["Strength"].default_value = 0.0
        cmap = nodes.new("ShaderNodeMapping")
        cvor = nodes.new("ShaderNodeTexVoronoi")
        cvor.feature = "SMOOTH_F1"
        cvor.inputs["Scale"].default_value = 3.2
        cramp = nodes.new("ShaderNodeValToRGB")
        try:
            cramp.color_ramp.elements[0].position = 0.55
            cramp.color_ramp.elements[1].position = 0.85
        except Exception:
            pass
        links.new(ncoord.outputs["Object"], cmap.inputs["Vector"])
        links.new(cmap.outputs["Vector"], cvor.inputs["Vector"])
        links.new(cvor.outputs["Distance"], cramp.inputs["Fac"])
        links.new(cramp.outputs["Color"], emit.inputs["Color"])
        addsh = nodes.new("ShaderNodeAddShader")
        links.new(bsdf.outputs[0], addsh.inputs[0])
        links.new(emit.outputs[0], addsh.inputs[1])
        links.new(addsh.outputs[0], out.inputs["Surface"])
        caustic_nodes = {"emit": emit, "map": cmap}
    else:
        links.new(bsdf.outputs[0], out.inputs["Surface"])

    ob.data.materials.append(mat)
    return {"obj": ob, "mat": mat, "caustic": caustic_nodes}

# ==============================================================================
#  UNDERWATER VOLUME  (murk + god-rays)
# ==============================================================================
def build_volume(coll):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    me = bpy.data.meshes.new("UW_Volume")
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new("UW_Volume", me)
    ob.scale = (40.0, 40.0, 9.0)
    ob.location = (0.0, 0.0, -3.5)      # top ~ +1, bottom ~ -8
    ob.display_type = "WIRE"
    coll.objects.link(ob)

    mat, nodes, links = new_mat("UW_Volume")
    out = clear_default_bsdf(nodes, links)
    scat = nodes.new("ShaderNodeVolumeScatter")
    scat.inputs["Color"].default_value = (0.11, 0.42, 0.46, 1.0)
    scat.inputs["Density"].default_value = 0.0
    try: scat.inputs["Anisotropy"].default_value = 0.4
    except Exception: pass
    absb = nodes.new("ShaderNodeVolumeAbsorption")
    absb.inputs["Color"].default_value = hexlin(HEX["murk"])
    absb.inputs["Density"].default_value = 0.0
    addv = nodes.new("ShaderNodeAddShader")
    links.new(scat.outputs[0], addv.inputs[0])
    links.new(absb.outputs[0], addv.inputs[1])
    links.new(addv.outputs[0], out.inputs["Volume"])
    ob.data.materials.append(mat)
    return {"obj": ob, "scatter": scat, "absorption": absb}

# ==============================================================================
#  WET-ROCK MATERIAL  (shared by shelf + boulders)
# ==============================================================================
def wet_rock_mat(name, base_hex, wet=0.55):
    mat, nodes, links = new_mat(name)
    out = clear_default_bsdf(nodes, links)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    set_in(bsdf, "Base Color", hexlin(base_hex))
    coord = nodes.new("ShaderNodeTexCoord")
    # roughness break-up (wet patches)
    rn = nodes.new("ShaderNodeTexNoise"); rn.inputs["Scale"].default_value = 6.0
    rramp = nodes.new("ShaderNodeValToRGB")
    try:
        rramp.color_ramp.elements[0].color = (0.25, 0.25, 0.25, 1)   # wet/glossy
        rramp.color_ramp.elements[1].color = (0.95, 0.95, 0.95, 1)   # dry/rough
    except Exception:
        pass
    links.new(coord.outputs["Object"], rn.inputs["Vector"])
    links.new(rn.outputs["Fac"], rramp.inputs["Fac"])
    links.new(rramp.outputs["Color"], bsdf.inputs["Roughness"])
    # surface bump
    bn = nodes.new("ShaderNodeTexNoise")
    bn.inputs["Scale"].default_value = 14.0
    bn.inputs["Detail"].default_value = 8.0
    bump = nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.35
    links.new(coord.outputs["Object"], bn.inputs["Vector"])
    links.new(bn.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs[0], out.inputs["Surface"])
    return mat

# ==============================================================================
#  NEAR SET  — wet stone shelf + boulder shoreline
# ==============================================================================
def build_shelf(coll, rock_mat, shelf_hex, seed):
    # slab: 14 x 8 x 0.55, top at z ~ +0.03 (3cm above the waterline), ragged seaward lip
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= 14.0; v.co.y *= 8.0; v.co.z *= 0.55
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=24, use_grid_fill=True)
    rnd = random.Random(seed)
    for v in bm.verts:
        # seaward edge = +Y; recede + roughen the front lip only (keep bottle footprint clean)
        fy = sstep(1.2, 3.9, v.co.y) * sstep(0.26, 0.9, abs(v.co.x))
        if v.co.z > 0.0 and fy > 0.0:
            n = 0.5 + 0.34 * math.sin(v.co.x * 2.13 + 0.7) + 0.22 * math.sin(v.co.x * 4.71 + 2.1)
            v.co.y -= fy * (0.15 + 0.7 * clamp(n, 0, 1))
            v.co.z -= fy * 0.08 * clamp(n, 0, 1)
        # subtle overall wet-rock relief on the top face
        if v.co.z > 0.2:
            v.co.z += 0.015 * math.sin(v.co.x * 3.0) * math.cos(v.co.y * 2.4)
    me = bpy.data.meshes.new("Shelf")
    bm.to_mesh(me); bm.free()
    ob = obj_from_pydata_existing(me, "Shelf", coll)
    ob.location = (0.0, -4.0, -0.245)   # top face lands ~ +0.03 (0.55/2 - 0.245)
    shelf_mat = wet_rock_mat("Shelf_" + shelf_hex.strip("#"), shelf_hex)
    ob.data.materials.append(shelf_mat)
    return ob

def obj_from_pydata_existing(me, name, coll):
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob

def build_boulders(coll, rock_mat, seed, count, size_k, sink, near_min_x):
    rnd = random.Random(seed)
    combined = bmesh.new()
    for i in range(count):
        far = i >= int(count * 0.82)
        r = rnd.random()
        s = ((0.16 + 0.34 * rnd.random()) if far
             else (0.045 + 0.16 * r * r + 0.06 * rnd.random())) * size_k
        x = ((0.36 if far else near_min_x)
             + (0.9 + 5.0 * rnd.random() if far else (rnd.random() ** 1.35) * 5.6)) * (1 if rnd.random() < 0.5 else -1)
        y = (-0.8 - 1.8 * rnd.random()) if far else (0.52 - 0.78 * rnd.random())  # +Y = seaward
        bm = bmesh.new()
        try:
            bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        except TypeError:
            bmesh.ops.create_icosphere(bm, subdivisions=2, diameter=2.0)
        p1, p2 = rnd.random() * 6.28, rnd.random() * 6.28
        for v in bm.verts:
            k = (1.0 + 0.28 * math.sin(v.co.x * 2.9 + p1) * math.sin(v.co.y * 2.5 + p2) * math.sin(v.co.z * 3.3)
                 + 0.09 * math.sin(v.co.x * 6.9 + v.co.y * 5.3 + p1))
            v.co *= k
        # scale / squash / place
        sx = s; sy = s * (0.62 + 0.5 * rnd.random()); sz = s * (0.52 + 0.42 * rnd.random())
        for v in bm.verts:
            v.co.x *= sx; v.co.y *= sy; v.co.z *= sz
        rotz = rnd.random() * 6.28
        cz, sz2 = math.cos(rotz), math.sin(rotz)
        zpos = (0.0 if y < 0 else 0.03) - s * ((0.42 if y < 0 else 0.22) * (0.5 + rnd.random()) + sink)
        for v in bm.verts:
            nx = v.co.x * cz - v.co.y * sz2
            ny = v.co.x * sz2 + v.co.y * cz
            v.co.x, v.co.y = nx, ny
            v.co += Vector((x, -y, zpos))   # note: seaward +Y(three) -> -Y offset handled by sign of y already
        combined.from_mesh(bm.to_mesh(bpy.data.meshes.new("_tmp"))) if False else None
        # merge bm into combined
        me_tmp = bpy.data.meshes.new("_tmp")
        bm.to_mesh(me_tmp); bm.free()
        combined.from_mesh(me_tmp)
        bpy.data.meshes.remove(me_tmp)
    me = bpy.data.meshes.new("Boulders")
    combined.to_mesh(me); combined.free()
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new("Boulders", me)
    coll.objects.link(ob)
    ob.data.materials.append(rock_mat)
    return ob

# ==============================================================================
#  FAR SCENERY  — Fuji (Japan) and cliffs (Greece)
# ==============================================================================
def build_fuji(coll):
    seg = 64
    bm = bmesh.new()
    try:
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                              radius1=1.0, radius2=0.06, depth=1.0)
    except TypeError:
        bmesh.ops.create_cone(bm, cap_ends=True, segments=seg,
                              radius1=1.0, radius2=0.06, depth=1.0)
    for v in bm.verts:
        # gentle ridging + broaden the base into a Fuji silhouette
        ang = math.atan2(v.co.y, v.co.x)
        v.co.z = (v.co.z + 0.5)           # base at 0
        rr = math.hypot(v.co.x, v.co.y)
        v.co.x *= 1.0 + 0.05 * math.sin(ang * 7.0)
        v.co.y *= 1.0 + 0.05 * math.sin(ang * 7.0)
    me = bpy.data.meshes.new("Fuji")
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new("Fuji", me)
    ob.scale = (46.0, 46.0, 30.0)
    ob.location = (0.0, 150.0, -2.0)      # far into the scene (+Y)
    coll.objects.link(ob)

    mat, nodes, links = new_mat("Fuji")
    out = clear_default_bsdf(nodes, links)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    set_in(bsdf, "Roughness", 1.0)
    # snow cap via z gradient
    sep = nodes.new("ShaderNodeSeparateXYZ")
    geo = nodes.new("ShaderNodeNewGeometry")
    ramp = nodes.new("ShaderNodeValToRGB")
    try:
        ramp.color_ramp.elements[0].position = 0.62
        ramp.color_ramp.elements[0].color = hexlin("#4b5560")
        ramp.color_ramp.elements[1].position = 0.78
        ramp.color_ramp.elements[1].color = (0.92, 0.94, 0.98, 1)
    except Exception:
        pass
    links.new(geo.outputs["Position"], sep.inputs["Vector"])
    links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs[0], out.inputs["Surface"])
    ob.data.materials.append(mat)
    return ob

def build_cliffs(coll):
    rnd = random.Random(99)
    combined = bmesh.new()
    placements = [(-70, 130, 34, 22), (60, 150, 40, 26), (-30, 175, 30, 20), (95, 120, 26, 16)]
    for (x, y, w, h) in placements:
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=6, use_grid_fill=True)
        for v in bm.verts:
            v.co.x *= w; v.co.y *= w * 0.7; v.co.z *= h
            n = (0.5 + 0.4 * math.sin(v.co.x * 0.1 + rnd.random() * 3)
                 + 0.3 * math.sin(v.co.z * 0.2))
            if v.co.z > 0:
                v.co.z += n * h * 0.18
            v.co.x += 3.0 * math.sin(v.co.z * 0.2 + rnd.random())
        for v in bm.verts:
            v.co += Vector((x, y, h * 0.5 - 6.0))
        me_tmp = bpy.data.meshes.new("_c")
        bm.to_mesh(me_tmp); bm.free()
        combined.from_mesh(me_tmp)
        bpy.data.meshes.remove(me_tmp)
    me = bpy.data.meshes.new("Cliffs")
    combined.to_mesh(me); combined.free()
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new("Cliffs", me)
    coll.objects.link(ob)
    mat = wet_rock_mat("Cliff", "#c7b393", wet=0.2)
    ob.data.materials.append(mat)
    return ob

# ==============================================================================
#  BOTTLE
# ==============================================================================
BOTTLE_PROFILE = [
    (0.000, -0.1250), (0.0210, -0.1242), (0.0298, -0.1210), (0.0324, -0.1160),
    (0.0332, -0.1070), (0.0334, -0.0980), (0.0334, 0.0200), (0.0328, 0.0320),
    (0.0308, 0.0430), (0.0262, 0.0550), (0.0196, 0.0670), (0.0150, 0.0780),
    (0.0127, 0.0880), (0.0119, 0.0980), (0.0119, 0.1040),
]

def build_procedural_bottle(coll, label_path):
    parts = []
    # glass
    v, f = lathe(BOTTLE_PROFILE, 64)
    glass = obj_from_pydata("Bottle_Glass", v, f, coll)
    gm, gn, gl = new_mat("Glass")
    out = clear_default_bsdf(gn, gl)
    gb = gn.new("ShaderNodeBsdfPrincipled")
    set_in(gb, "Base Color", (0.92, 0.96, 0.96, 1.0))
    set_in(gb, "Roughness", 0.03)
    set_in(gb, "IOR", 1.45)
    set_in(gb, ["Transmission Weight", "Transmission"], 1.0)
    set_in(gb, ["Coat Weight", "Clearcoat"], 0.5)
    gl.new(gb.outputs[0], out.inputs["Surface"])
    glass.data.materials.append(gm)
    parts.append(glass)

    # liquid
    liq_prof = [(r * 0.93, z) for (r, z) in BOTTLE_PROFILE[1:10]]
    liq_prof += [(0.014, 0.058), (0.0, 0.060)]
    v, f = lathe(liq_prof, 56)
    liquid = obj_from_pydata("Bottle_Liquid", v, f, coll)
    lm, ln, ll = new_mat("Liquid")
    out = clear_default_bsdf(ln, ll)
    lb = ln.new("ShaderNodeBsdfPrincipled")
    set_in(lb, "Base Color", (0.86, 0.95, 0.93, 1.0))
    set_in(lb, "Roughness", 0.04)
    set_in(lb, "IOR", 1.34)
    set_in(lb, ["Transmission Weight", "Transmission"], 1.0)
    ll.new(lb.outputs[0], out.inputs["Surface"])
    liquid.data.materials.append(lm)
    parts.append(liquid)

    # label (wrap)
    v, f = tube(0.0339, -0.0328 - 0.04175, -0.0328 + 0.04175, 72)
    label = obj_from_pydata("Bottle_Label", v, f, coll, smooth=True)
    # UVs: u around, v along height
    me = label.data
    me.uv_layers.new(name="UVMap")
    uvl = me.uv_layers.active.data
    li = 0
    for poly in me.polygons:
        for loop_i in poly.loop_indices:
            vi = me.loops[loop_i].vertex_index
            ring = vi // 2
            top = vi % 2
            uvl[li].uv = (ring / 72.0, float(top))
            li += 1
    lm2, ln2, ll2 = new_mat("Label")
    out = clear_default_bsdf(ln2, ll2)
    lb2 = ln2.new("ShaderNodeBsdfPrincipled")
    set_in(lb2, "Roughness", 0.5)
    if label_path and os.path.isfile(label_path):
        try:
            img = bpy.data.images.load(label_path, check_existing=True)
            tex = ln2.new("ShaderNodeTexImage")
            tex.image = img
            ll2.new(tex.outputs["Color"], lb2.inputs["Base Color"])
        except Exception:
            set_in(lb2, "Base Color", (0.9, 0.88, 0.83, 1))
    else:
        set_in(lb2, "Base Color", (0.9, 0.88, 0.83, 1))
    ll2.new(lb2.outputs[0], out.inputs["Surface"])
    label.data.materials.append(lm2)
    parts.append(label)

    # cap + seal ring (aluminium)
    v, f = cyl_solid(0.0136, 0.112 - 0.011, 0.112 + 0.011, 36)
    cap = obj_from_pydata("Bottle_Cap", v, f, coll)
    cm, cn, cl = new_mat("Cap")
    out = clear_default_bsdf(cn, cl)
    cb = cn.new("ShaderNodeBsdfPrincipled")
    set_in(cb, "Base Color", (0.81, 0.83, 0.84, 1))
    set_in(cb, "Metallic", 1.0)
    set_in(cb, "Roughness", 0.3)
    cl.new(cb.outputs[0], out.inputs["Surface"])
    cap.data.materials.append(cm)
    parts.append(cap)

    v, f = cyl_solid(0.0134, 0.099, 0.102, 36)
    ring = obj_from_pydata("Bottle_Ring", v, f, coll)
    ring.data.materials.append(cm)
    parts.append(ring)

    # fizz (inside liquid) + condensation (on glass)
    if CONFIG["build_condensation"]:
        rnd = random.Random(11)
        bm = bmesh.new()
        for _ in range(90):
            th = rnd.random() * 2 * PI
            z = -0.115 + rnd.random() * 0.145
            on_label = -0.0745 < z < 0.009
            rr = 0.0345 if on_label else 0.0339
            s = 0.0006 + rnd.random() * 0.0011
            add_uvsphere_into(bm, (math.sin(th) * rr, math.cos(th) * rr, z), s, 6, 5)
        me2 = bpy.data.meshes.new("Condensation")
        bm.to_mesh(me2); bm.free()
        for p in me2.polygons: p.use_smooth = True
        cond = bpy.data.objects.new("Condensation", me2)
        coll.objects.link(cond)
        dm, dn, dl = new_mat("Droplet")
        out = clear_default_bsdf(dn, dl)
        db = dn.new("ShaderNodeBsdfPrincipled")
        set_in(db, "Base Color", (0.95, 0.98, 0.99, 1))
        set_in(db, "Roughness", 0.02)
        set_in(db, "IOR", 1.33)
        set_in(db, ["Transmission Weight", "Transmission"], 0.9)
        dl.new(db.outputs[0], out.inputs["Surface"])
        cond.data.materials.append(dm)
        parts.append(cond)

        # fizz
        bm = bmesh.new()
        for _ in range(42):
            th = rnd.random() * 2 * PI
            rr = rnd.random() * 0.024
            s = 0.0007 + rnd.random() * 0.0011
            add_uvsphere_into(bm, (math.sin(th) * rr, math.cos(th) * rr,
                                   -0.11 + rnd.random() * 0.16), s, 5, 4)
        me3 = bpy.data.meshes.new("Fizz")
        bm.to_mesh(me3); bm.free()
        fizz = bpy.data.objects.new("Fizz", me3)
        coll.objects.link(fizz)
        fm, fn, fl = new_mat("Fizz")
        out = clear_default_bsdf(fn, fl)
        fe = fn.new("ShaderNodeEmission")
        fe.inputs["Color"].default_value = (0.95, 0.98, 1.0, 1)
        fe.inputs["Strength"].default_value = 0.6
        fl.new(fe.outputs[0], out.inputs["Surface"])
        fizz.data.materials.append(fm)
        parts.append(fizz)

    return parts

def import_glb_bottle(coll, glb_path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    imported = [o for o in bpy.data.objects if o not in before]
    if not imported:
        raise RuntimeError("glTF import produced no objects")
    # move to our collection
    for o in imported:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
    # normalize: 0.25m tall, centered
    mesh_objs = [o for o in imported if o.type == "MESH"]
    if mesh_objs:
        mins = Vector((1e9, 1e9, 1e9)); maxs = Vector((-1e9, -1e9, -1e9))
        for o in mesh_objs:
            for corner in o.bound_box:
                w = o.matrix_world @ Vector(corner)
                mins = Vector((min(mins[i], w[i]) for i in range(3)))
                maxs = Vector((max(maxs[i], w[i]) for i in range(3)))
        size = maxs - mins
        h = max(size.z, 1e-6)
        scale = BOTTLE_H / h
        center = (mins + maxs) * 0.5
        for o in imported:
            if o.parent is None:
                o.location = (o.location - center) * scale
                o.scale = tuple(s * scale for s in o.scale)
    # glass/liquid -> alpha-transparent (transmission can't see the transparent world backdrop layers on web; here we keep true glass)
    for o in mesh_objs:
        for slot in o.material_slots:
            m = slot.material
            if not m or not m.use_nodes:
                continue
            nm = (m.name + " " + o.name).lower()
            is_opaque = any(k in nm for k in ("cap", "metal", "alumin", "label", "lable", "ring", "seal"))
            bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            if bsdf and not is_opaque and ("glass" in nm or "liquid" in nm or "water" in nm):
                set_in(bsdf, ["Transmission Weight", "Transmission"], 1.0)
                set_in(bsdf, "Roughness", 0.03)
                set_in(bsdf, "IOR", 1.45)
    return imported

# ==============================================================================
#  PARTICLES  — bubbles, entry splash, Greek runoff
# ==============================================================================
def _instance_sphere(name, radius):
    bm = bmesh.new()
    try:
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius)
    except TypeError:
        bmesh.ops.create_icosphere(bm, subdivisions=1, diameter=radius * 2)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = (0.0, 0.0, -50.0)   # parked far off-camera; only its instances render
    bpy.context.scene.collection.objects.link(ob)
    return ob

def _emitter_disk(name, loc, radius):
    bm = bmesh.new()
    try:
        bmesh.ops.create_circle(bm, cap_ends=True, segments=16, radius=radius)
    except TypeError:
        bmesh.ops.create_circle(bm, cap_ends=True, segments=16, diameter=radius * 2)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    bpy.context.scene.collection.objects.link(ob)
    ob.show_instancer_for_render = False
    ob.show_instancer_for_viewport = False
    return ob

def build_particles(coll, frames, fps):
    def frame_of(p): return 1 + int(round(p * frames))
    bubble_inst = _instance_sphere("P_Bubble", 1.0)
    dropm, dn, dl = new_mat("P_Drop")
    out = clear_default_bsdf(dn, dl)
    db = dn.new("ShaderNodeBsdfPrincipled")
    set_in(db, "Base Color", (0.9, 0.96, 0.98, 1))
    set_in(db, "Roughness", 0.02)
    set_in(db, "IOR", 1.33)
    set_in(db, ["Transmission Weight", "Transmission"], 0.85)
    dl.new(db.outputs[0], out.inputs["Surface"])
    bubble_inst.data.materials.append(dropm)

    def add_sys(name, emitter, count, p0, p1, life_frames, size, grav, nfac, rfac):
        emitter.modifiers.new(name, "PARTICLE_SYSTEM")
        psys = emitter.particle_systems[-1]
        s = psys.settings
        s.count = count
        s.frame_start = frame_of(p0)
        s.frame_end = frame_of(p1)
        s.lifetime = life_frames
        s.lifetime_random = 0.5
        s.emit_from = "FACE"
        s.distribution = "RAND"
        s.physics_type = "NEWTON"
        s.normal_factor = nfac
        s.factor_random = rfac
        s.particle_size = size
        s.size_random = 0.6
        s.effector_weights.gravity = grav
        s.render_type = "OBJECT"
        s.instance_object = bubble_inst
        s.use_rotations = False
        try: s.display_method = "DOT"
        except Exception: pass
        return psys

    # bubbles rising during submersion (buoyancy up = negative gravity)
    em_b = _emitter_disk("Emit_Bubbles", T2B((0.0, -0.02, 0.12)), 0.05)
    add_sys("Bubbles", em_b, 140, 0.44, 0.70, int(0.10 * frames) + 6, 0.004, -0.5, 0.06, 0.04)
    # entry splash
    em_s = _emitter_disk("Emit_Splash", T2B((0.0, 0.0, 0.135)), 0.03)
    add_sys("Splash", em_s, 120, 0.48, 0.57, int(0.05 * frames) + 4, 0.005, 1.4, 0.45, 0.35)
    # Greek-side runoff off the rising bottle
    em_r = _emitter_disk("Emit_Runoff", T2B((0.0, -0.05, 0.05)), 0.03)
    add_sys("Runoff", em_r, 70, 0.652, 0.752, int(0.06 * frames) + 4, 0.004, 1.0, 0.15, 0.3)
    return {"bubble_inst": bubble_inst, "emitters": [em_b, em_s, em_r]}

# ==============================================================================
#  CAMERA
# ==============================================================================
def build_camera(coll):
    cd = bpy.data.cameras.new("Camera")
    cd.sensor_fit = "VERTICAL"
    cd.angle = math.radians(34.0)     # matches Three PerspectiveCamera fov (vertical)
    cd.clip_start = 0.01
    cd.clip_end = 2000.0
    cam = bpy.data.objects.new("Camera", cd)
    cam.rotation_mode = "QUATERNION"
    coll.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam

# ==============================================================================
#  BUILD
# ==============================================================================
def build():
    report = []
    scene = bpy.context.scene
    purge_scene()

    frames = CONFIG["frames"]
    fps = CONFIG["fps"]
    scene.frame_start = 1
    scene.frame_end = 1 + frames
    scene.render.fps = fps
    scene.render.resolution_x = CONFIG["res_x"]
    scene.render.resolution_y = CONFIG["res_y"]

    asset_dir = resolve_asset_dir()
    label_path = os.path.join(asset_dir, CONFIG["label_img_name"]) if asset_dir else ""
    glb_path = os.path.join(asset_dir, CONFIG["bottle_glb_name"]) if asset_dir else ""
    report.append("Asset dir: " + (asset_dir or "(none found — procedural bottle, no label texture)"))

    # collections
    C_env = make_collection("ENV")
    C_jp = make_collection("JP")
    C_gr = make_collection("GR")
    C_bottle = make_collection("BOTTLE")
    C_fx = make_collection("FX")

    handles = {}

    def step(name, fn):
        try:
            handles[name] = fn()
            report.append("  ok  " + name)
        except Exception as e:
            report.append("  !!  " + name + "  ->  " + repr(e))

    if CONFIG["build_world"]:
        step("world", lambda: build_world())
    step("lights", lambda: build_lights(C_env))
    if CONFIG["build_ocean"]:
        step("ocean", lambda: build_ocean(C_env))
    if CONFIG["build_seabed"]:
        step("seabed", lambda: build_seabed(C_env))
    if CONFIG["build_volume"]:
        step("volume", lambda: build_volume(C_env))

    # near sets
    rock_j = wet_rock_mat("Rock_J", HEX["rockJ"])
    rock_g = wet_rock_mat("Rock_G", HEX["rockG"])
    if CONFIG["build_near_japan"]:
        step("shelf_J", lambda: build_shelf(C_jp, rock_j, HEX["shelfJ"], 7))
        step("boulders_J", lambda: build_boulders(C_jp, rock_j, 7, 34, 1.0, 0.0, 0.36))
    if CONFIG["build_near_greece"]:
        step("shelf_G", lambda: build_shelf(C_gr, rock_g, HEX["shelfG"], 23))
        step("boulders_G", lambda: build_boulders(C_gr, rock_g, 23, 40, 0.7, 0.16, 0.95))
    if CONFIG["build_far_japan"]:
        step("fuji", lambda: build_fuji(C_jp))
    if CONFIG["build_far_greece"]:
        step("cliffs", lambda: build_cliffs(C_gr))

    # bottle rig
    ctrl = bpy.data.objects.new("Bottle_CTRL", None)
    ctrl.empty_display_size = 0.1
    ctrl.rotation_mode = "QUATERNION"
    C_bottle.objects.link(ctrl)
    geo = bpy.data.objects.new("Bottle_GEO", None)
    geo.empty_display_size = 0.05
    geo.rotation_euler = Euler((0.0, 0.0, math.radians(151.0)), "XYZ")   # label facing (Three obj.rotation.y = 151°)
    C_bottle.objects.link(geo)
    geo.parent = ctrl

    if CONFIG["build_bottle"]:
        parts = []
        built = False
        if CONFIG["prefer_glb"] and glb_path and os.path.isfile(glb_path):
            try:
                parts = import_glb_bottle(C_bottle, glb_path)
                built = True
                report.append("  ok  bottle (imported bottle.glb)")
            except Exception as e:
                report.append("  !!  bottle.glb import failed -> procedural. " + repr(e))
        if not built:
            try:
                parts = build_procedural_bottle(C_bottle, label_path)
                report.append("  ok  bottle (procedural)")
            except Exception as e:
                report.append("  !!  procedural bottle failed. " + repr(e))
        for pth in parts:
            if pth.parent is None:
                pth.parent = geo
                pth.matrix_parent_inverse = Matrix.Identity(4)
    handles["ctrl"] = ctrl

    if CONFIG["build_particles"]:
        step("particles", lambda: build_particles(C_fx, frames, fps))

    cam = build_camera(C_env)
    handles["cam"] = cam

    setup_render(scene)

    if CONFIG["bake_animation"]:
        try:
            bake_animation(scene, handles, C_jp, C_gr, frames, fps)
            report.append("  ok  animation baked (%d frames)" % (frames + 1))
        except Exception as e:
            report.append("  !!  bake_animation -> " + repr(e))

    scene.frame_set(1)
    print("\n" + "=" * 64 + "\n MASTRY Blender build report\n" + "=" * 64)
    for r in report:
        print(r)
    print("=" * 64 + "\n Scrub the timeline / F12 to render / Render ▸ Animation for the sequence.\n")

# ==============================================================================
#  ANIMATION BAKE
# ==============================================================================
def bake_animation(scene, H, C_jp, C_gr, frames, fps):
    cam = H["cam"]
    ctrl = H["ctrl"]
    sun_obj  = H.get("lights", {}).get("sun_obj")
    sun_data = H.get("lights", {}).get("sun_data")
    uw_data  = H.get("lights", {}).get("uw_data")
    world    = H.get("world")
    ocean    = H.get("ocean")
    seabed   = H.get("seabed")
    volume   = H.get("volume")

    warm   = hexlin(HEX["sunJ"])[:3]
    golden = hexlin(HEX["sunG"])[:3]
    deepJ  = hexlin(HEX["deepJ"])
    deepG  = hexlin(HEX["deepG"])

    for f in range(frames + 1):
        p = f / frames
        fr = 1 + f
        b = pv("blend", p)
        m = murk_val(p)

        # camera
        loc, quat, sc = camera_matrix(p).decompose()
        cam.location = loc
        cam.rotation_quaternion = quat
        cam.keyframe_insert("location", frame=fr)
        cam.keyframe_insert("rotation_quaternion", frame=fr)

        # bottle
        bloc, bq = bottle_transform(p)
        ctrl.location = bloc
        ctrl.rotation_quaternion = bq
        ctrl.keyframe_insert("location", frame=fr)
        ctrl.keyframe_insert("rotation_quaternion", frame=fr)

        # sun: direction + color + energy (morning -> golden, dimmed by murk)
        if sun_obj and sun_data:
            elev = math.radians(lerp(52.0, 8.0, b))   # rotation_euler.x ~ elevation-ish
            az   = math.radians(lerp(35.0, -40.0, b))
            sun_obj.rotation_euler = Euler((elev, 0.0, az), "XYZ")
            sun_obj.keyframe_insert("rotation_euler", frame=fr)
            col = tuple(lerp(warm[i], golden[i], b) for i in range(3))
            sun_data.color = col
            sun_data.energy = 4.0 * (1.0 - 0.6 * m)
            sun_data.keyframe_insert("color", frame=fr)
            sun_data.keyframe_insert("energy", frame=fr)

        if uw_data:
            uw_data.energy = m * 45.0
            uw_data.keyframe_insert("energy", frame=fr)

        # world sky: elevation/azimuth shift + murk dimming
        if world:
            sky = world["sky"]; bg = world["bg"]
            try:
                sky.sun_elevation = math.radians(lerp(14.0, 4.5, b))
                sky.sun_rotation  = math.radians(lerp(20.0, -35.0, b))
                sky.keyframe_insert("sun_elevation", frame=fr)
                sky.keyframe_insert("sun_rotation", frame=fr)
            except Exception:
                pass
            bg.inputs["Strength"].default_value = 1.0 * (1.0 - 0.55 * m)
            bg.inputs["Strength"].keyframe_insert("default_value", frame=fr)

        # water tint blend
        if ocean:
            wb = ocean["water_bsdf"]
            col = tuple(lerp(deepJ[i], deepG[i], b) for i in range(4))
            bc = wb.inputs.get("Base Color")
            if bc:
                bc.default_value = col
                bc.keyframe_insert("default_value", frame=fr)
            # ocean surface motion
            mod = ocean["mod"]
            try:
                mod.time = fr / fps
                ocean["obj"].keyframe_insert(data_path='modifiers["Ocean"].time', frame=fr)
            except Exception:
                pass

        # volume density (murk + god-rays only during the turn)
        if volume:
            sden = volume["scatter"].inputs["Density"]
            aden = volume["absorption"].inputs["Density"]
            sden.default_value = m * 0.85
            aden.default_value = m * 0.55
            sden.keyframe_insert("default_value", frame=fr)
            aden.keyframe_insert("default_value", frame=fr)

        # caustics: appear through the turn, pattern scrolls with progress
        if seabed and seabed.get("caustic"):
            emit = seabed["caustic"]["emit"]
            cmap = seabed["caustic"]["map"]
            cstr = (sstep(0.46, 0.55, p) * (1.0 - sstep(0.62, 0.72, p))) * 3.2
            emit.inputs["Strength"].default_value = cstr
            emit.inputs["Strength"].keyframe_insert("default_value", frame=fr)
            loc_in = cmap.inputs["Location"]
            loc_in.default_value = (p * 2.0, p * 1.4, 0.0)
            loc_in.keyframe_insert("default_value", frame=fr)

    # ---- world visibility swap (Japan -> Greece), hidden under peak murk ----
    swap_fr = 1 + int(round(SWAP_P * frames))
    def key_vis(objs, visible_before):
        for ob in objs:
            # before swap
            ob.hide_render = not visible_before
            ob.hide_viewport = not visible_before
            ob.keyframe_insert("hide_render", frame=1)
            ob.keyframe_insert("hide_viewport", frame=1)
            ob.keyframe_insert("hide_render", frame=swap_fr - 1)
            ob.keyframe_insert("hide_viewport", frame=swap_fr - 1)
            # after swap
            ob.hide_render = visible_before
            ob.hide_viewport = visible_before
            ob.keyframe_insert("hide_render", frame=swap_fr)
            ob.keyframe_insert("hide_viewport", frame=swap_fr)
            ob.keyframe_insert("hide_render", frame=1 + frames)
            ob.keyframe_insert("hide_viewport", frame=1 + frames)
    key_vis(list(C_jp.objects), True)    # Japan visible first
    key_vis(list(C_gr.objects), False)   # Greece appears after swap

    # ---- interpolation: LINEAR for smooth per-frame bake; CONSTANT for hides ----
    for act in bpy.data.actions:
        for fc in act.fcurves:
            is_hide = "hide" in fc.data_path
            for kp in fc.keyframe_points:
                kp.interpolation = "CONSTANT" if is_hide else "LINEAR"

# ==============================================================================
#  RENDER SETTINGS
# ==============================================================================
def setup_render(scene):
    eng = CONFIG["engine"]
    try:
        scene.render.engine = eng
    except Exception:
        scene.render.engine = "CYCLES"
        eng = "CYCLES"

    if eng == "CYCLES":
        cy = scene.cycles
        cy.samples = CONFIG["samples"]
        try:
            cy.use_denoising = CONFIG["use_denoise"]
            cy.denoiser = "OPENIMAGEDENOISE"
        except Exception:
            pass
        try:
            cy.volume_bounces = 2
            cy.transparent_max_bounces = 24
            cy.transmission_bounces = 16
        except Exception:
            pass
        if CONFIG["try_gpu"]:
            try:
                prefs = bpy.context.preferences.addons["cycles"].preferences
                for ctype in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
                    try:
                        prefs.compute_device_type = ctype
                        prefs.get_devices()
                        gpus = [d for d in prefs.devices if d.type != "CPU"]
                        if gpus:
                            for d in prefs.devices:
                                d.use = True
                            scene.cycles.device = "GPU"
                            break
                    except Exception:
                        continue
            except Exception:
                pass

    # color management
    try:
        scene.view_settings.view_transform = CONFIG["view_transform"]
        if CONFIG["look"]:
            scene.view_settings.look = CONFIG["look"]
    except Exception:
        pass

    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"


# ------------------------------------------------------------------------------
if __name__ == "__main__":
    build()
