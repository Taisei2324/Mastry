# ==============================================================================
#  MASTRY — Scroll-Scrubbed 3D Hero  ·  Blender MAX rebuild  ·  v5
#
#  v5 FIXES (2026-07-13) — from Taisei's render feedback:
#    • BOTTLE SEE-THROUGH: the .glb glass material isn't named "glass", so the old
#      importer left it OPAQUE. Now any non-cap/label/metal material -> clear glass.
#    • NO MORE WHITE BALLS: particle spray + bubbles mis-scaled (radius-1.0 instances)
#      into giant balls -> build_particles / build_bubbles OFF.
#    • NO RANDOM RING at the Greek rise -> removed the breach ring.
#    • WATER + GLASS read see-through in the Material Preview viewport (EEVEE raytracing).
#    >>> YOU MUST RE-RUN THE SCRIPT (Alt+P) after opening — editing the .py does NOT
#        change an already-built Blender scene. <<<
#
#  Hyperreal Cycles recreation of the web piece, baked as an animation.
#  Targets Blender 4.5 LTS and 5.x — every version-sensitive call degrades
#  gracefully (try/except), so it also runs on 4.2+.
#
#  Japan (Mt. Fuji across the bay, morning, wet volcanic stone) ─► the bottle
#  tips off the stone lip and plunges into the sea ─► a full 360° underwater
#  barrel roll through murk, god-rays, marine snow and caustics ─► the bottle
#  breaches, arcs through golden air, and settles onto a Greek limestone ledge.
#
#  WHAT CHANGED vs. the first rebuild (mastry_scene.py)
#  ----------------------------------------------------
#  1. PHYSICAL ACT 2.  The web piece cheats its Greek finale: the whole Greek
#     world is mirrored through the water plane (the bottle "stands" upside
#     down BELOW the surface) and a 180° camera roll makes it read upright.
#     That trick cannot survive a physical renderer (real water = total
#     internal reflection, sun on the wrong side, stone underwater…).
#     Here act 2 is re-staged physically:
#       • bottle: underwater glide → breach → golden arc → touchdown on stone
#       • camera: the web's π roll becomes a FULL 2π barrel roll inside the
#         murk (reads as the same disorienting "turn", ends upright), then the
#         camera itself surfaces during the final pull-back.
#     Act 1 and the camera orbit/dolly numbers stay verbatim from the web.
#  2. SHELF PLACEMENT FIX.  The stone slab now actually sits under the bottle
#     footprint (the old build left the bottle ~5 cm past the ragged lip).
#  3. FAR SCENERY SIDE FIX.  Fuji / the Greek cliffs now stand across the bay
#     (seaward, where the camera looks) instead of behind the camera.
#  4. MAX DETAIL PASS.  Real glass wall thickness + punt + knurled cap +
#     embossed glass logotype, condensation runnels, contact-foam where water
#     meets rock, wet-band shading at the waterline, basalt columns (Japan),
#     limestone strata + white pebble beach + clifftop village specks (Greece),
#     kelp silhouettes, marine snow, splash rings, bubble wake off the moving
#     bottle, gobo god-ray light, rim light with light-linking, animated DOF,
#     motion blur, and a film-out compositor (bloom, teal underwater grade,
#     chromatic fringe, vignette).
#
#  v4 MOTION PASS (this file)
#  --------------------------
#   • SEAMLESS HANDOFFS.  Act 1 and act 2 now share REST_UW as a single seam,
#     so the bottle's position AND heading stay continuous through the plunge —
#     no snap into the water, no dead stop before the launch.
#   • PHYSICAL BOTTLE.  Gravity-accelerated topple with a touch of anticipation;
#     a damped water-entry over-rotation; and a weighted gravity arc (a Catmull-
#     Rom path driven by one crest-slow time curve) that lands coming *down*
#     onto the stone instead of floating in.
#   • CAMERA.  A whisper of handheld drift so held frames never read as frozen,
#     plus a wider motion-blur shutter on the fast beats (plunge / roll / breach).
#   Every FX/world timing anchor (splash, rings, murk swap) is unchanged, so the
#   whole sequence stays in sync.
#
#  v4.2 CANONICAL RECONCILIATION (this file)
#  -----------------------------------------
#  Reconciled 1:1 to the source-of-truth design docs (Desktop/Mastry/camera angle/
#  "Camera Direction Script" + "Higgsfield Replication Script"), which transcribe the
#  live three.js hero exactly. Four parallel deep passes (camera/physics/look/timeline)
#  verified every number. Net over v4.1:
#   • CAMERA = the canon rig verbatim: 34° FOV, one monotonic pi->3pi lap
#     (6:00->3:00->12:00->9:00->6:00), camD 1.32->0.84->0.94->0.90(LOCKED)->1.26,
#     camH +0.175->-0.088, tilt <=3deg, fixed f/4, bottle just left of center.
#     Parked = frozen (handheld OFF — canon Rule 5).
#   • UNDERWATER TURN restored: a physical 2pi barrel roll synced with the 180deg
#     yaw sweep, fully inside near-opaque DARK teal murk (#0e2b31) that hides the
#     Japan->Greece hard-swap; re-opens to golden god-rays. (Canon's literal 180deg
#     roll needs an upside-down mirrored-Greece build that can't survive a physical
#     renderer; the 2pi returns the camera to true-upright over the REAL Greek set.)
#   • ACT 2 rise = exact time-reverse of the topple (canon S5 "drawbridge"): lands
#     upright on the Greek stone with ZERO bounce.
#   • Sun stays LEFT in BOTH worlds; silver bubbles on; fog #c9d4da -> #f0d9b2.
#   • 24 fps / 480 frames = the true 20 s master (1 s = 5% scroll).
#
#  HOW TO RUN
#  ----------
#   1. Open Blender 4.5+ (Scripting workspace).
#   2. Keep this file next to its  assets/  folder (bottle.glb, label.jpg),
#      OR set CONFIG["asset_dir"] to that folder's absolute path.
#   3. Open this .py in the Text Editor and press ▶ Run Script (Alt+P).
#   4. Scrub the timeline; F12 renders a frame; Render ▸ Render Animation
#      writes the sequence to  //render_max/ .
#
#  Scroll on the web later: frame N  ↔  progress = (N-1)/FRAMES, exactly.
#
#  QUALITY
#  -------
#  CONFIG["quality"]:
#    "draft" — 48 spp, 960×540, light volumes.  Layout checks. Seconds/frame.
#    "final" — 384 spp, 1920×1080, motion blur. The intended look.
#    "max"   — 1536 spp, 3840×2160, path guiding, finer volumes. Poster/4K.
#  Every subsystem is toggleable in CONFIG; one failure never aborts the
#  build — read the System Console build report.
# ==============================================================================

import bpy, bmesh, math, os, random
from mathutils import Vector, Matrix, Quaternion, Euler

PI = math.pi

# ------------------------------------------------------------------------------
#  CONFIG
# ------------------------------------------------------------------------------
CONFIG = {
    # --- render ---
    "engine":         "CYCLES",          # "CYCLES" or "BLENDER_EEVEE_NEXT"
    "quality":        "final",           # "draft" | "final" | "max"
    "fps":            24,
    "frames":         480,               # progress 0..1 over frames+1; 480 = 20s @ 24fps master (S1 96 / S2-S5 72 / S6 96)
    "view_transform": "AgX",
    "looks":          ["AgX - Medium High Contrast", "Medium High Contrast", ""],
    "try_gpu":        True,
    "render_out":     "//render_max/",

    # --- assets ---
    "asset_dir":       "/Users/taiseitomita/Downloads/blender 2/assets",  # real bottle.glb (green cap) + photo backdrops; clear to "" to auto-detect
    "prefer_glb":      True,
    "bottle_glb_name": "bottle.glb",
    "label_img_name":  "label.jpg",
    "bg_japan_name":   "bg_japan.png",    # cinematic hero plate (rock-ledge pedestal, soft Fuji) — reverted from the 180 pano; bg_japan_pano.png still in assets/ if wanted
    "bg_greece_name":  "bg_greece.png",
    "bg_underwater_name": "bg_underwater.png",  # optional plate while submerged
    "bg_japan_left_name":  "bg_japan_left.png",   # camera-left forest wall for the side-profile beat (pano front plate covers the hero-facing arc)
    "bg_japan_left_lift":  0.08,          # slide the camera-left forest plate UP the wall (fraction of wall height) so it sits higher in the side-profile frame
    "bg_greece_left_name": "bg_greece_left.png",
    "photo_backdrop":  True,              # if a bg image exists, use it instead of far scenery
    "backdrop_mode":   "curve",           # "curve" = smooth cyclorama stitching front+left photos; "camera" = always fills frame
    "bg_japan_hcompress": 1.0,            # 1.0 = OFF (hero plate fills frame at true aspect); >1 squeezes a wide 180 pano's width into the lens (was 1.35 during the pano experiment)
    "bg_japan_zoom":    0.75,             # <1 zooms OUT the Fuji hero plate (uniform, aspect-preserving): Fuji smaller, more lakeside scene in frame. 1.0 = full-size plate
    "left_panel_angle": -12.0,            # where the JAPAN side photo sits on the curve (deg; 0 = due left of camera, -90 = dead ahead)
    "greece_side_angle": -5.0,            # GREECE side plate zone (deg on the wall) — seen from the mirrored 3:00 rise camera

    # --- subsystem toggles ---
    "build_world":        True,
    "build_atmosphere":   True,    # thin aerial-perspective volume above the sea
    "build_clouds":       True,    # drifting high cloud plane
    "build_ocean":        True,
    "build_seabed":       True,
    "build_volume":       True,    # underwater murk + god-rays domain
    "build_caustics":     True,    # animated fake caustics (cheap, reliable)
    "true_caustics":      False,   # ALSO enable Cycles MNEE shadow caustics (slow; experimental)
    "build_near_japan":   True,
    "build_near_greece":  True,
    "build_far_japan":    True,
    "build_far_greece":   True,
    "build_basalt":       False,   # OFF: sharp hexagonal columns read as jagged spikes — smooth zen stones instead
    "build_village":      True,    # white clifftop specks + blue dome (Greece)
    "build_pebbles":      True,    # hair-scattered shore pebbles + seabed stones
    "build_lakebed":      True,    # dense boulder field paving the lakebed (reference look)
    "cull_offcamera":     True,    # skip building rocks the baked camera path can never see (smaller, faster file)
    "build_kelp":         True,    # swaying kelp silhouettes for the turn
    "build_bottle":       True,
    "bottle_emboss":      True,    # embossed glass "MASTRY" (procedural bottle only)
    "build_condensation": True,
    "build_particles":    False,   # OFF: sphere-instanced spray mis-scaled into giant white balls in 4.5
    "build_bubbles":      False,   # OFF: bubbles rendered as big white balls (disliked)
    "build_rings":        False,   # OFF: the emission ring reads as a floating CG halo, not a water wave
    "build_rim":          True,    # bottle-only rim light (light-linking where available)
    "build_gobo":         True,    # animated god-ray spot
    "build_compositor":   True,
    "bake_animation":     True,

    # --- secondary motion ---
    "settle_wobble":      False,   # canonical "zero bounce on the settle" (negative prompt bans bounce)
    "underwater_sway":    True,    # gentle drift while resting in the murk
    "entry_followthrough":True,    # damped over-rotation as the bottle pierces the surface
    "cam_handheld":       False,   # canon Rule 5: parked = frozen tripod, zero handheld/idle drift

    # --- ocean ---
    "ocean_spatial":    6.0,
    "ocean_repeat":     28,
    "ocean_wave_scale": 0.022,   # gentle 2 cm undulation — alive, but still under the 3 cm ledge (no flooding)
    "ocean_choppiness": 0.60,
    "ocean_wind":       4.0,
    "ocean_smallest":   0.008,
    "ocean_foam":       0.08,

    # --- direction flips (taste) ---
    "roll_sign": 1.0,    # single-180 turn swept the OTHER way (user frames 270-285): cap RIGHT -> via BOTTOM -> LEFT. 180 lands the same final basis either sign, so the p0.654 junction is sign-safe
    "spin_sign": 1.0,
}

QUALITY = {
    #           samples  res            ocean  adaptive  volume_rate  guiding  mblur
    "draft": dict(spp=48,   rx=960,  ry=540,  ores=9,  athr=0.05,  vrate=2.0, guide=False, mb=False),
    "final": dict(spp=384,  rx=1920, ry=1080, ores=13, athr=0.010, vrate=1.0, guide=False, mb=True),
    "max":   dict(spp=1536, rx=3840, ry=2160, ores=16, athr=0.003, vrate=0.5, guide=True,  mb=True),
}

# progress at which the world hard-swaps Japan -> Greece (hidden under peak murk)
SWAP_P   = 0.585
BREACH_P = 0.729    # bottle nose crosses the surface (derived from the arc below)
LAND_P   = 0.800    # touchdown on the Greek stone (end of the web 'rise' tween)

# ------------------------------------------------------------------------------
#  SCENE CONSTANTS  (meters; web/Three.js Y-up coordinates)
# ------------------------------------------------------------------------------
BOTTLE_H = 0.25
HALF     = PI / 2.0

STAND_J = (0.0,  0.155, -0.045)   # upright on the Japanese stone (verbatim)
H1      = (0.0,  0.030, -0.012)   # hinge: rear base edge on the stone lip (verbatim)
REST_UW = (0.0, -0.075,  0.170)   # submerged horizontal rest (verbatim)

# --- physical act-2 waypoints (replaces the web's mirrored READY_G/H2/STAND_G) ---
PRE_G   = (0.0, -0.055, 0.135)    # underwater glide target — clear of the submerged rock face
ARC_G   = (0.0,  0.235, 0.105)    # bezier control: carries the bottle up over the lip
STAND_G = (0.0,  0.155, -0.045)   # upright on the Greek stone — same spot, new world

HEX = {
    "deepJ": "#22424e", "deepG": "#175d72",
    "horJ":  "#c9d4da", "horG":  "#f0d9b2",   # canonical source-of-truth fog colors
    "sunJ":  "#fff3e0", "sunG":  "#ffca7a",
    "murk":  "#0e2b31",
    "rockJ": "#2b3033", "rockG": "#d5cab2",   # J = dark volcanic basalt/andesite · G = pale limestone
    "shelfJ":"#363a3c", "shelfG":"#cabfa7",
    "sand":  "#b9a888",
    "uwlight":"#6db8c6",
    "foam":  "#eef4f5",
    "moss":  "#46543a",
    "domeB": "#2e5f9e",
}

# ==============================================================================
#  MATH — easing + the web GSAP timeline
# ==============================================================================
def clamp(v, a, b): return max(a, min(b, v))
def lerp(a, b, t):  return a + (b - a) * t
def sstep(a, b, v):
    t = clamp((v - a) / (b - a), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)
def ss5(a, b, v):
    # quintic smootherstep: C2 (zero velocity AND accel at the ends) — no jerk
    # kinks at segment joins, so orbit moves read organic, not CNC.
    t = clamp((v - a) / (b - a), 0.0, 1.0)
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)

def e_none(t): return t
def e_p1_in(t):  return t * t
def e_p1_out(t): return 1.0 - (1.0 - t) * (1.0 - t)
def e_p1_io(t):  return 2 * t * t if t < 0.5 else 1.0 - ((-2 * t + 2) ** 2) / 2.0
def e_p2_io(t):  return 4 * t * t * t if t < 0.5 else 1.0 - ((-2 * t + 2) ** 3) / 2.0
def e_sinh(t):   return math.sinh(4.0 * t) / math.sinh(4.0)   # the bottle's own fall clock (S3 camera follows it)

P0 = {
    "camA": PI, "camD": 1.32, "camH": 0.175, "roll": 0.0,
    "lookX": 0.06, "lookY": 0.128, "lookZ": -0.045,
    "tip": 0.0, "rise": 0.0, "blend": 0.0, "orb": 0.0,
    "splash1": 0.0, "splash2": 0.0,
}

# (start, duration, ease, {prop: end}) — web timeline; act-2 entries adapted to
# the physical staging (marked ←). Everything else is verbatim.
TWEENS = [
    (0.00, 0.20, e_p1_io, {"camD": 0.84, "camH": 0.150, "lookY": 0.120}),
    (0.20, 0.15, e_p1_io, {"camA": 1.5 * PI, "lookX": 0.0, "camD": 0.94, "camH": 0.105}),
    (0.35, 0.15, e_none,  {"tip": 1.0}),
    (0.35, 0.133, e_sinh, {"lookY": 0.010, "lookZ": 0.095, "camH": 0.052, "camD": 0.90}),   # S3: crane+aim on the bottle's sinh clock, completing AT the splash
    (0.483,0.09, e_none,  {"splash1": 1.0}),
    (0.483,0.04, e_p1_io, {"camH": -0.088, "lookY": -0.072, "lookZ": 0.165}),  # dive starts AT the splash: bottle + camera submerge together, water covers the world change
    # camA HELD at 3:00 through the underwater section — the turn is an UNDER-LOOP (in
    # camera_matrix): 180 under the bottle -> 90 turn -> 180 horizontal home, one continuous
    # non-bouncing spherical curve, back to 3:00 at 90deg roll for the rise.
    (0.515,0.13, e_p1_io, {"blend": 1.0}),                    # world Japan->Greece crossfade (softened by the thinned murk)
    (0.65, 0.15, e_none,  {"rise": 1.0}),
    (0.702,0.10, e_none,  {"splash2": 1.0}),                                   # ← retimed to the breach
    (0.65, 0.15, e_p1_io, {"camH": 0.09, "lookY": 0.012, "lookZ": 0.028}),   # camera SURFACES in the murk-clear -> watches the rise from +9 cm (canon S5)
    (0.80, 0.20, e_p1_io, {"camA": 1.0 * PI, "lookX": 0.055, "camD": 1.26,   # return arc: 3:00 -> 6:00 front label for the hero (camA held 3:00 through the under-swing)
                           "camH": 0.162, "lookY": 0.132, "lookZ": -0.045}),   # ← camera surfaces
]
TWEENS.sort(key=lambda t: t[0])

def pv(prop, p):
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
    # THINNED (user: "don't make it black — show the 180 orbit"): peak 0.85 -> 0.5 so the
    # sweep is visible; still enough haze to soften the Japan->Greece crossfade.
    if p < 0.50:  return 0.0
    if p < 0.555: return lerp(0.0, 0.50, e_p1_in((p - 0.50) / 0.055))
    if p < 0.60:  return 0.50
    if p < 0.65:  return lerp(0.50, 0.10, e_p1_out((p - 0.60) / 0.10))
    if p < 0.71:
        m065 = lerp(0.50, 0.10, e_p1_out(0.5))
        return lerp(m065, 0.0, (p - 0.65) / 0.06)
    return 0.0

def underwater_win(p):
    """1 while the camera is below the surface (for shafts / grade)."""
    return sstep(0.495, 0.525, p) * (1.0 - sstep(0.655, 0.705, p))   # closes as the camera surfaces (~p0.68)

# --- vector helpers (Three-space) ---
def vsub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def vadd(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def rotx(v, th):
    c, s = math.cos(th), math.sin(th)
    return (v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c)

def bottle_pose(p):
    """(pos_three, tip_angle, spin_angle).
    Act 1: gravity-accelerated felled-tree topple off the stone lip into the sea,
           landing horizontal on REST_UW, cap seaward (frame-right).
    Act 2: the exact TIME-REVERSE of that topple — the bottle un-drops neck-first
           and un-topples about the same base edge, standing upright on STAND_G.
    Both acts meet at REST_UW, so position AND heading stay continuous — no snap,
    no dead stop, and zero bounce on the settle."""
    tip  = pv("tip", p)
    rise = pv("rise", p)
    if rise <= 0.0:
        # ULTRA-REAL FALL — the push imparts angular VELOCITY (Newton): once it
        # moves, it KEEPS moving. th = A*sinh(LAM*u) is the exact inverted-pendulum
        # solution for a velocity push at the cap — moving from frame one,
        # accelerating monotonically, never stalling, crashing through the last
        # 30 degrees like a felled tree. (The old cosh curve was a displacement
        # push: jolt -> 2 s stall -> drop. Rejected: motion must be continuous.)
        # A*sinh(LAM*1) == HALF exactly, so the REST_UW seam is untouched.
        LAM = 4.0                                    # gravity shape: higher = more back-loaded whip
        A = HALF / math.sinh(LAM)
        u = clamp(tip, 0.0, 1.0)
        th = A * math.sinh(LAM * u)
        pos = vadd(rotx(vsub(STAND_J, H1), th), H1)
        # base slips off the wet lip only in the FINAL DEGREES (angle-based, canon S3)
        dd = sstep(math.radians(62.0), HALF, th)
        pos = (pos[0], pos[1] - 0.138 * (dd ** 1.55), pos[2] + 0.057 * dd)
        return pos, th, 0.0
    # --- act 2: rise out of the water and stand — the TIME-REVERSE of the topple ---
    # This mirrors the reference films exactly: they shoot the bottle toppling and
    # play it backwards ("S1rev") to get a graceful stand-up. So act 2 is act 1's
    # topple+drop run in reverse about the same base edge, landing on STAND_G.
    # No aerial breach arc — the bottle drifts up neck-first and stands in place.
    t2 = 1.0 - sstep(0.30, 1.0, rise)          # 1 = submerged & flat, 0 = standing upright
    th = HALF * (t2 ** 2.15)                    # HALF -> 0  (un-topple about the base edge)
    pos = vadd(rotx(vsub(STAND_G, H1), th), H1)
    dd = sstep(0.86, 1.0, t2)                   # un-drop: the bottle rises up out of the sea
    pos = (pos[0], pos[1] - 0.138 * (dd ** 1.55), pos[2] + 0.057 * dd)
    return pos, th, 0.0

# --- Three.js (Y-up) -> Blender (Z-up): (x,y,z) -> (x,-z,y) ---
def T2B(v):
    return Vector((v[0], -v[2], v[1]))

def camera_matrix(p):
    camA = pv("camA", p); camD = pv("camD", p); camH = pv("camH", p)
    lx, ly, lz = pv("lookX", p), pv("lookY", p), pv("lookZ", p)
    target = Vector((lx, ly, lz))
    up = Vector((0.0, 1.0, 0.0))
    # THREE BACK-TO-BACK TURNS, each igniting as the last settles (no dead hold, no CNC halt,
    # no merge): (1) 180 VERTICAL under to the opposite side (ss5 0.515-0.585); (2) a SINGLE 180
    # view-axis turn swept the OTHER way -> cap RIGHT -> via BOTTOM -> LEFT (ss5 0.568-0.654,
    # overlaps turn 1's tail ~25% vel floor); (3) 180 HORIZONTAL pan home (ss5 0.640-0.722) as
    # ONE global curve th_pan that IGNITES inside the elif branch (Ry(-th_pan) on u & n0) so it
    # is already moving across the 0.654 branch seam, with an INSTANT DIAGONAL height-follow of
    # the rising bottle over frames 337-348. Turn 1 rides the X-Y great circle (eye.z seaward,
    # never inland); basis-up rides the transported normal n0 (no pole flip at nadir). total
    # roll==PI by 0.654 so the branch basis (upside-down n0 + 180 = plain look-at) matches, and
    # th_pan is identical in both branches -> C1 there. Outside [0.515,0.722] = plain look-at.
    if p <= 0.515 or p >= 0.722:
        eye = Vector((lx + math.sin(camA) * camD, camH, lz + math.cos(camA) * camD))
        z = (eye - target).normalized(); x = up.cross(z).normalized(); y = z.cross(x)
    elif p < 0.654:
        psi = PI * ss5(0.515, 0.585, p)                       # TURN 1: 180 vertical under, 3:00 -> under -> 9:00 (frames 248-281)
        u  = Vector((-math.cos(psi), -math.sin(psi), 0.0))
        n0 = Vector((-math.sin(psi),  math.cos(psi), 0.0))    # transported up (avoids nadir pole flip)
        th_pan = PI * ss5(0.640, 0.722, p)                    # TURN 3 pan is ONE global curve that IGNITES inside this branch (0.640) so it is already moving as it crosses the 0.654 branch seam -> no CNC dead-stop. Ry(-th_pan) on the eye-offset AND the transported up keeps the pose+velocity continuous across 0.654 (both branches read the same th_pan)
        if th_pan > 1e-9:
            c, s = math.cos(th_pan), math.sin(th_pan)
            u  = Vector((u.x * c - u.z * s,   u.y, u.x * s + u.z * c))
            n0 = Vector((n0.x * c - n0.z * s, n0.y, n0.x * s + n0.z * c))
        eye = target + camD * u + (camH - ly) * up            # world-up height offset -> eye.y matches the look-at at both junctions
        z = (eye - target).normalized(); x = n0.cross(z).normalized(); y = z.cross(x)
        rroll = PI * ss5(0.568, 0.654, p)                     # TURN 2: single 180 view-axis roll, cap RIGHT -> via BOTTOM -> LEFT; overlaps turn 1's tail (0.568-0.585, ~25% vel floor -> no halt) and lands EXACTLY 180 at the 0.654 boundary (junction basis preserved). ~41 frames -> no strobe
        if rroll > 1e-9:
            q = Quaternion(z, CONFIG["roll_sign"] * rroll); x = q @ x; y = q @ y
    else:                                                      # 0.654 <= p < 0.722
        a = PI / 2.0 - PI * ss5(0.640, 0.722, p)              # TURN 3: 180 horizontal pan 9:00 -> seaward 6:00 -> 3:00, SAME global curve as the elif overlap -> C1 across the 0.654 seam (pan already at ~32% peak speed there, roll settling underneath)
        # INSTANT DIAGONAL FOLLOW (frames 337-348): hold the camera low through the pan, then a
        # FAST catch-up rise over p0.700-0.722 that lands EXACTLY on the ramp with matching slope
        # (C1) -> no bounce, frames >=348 byte-identical. "Diagonal" = this height spring + the
        # lookZ/lookY re-aim already tracking the risen bottle. (camD stays 0.90 -> no inward bounce)
        held = pv("camH", 0.654)                              # frozen low height through the pan
        g = ss5(0.700, 0.722, p)                              # 0 until frame 337, 1 by frame 347
        camH_use = held + (camH - held) * g                  # g=0 -> held (matches elif @0.654); g=1 -> camH (matches post-0.722 look-at)
        eye = Vector((lx + math.sin(a) * camD, camH_use, lz + math.cos(a) * camD))
        z = (eye - target).normalized(); x = up.cross(z).normalized(); y = z.cross(x)
    xb, yb, zb, pb = T2B(x), T2B(y), T2B(z), T2B(eye)
    return Matrix((
        (xb.x, yb.x, zb.x, pb.x),
        (xb.y, yb.y, zb.y, pb.y),
        (xb.z, yb.z, zb.z, pb.z),
        (0.0,  0.0,  0.0,  1.0),
    ))

def bottle_transform(p):
    pos, th, spin = bottle_pose(p)
    loc = T2B(pos)
    q = Quaternion((1, 0, 0), th) @ Quaternion((0, 0, 1), CONFIG["spin_sign"] * spin)
    return loc, q

# ------------------------------------------------------------------------------
#  OFF-CAMERA CULLING — never build scenery the baked camera path can't see
# ------------------------------------------------------------------------------
P_JP = [i / 40.0 * 0.50 for i in range(41)]           # Japan act incl. the entry
P_GR = [0.65 + i / 40.0 * 0.35 for i in range(41)]    # Greece act
P_UW = [0.44 + i / 40.0 * 0.44 for i in range(41)]    # underwater window (full sweep)

_CAM_LOCS = []
def _cam_clearance(center, radius, pad=0.35):
    """False if the sphere ever comes within pad of the baked camera track —
    keeps every rock out of the lens for the WHOLE film."""
    if not _CAM_LOCS:
        for i in range(121):
            _CAM_LOCS.append(camera_matrix(i / 120.0).decompose()[0])
    c = Vector(center)
    return all((c - loc).length > radius + pad for loc in _CAM_LOCS)

def _cam_frustum_test(center, radius, p_samples, margin=1.5):
    """True if a bounding sphere enters the camera frustum at ANY sampled progress.
    margin widens the FOV (reflections / soft shadows / safety)."""
    vfov = math.radians(34.0) * 0.5
    hfov = math.atan(math.tan(vfov) * (16.0 / 9.0))
    c = Vector(center)
    if c.length < 2.5:                                # near field always kept (reflections, shadows)
        return True
    for p in p_samples:
        loc, rot, _ = camera_matrix(p).decompose()
        v = c - loc
        z = -(v.dot(rot @ Vector((0.0, 0.0, 1.0))))   # camera looks down local -Z
        if z + radius <= 0.0:
            continue
        zz = max(z, 1e-4)
        ang_r = math.atan2(radius, zz)
        if (abs(math.atan2(v.dot(rot @ Vector((1.0, 0.0, 0.0))), zz)) < hfov * margin + ang_r and
                abs(math.atan2(v.dot(rot @ Vector((0.0, 1.0, 0.0))), zz)) < vfov * margin + ang_r):
            return True
    return False

# --- secondary motion (applied in Blender space during the bake) ---
BASE_LOCAL = Vector((0.0, 0.0, -0.125))   # bottle base center in bottle-local space

def apply_settle(loc, q, p):
    """Damped wobble about the base contact edge after the Greek touchdown."""
    if not CONFIG["settle_wobble"]:
        return loc, q
    t = p - LAND_P
    if t <= 0.0 or t > 0.13:
        return loc, q
    a = math.radians(2.1) * math.exp(-t / 0.028) * math.sin(2 * PI * t / 0.047)
    base_w = loc + q @ BASE_LOCAL
    q2 = Quaternion((1, 0, 0), a) @ q
    return base_w - q2 @ BASE_LOCAL, q2

def apply_sway(loc, q, p):
    """Gentle current drift while resting submerged."""
    if not CONFIG["underwater_sway"]:
        return loc, q
    w = sstep(0.505, 0.55, p) * (1.0 - sstep(0.66, 0.71, p))   # carries through to the rise beat
    if w <= 0.0:
        return loc, q
    # purely oscillatory (mean ~0) so it fades out with no jerk as the rise takes over
    a = math.radians(0.9) * math.sin((p - 0.5) * 2 * PI / 0.080) * w
    bob = 0.006 * math.sin((p - 0.5) * 2 * PI / 0.052) * w
    return loc + Vector((0.0, 0.0, bob)), Quaternion((0, 1, 0), a) @ q

def apply_plunge(loc, q, p):
    """Water-entry follow-through: the topple's angular momentum keeps the
    bottle turning a few degrees as it pierces the surface, then the water
    damps it out. Fully decayed before the Greek launch (p≈0.65), so the rest
    pose and every downstream anchor stay put. Starts at 0 → no jump in."""
    if not CONFIG["entry_followthrough"]:
        return loc, q
    t = p - 0.487                      # ≈ the moment the nose crosses the surface
    if t <= 0.0 or t > 0.16:
        return loc, q
    env = math.exp(-t / 0.05)
    a  = math.radians(5.0) * env * math.sin(2.0 * PI * t / 0.08)   # damped over-rotation (tip axis)
    dz = -0.028 * env * math.sin(PI * clamp(t / 0.16, 0.0, 1.0))   # a brief sink as momentum bleeds
    q2 = Quaternion((1, 0, 0), a) @ q
    return loc + Vector((0.0, 0.0, dz)), q2

def cam_handheld(loc, quat, p):
    """A whisper of handheld drift so held camera frames never read as frozen.
    Sub-2 mm, deterministic, calmed during the fast underwater roll so it never
    fights the staging."""
    if not CONFIG["cam_handheld"]:
        return loc, quat
    t = p * CONFIG["frames"] / max(CONFIG["fps"], 1)     # seconds along the shot
    calm = 1.0 - 0.7 * underwater_win(p)
    off = Vector((
        0.0016 * math.sin(t * 1.7 + 0.4) + 0.0009 * math.sin(t * 3.1 + 1.9),
        0.0013 * math.sin(t * 1.3 + 1.1),
        0.0011 * math.sin(t * 2.3 + 2.0),
    )) * calm
    return loc + off, quat

# ==============================================================================
#  COLOR / NODE / MESH HELPERS
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

def setp(ob, name, value):
    """Set an RNA property if it exists (version-tolerant)."""
    try:
        if hasattr(ob, name):
            setattr(ob, name, value)
            return True
    except Exception:
        pass
    return False

def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree.nodes, m.node_tree.links

def clear_default_bsdf(nodes, links):
    out = None
    for n in list(nodes):
        if n.type == "OUTPUT_MATERIAL":
            out = n
        elif n.type == "BSDF_PRINCIPLED":
            nodes.remove(n)
    if out is None:
        out = nodes.new("ShaderNodeOutputMaterial")
    return out

def obj_from_bm(bm, name, coll, smooth=True, recalc=True):
    if recalc:
        try:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        except Exception:
            pass
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    if smooth:
        for pg in me.polygons:
            pg.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob

def obj_from_pydata(name, verts, faces, coll, smooth=True, recalc=True):
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    bm.verts.ensure_lookup_table()
    for f in faces:
        try:
            bm.faces.new([vs[i] for i in f])
        except Exception:
            pass
    return obj_from_bm(bm, name, coll, smooth=smooth, recalc=recalc)

def lathe(profile_rz, segments):
    """Revolve a (radius, z) profile around Z -> (verts, faces)."""
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

def tube(radius, z0, z1, segments):
    verts, faces = [], []
    for j in range(segments + 1):
        ang = 2.0 * PI * j / segments
        c, s = math.cos(ang), math.sin(ang)
        verts.append((radius * c, radius * s, z0))
        verts.append((radius * c, radius * s, z1))
    for j in range(segments):
        a = 2 * j; b = 2 * j + 1; c = 2 * j + 3; d = 2 * j + 2
        faces.append((a, d, c, b))
    return verts, faces

def add_uvsphere_into(bm, center, radius, u=8, v=6, squash=None):
    try:
        res = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=radius)
    except TypeError:
        res = bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, diameter=radius * 2.0)
    for vert in res["verts"]:
        if squash:
            vert.co = Vector((vert.co.x * squash[0], vert.co.y * squash[1], vert.co.z * squash[2]))
        vert.co += Vector(center)
    return res

def make_collection(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c

def frame_of(p, frames):
    return 1 + int(round(p * frames))

# ==============================================================================
#  RESET + ASSETS
# ==============================================================================
def purge_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for blocks in (bpy.data.meshes, bpy.data.materials, bpy.data.textures,
                   bpy.data.images, bpy.data.node_groups, bpy.data.lights,
                   bpy.data.cameras, bpy.data.particles, bpy.data.actions,
                   bpy.data.curves, bpy.data.worlds):
        for b in list(blocks):
            try: blocks.remove(b)
            except Exception: pass

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
    # last resort: common download/unzip locations
    home = os.path.expanduser("~")
    for base in ("Downloads", "Desktop", "Documents"):
        candidates.append(os.path.join(home, base, "blender", "assets"))
        candidates.append(os.path.join(home, base, "assets"))
    for d in candidates:
        if d and os.path.isdir(d) and (
            os.path.isfile(os.path.join(d, CONFIG["bottle_glb_name"]))
            or os.path.isfile(os.path.join(d, CONFIG["bg_japan_name"]))
            or os.path.isfile(os.path.join(d, CONFIG["label_img_name"]))
        ):
            return d
    return ""

# ==============================================================================
#  WORLD — physical sky (morning -> golden hour) + aerial haze + clouds
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
    setp(sky, "sky_type", "NISHITA")          # gone in 4.5+ (single model) — harmless
    sky.sun_elevation = math.radians(14.0)
    sky.sun_rotation  = math.radians(20.0)
    setp(sky, "altitude", 40.0)
    setp(sky, "air_density", 1.15)
    setp(sky, "dust_density", 1.7)
    setp(sky, "ozone_density", 1.0)
    setp(sky, "sun_intensity", 1.0)           # the sky's own sun is THE key light
    setp(sky, "sun_size", math.radians(0.9))
    bg.inputs["Strength"].default_value = 0.4   # Nishita is stops brighter than the display-referred backdrop art — dim it so sky-lit geometry matches the plates
    nt.links.new(sky.outputs[0], bg.inputs["Color"])
    nt.links.new(bg.outputs[0], out.inputs["Surface"])
    return {"sky": sky, "bg": bg, "world": world}

def build_atmosphere(coll):
    """Very thin height-falloff scatter above the sea: aerial perspective +
    visible shafts near the horizon. Sits ABOVE the water only."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    ob = obj_from_bm(bm, "Atmosphere", coll, smooth=False, recalc=False)
    ob.scale = (900.0, 900.0, 130.0)
    ob.location = (0.0, 0.0, 65.05)           # z 0.05 .. 130 — never below the surface
    ob.display_type = "WIRE"

    mat, nodes, links = new_mat("Atmosphere")
    out = clear_default_bsdf(nodes, links)
    scat = nodes.new("ShaderNodeVolumeScatter")
    scat.inputs["Color"].default_value = (0.75, 0.82, 0.88, 1.0)
    set_in(scat, "Anisotropy", 0.55)
    # density falls off with height: thick near the waterline, gone up high
    geo = nodes.new("ShaderNodeNewGeometry")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    mr  = nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.0
    mr.inputs["From Max"].default_value = 120.0
    mr.inputs["To Min"].default_value = 0.0035
    mr.inputs["To Max"].default_value = 0.0
    links.new(geo.outputs["Position"], sep.inputs["Vector"])
    links.new(sep.outputs["Z"], mr.inputs["Value"])
    links.new(mr.outputs["Result"], scat.inputs["Density"])
    links.new(scat.outputs[0], out.inputs["Volume"])
    ob.data.materials.append(mat)
    return ob

def build_clouds(coll):
    bm = bmesh.new()
    try:
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1600.0)
    except TypeError:
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1600.0, calc_uvs=True)
    ob = obj_from_bm(bm, "Clouds", coll, smooth=False, recalc=False)
    ob.location = (0.0, -300.0, 340.0)

    mat, nodes, links = new_mat("Clouds")
    out = clear_default_bsdf(nodes, links)
    trans = nodes.new("ShaderNodeBsdfTransparent")
    cloud = nodes.new("ShaderNodeBsdfTranslucent")
    cloud.inputs["Color"].default_value = (1.0, 0.99, 0.97, 1.0)
    mix = nodes.new("ShaderNodeMixShader")
    coord = nodes.new("ShaderNodeTexCoord")
    cmap  = nodes.new("ShaderNodeMapping")
    n1 = nodes.new("ShaderNodeTexNoise")
    n1.inputs["Scale"].default_value = 2.6
    set_in(n1, "Detail", 8.0)
    set_in(n1, "Roughness", 0.62)
    ramp = nodes.new("ShaderNodeValToRGB")
    try:
        ramp.color_ramp.elements[0].position = 0.58   # mostly clear sky
        ramp.color_ramp.elements[1].position = 0.78
    except Exception:
        pass
    links.new(coord.outputs["Object"], cmap.inputs["Vector"])
    links.new(cmap.outputs["Vector"], n1.inputs["Vector"])
    links.new(n1.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], mix.inputs["Fac"])
    links.new(trans.outputs[0], mix.inputs[1])
    links.new(cloud.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs["Surface"])
    setp(mat, "blend_method", "HASHED")
    ob.data.materials.append(mat)
    # exclude from shadow rays so clouds never dapple the set
    setp(ob, "visible_shadow", False)
    return {"obj": ob, "map": cmap}

def build_backdrop(coll, cam, q, img_j, img_g, img_u, img_jl="", img_gl=""):
    """Photo backgrounds. CONFIG["backdrop_mode"]:
      "curve"  - one smooth cyclorama sweeping from the bay (front) around to
                 the camera-left side. The front photo (bg_japan / bg_greece)
                 and the side photo (bg_japan_left / bg_greece_left) sit on
                 the curve at their TRUE proportions (fitted to wall height)
                 and crossfade into each other where they meet - no corner,
                 no visible seam.
      "camera" - card parented to the camera; always fills the frame.
    Japan -> Greece crossfades at the swap; the underwater plate takes over
    while submerged (keys added in the bake)."""
    mode = CONFIG.get("backdrop_mode", "curve")

    mat, nodes, links = new_mat("Backdrop")
    out = clear_default_bsdf(nodes, links)
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 8.0   # compensates the -3 EV film exposure (2^3)
    uvco = nodes.new("ShaderNodeTexCoord")

    def tex_mapped(path, sx, sy, lx, ly):
        img = bpy.data.images.load(path, check_existing=True)
        t = nodes.new("ShaderNodeTexImage")
        t.image = img
        t.extension = "EXTEND"
        mp = nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (sx, sy, 1.0)
        mp.inputs["Location"].default_value = (lx, ly, 0.0)
        links.new(uvco.outputs["UV"], mp.inputs["Vector"])
        links.new(mp.outputs["Vector"], t.inputs["Vector"])
        return t

    def aspect(path):
        img = bpy.data.images.load(path, check_existing=True)
        return img.size[0] / max(img.size[1], 1)

    if mode == "camera":
        D = 500.0
        card_h = 2.0 * D * math.tan(math.radians(34.0) / 2.0) * 1.18
        card_w = card_h * (q["rx"] / q["ry"])
        ac = card_w / card_h
        bm = bmesh.new()
        try:
            bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0, calc_uvs=True)
        except TypeError:
            bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0)
        for v in bm.verts:
            v.co.x *= card_w * 0.5
            v.co.y *= card_h * 0.5
        ob = obj_from_bm(bm, "Backdrop", coll, smooth=False, recalc=False)
        ob.parent = cam
        ob.location = (0.0, 0.0, -D)

        def cover_color(path):
            if not path:
                return None
            ai = aspect(path)
            if ai > ac:
                sx, sy = ac / ai, 1.0
            else:
                sx, sy = 1.0, ai / ac
            t = tex_mapped(path, sx, sy, (1.0 - sx) * 0.5, (1.0 - sy) * 0.5)
            return t.outputs["Color"]

        colJ = cover_color(img_j)
        colG = cover_color(img_g)
        colU = cover_color(img_u)
    else:
        # smooth cyclorama: sweeps from behind-right (-185 deg), through the
        # bay (-90 deg = front), around the camera-left side (0 deg = +X).
        R, H_w, z0 = 120.0, 100.0, -45.0
        a0, a1 = math.radians(-185.0), math.radians(95.0)
        seg = 96
        verts, faces = [], []
        for j in range(seg + 1):
            a = a0 + (a1 - a0) * j / seg
            verts.append((math.cos(a) * R, math.sin(a) * R, z0))
            verts.append((math.cos(a) * R, math.sin(a) * R, z0 + H_w))
        for j in range(seg):
            aa = 2 * j; bb = 2 * j + 1; cc = 2 * j + 3; dd = 2 * j + 2
            faces.append((aa, dd, cc, bb))
        ob = obj_from_pydata("Backdrop", verts, faces, coll, smooth=True, recalc=False)
        me = ob.data
        me.uv_layers.new(name="UVMap")
        uvl = me.uv_layers.active.data
        u_span = R * (a1 - a0) / H_w          # arc length in wall-height units
        li = 0
        for poly in me.polygons:
            for loop_i in poly.loop_indices:
                vi = me.loops[loop_i].vertex_index
                ring = vi // 2
                uvl[li].uv = (u_span * ring / seg, float(vi % 2))
                li += 1

        u_front = R * (math.radians(-90.0) - a0) / H_w   # front panel center
        u_left  = R * (math.radians(CONFIG.get("left_panel_angle", -12.0)) - a0) / H_w
        usep = nodes.new("ShaderNodeSeparateXYZ")
        links.new(uvco.outputs["UV"], usep.inputs["Vector"])

        def panel(path, center_u, zoom=1.0, hcompress=1.0, vshift=0.0):
            # photo at true proportions (width = aspect * height); u mirrored
            # so the picture reads correctly from INSIDE the curve. zoom > 1
            # cover-scales the plate (wider wall coverage, vertical crop).
            # hcompress > 1 squeezes the photo into a NARROWER arc (full height
            # kept) so more of a wide pano lands inside the 34/57 deg lens.
            # vshift > 0 slides the photo UP the wall (raises it in frame).
            ai = aspect(path) * zoom
            arc = ai / hcompress
            t = tex_mapped(path, -hcompress / ai, 1.0 / zoom, 0.5 + hcompress * center_u / ai, (1.0 - 1.0 / zoom) * 0.5 - vshift)
            return t.outputs["Color"], arc

        def grad(top_hex, bot_hex):
            ramp = nodes.new("ShaderNodeValToRGB")
            try:
                ramp.color_ramp.elements[0].position = 0.15
                ramp.color_ramp.elements[0].color = hexlin(bot_hex)
                ramp.color_ramp.elements[1].position = 0.75
                ramp.color_ramp.elements[1].color = hexlin(top_hex)
            except Exception:
                pass
            links.new(usep.outputs["Y"], ramp.inputs["Fac"])
            return ramp.outputs["Color"]

        def window(u_lo, u_hi):
            # 1 inside the photo span, feathered to 0 outside — kills edge smear
            mlo = nodes.new("ShaderNodeMapRange")
            setp(mlo, "interpolation_type", "SMOOTHSTEP")
            mlo.inputs["From Min"].default_value = u_lo - 0.02
            mlo.inputs["From Max"].default_value = u_lo + 0.30
            links.new(usep.outputs["X"], mlo.inputs["Value"])
            mhi = nodes.new("ShaderNodeMapRange")
            setp(mhi, "interpolation_type", "SMOOTHSTEP")
            mhi.inputs["From Min"].default_value = u_hi - 0.30
            mhi.inputs["From Max"].default_value = u_hi + 0.02
            mhi.inputs["To Min"].default_value = 1.0
            mhi.inputs["To Max"].default_value = 0.0
            links.new(usep.outputs["X"], mhi.inputs["Value"])
            mul = nodes.new("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            links.new(mlo.outputs["Result"], mul.inputs[0])
            links.new(mhi.outputs["Result"], mul.inputs[1])
            return mul.outputs[0]

        def act_color(path_front, path_left, top_hex, bot_hex, u_side=None, zoom_side=1.0, front_hcompress=1.0, side_vshift=0.0, front_zoom=1.0):
            """Each photo composites over a soft sky gradient inside its own
            feathered window — works whether the side plate sits beside the
            front plate (Japan) or on the OPPOSITE wall (Greece side profile).
            front_hcompress > 1 squeezes the FRONT plate into a narrower arc so a
            wide 180 pano shows more of its width (framing) inside the lens.
            side_vshift > 0 raises the SIDE plate up the wall (in frame)."""
            if not path_front and not path_left:
                return None
            out_c = grad(top_hex, bot_hex)
            us = u_left if u_side is None else u_side
            panels = []
            if path_front:
                panels.append((path_front, u_front, front_zoom, front_hcompress, 0.0))
            if path_left:
                panels.append((path_left, us, zoom_side, 1.0, side_vshift))
            for path, center, zm, hc, vs in panels:
                pc, aw = panel(path, center, zm, hc, vs)
                w = window(center - aw * 0.5, center + aw * 0.5)
                mixw = nodes.new("ShaderNodeMixRGB")
                links.new(w, mixw.inputs["Fac"])
                links.new(out_c, mixw.inputs["Color1"])
                links.new(pc, mixw.inputs["Color2"])
                out_c = mixw.outputs["Color"]
            return out_c

        # Greece side plate: same wall zone as Japan's but shifted a few degrees so
        # its coverage spans the whole frame from the mirrored (3:00) rise camera
        u_left_G = R * (math.radians(CONFIG.get("greece_side_angle", -5.0)) - a0) / H_w
        colJ = act_color(img_j, img_jl, HEX["horJ"], "#8fa9b4", front_hcompress=CONFIG.get("bg_japan_hcompress", 1.0), side_vshift=CONFIG.get("bg_japan_left_lift", 0.0), front_zoom=CONFIG.get("bg_japan_zoom", 1.0))
        colG = act_color(img_g, img_gl, "#f6e3c4", "#eecf9e", u_side=u_left_G, zoom_side=1.45)   # cover-zoomed: full-frame coverage from the mirrored rise camera
        colU = act_color(img_u, img_u, "#2e5a66", "#0e2b31") if img_u else None   # BOTH walls: the submerged camera looks INLAND (3:00) — seaward-only was never on camera

    # ---- act mixing (shared by both modes) ----
    fac = None
    solo = None
    color_out = None
    if colJ is not None and colG is not None:
        mixn = nodes.new("ShaderNodeMixRGB")
        links.new(colJ, mixn.inputs["Color1"])
        links.new(colG, mixn.inputs["Color2"])
        color_out = mixn.outputs["Color"]
        fac = mixn.inputs["Fac"]
    elif colJ is not None or colG is not None:
        color_out = colJ if colJ is not None else colG
        solo = "J" if colJ is not None else "G"
    ufac = None
    if colU is not None:
        if color_out is None:
            color_out = colU
        else:
            umix = nodes.new("ShaderNodeMixRGB")
            links.new(color_out, umix.inputs["Color1"])
            links.new(colU, umix.inputs["Color2"])
            color_out = umix.outputs["Color"]
            ufac = umix.inputs["Fac"]
    links.new(color_out, em.inputs["Color"])
    links.new(em.outputs[0], out.inputs["Surface"])
    ob.data.materials.append(mat)
    for attr in ("visible_diffuse", "visible_shadow", "visible_volume_scatter"):
        setp(ob, attr, False)
    setp(ob, "visible_glossy", True)   # reflections see the ART (dark trees, Fuji) — the lake mirrors the scene, not a blank bright dome
    return {"walls": [{"obj": ob, "strength": em.inputs["Strength"],
                       "fac": fac, "ufac": ufac, "solo": solo}]}

# ==============================================================================
#  LIGHTS — sun fill, underwater point, god-ray gobo, bottle rim
# ==============================================================================
def build_lights(coll, C_bottle):
    # warm directional fill that shadows with the sky sun (sky disc is the key)
    sd = bpy.data.lights.new("SunFill", "SUN")
    sd.energy = 2.6   # compensates the dimmed sky — keeps the sun's shape and warmth
    sd.angle  = math.radians(1.2)
    sd.color  = hexlin(HEX["sunJ"])[:3]
    sun = bpy.data.objects.new("SunFill", sd)
    sun.rotation_euler = Euler((math.radians(76.0), 0.0, math.radians(20.0)), "XYZ")
    coll.objects.link(sun)

    ud = bpy.data.lights.new("UW_Light", "POINT")
    ud.energy = 0.0
    ud.color  = hexlin(HEX["uwlight"])[:3]
    ud.shadow_soft_size = 0.5
    uw = bpy.data.objects.new("UW_Light", ud)
    uw.location = T2B((0.12, 0.0, 0.17))   # sit the fill light ON the water surface (was floating just under it)
    coll.objects.link(uw)

    gobo = None
    if CONFIG["build_gobo"]:
        gd = bpy.data.lights.new("Gobo", "SPOT")
        gd.energy = 0.0
        gd.color = hexlin("#bfe7ee")[:3]
        gd.spot_size = math.radians(85.0)
        gd.spot_blend = 1.0
        gd.shadow_soft_size = 0.4
        try:
            gd.use_nodes = True
            nt = gd.node_tree
            emit = next((n for n in nt.nodes if n.type == "EMISSION"), None)
            if emit is None:
                emit = nt.nodes.new("ShaderNodeEmission")
                out = next((n for n in nt.nodes if n.type == "OUTPUT_LIGHT"), None) or nt.nodes.new("ShaderNodeOutputLight")
                nt.links.new(emit.outputs[0], out.inputs["Surface"])
            coord = nt.nodes.new("ShaderNodeTexCoord")
            gmap  = nt.nodes.new("ShaderNodeMapping")
            gn    = nt.nodes.new("ShaderNodeTexNoise")
            gn.inputs["Scale"].default_value = 3.0
            gramp = nt.nodes.new("ShaderNodeValToRGB")
            try:
                gramp.color_ramp.elements[0].position = 0.42
                gramp.color_ramp.elements[1].position = 0.75
            except Exception:
                pass
            nt.links.new(coord.outputs["Normal"], gmap.inputs["Vector"])
            nt.links.new(gmap.outputs["Vector"], gn.inputs["Vector"])
            nt.links.new(gn.outputs["Fac"], gramp.inputs["Fac"])
            nt.links.new(gramp.outputs["Color"], emit.inputs["Strength"])
            gobo_map = gmap
        except Exception:
            gobo_map = None
        gob = bpy.data.objects.new("Gobo", gd)
        gob.location = (0.0, -0.25, -0.2)      # SUBMERGED god-ray projector — beams never cross the refractive surface
        coll.objects.link(gob)
        gobo = {"obj": gob, "data": gd, "map": gobo_map}

    rim = None
    if CONFIG["build_rim"]:
        rd = bpy.data.lights.new("Rim", "AREA")
        rd.energy = 0.0
        rd.size = 0.6
        rd.color = hexlin("#eaf4f6")[:3]
        rob = bpy.data.objects.new("Rim", rd)
        rob.location = (0.55, -0.55, 0.42)
        coll.objects.link(rob)
        con = rob.constraints.new("TRACK_TO")
        # target assigned later (bottle ctrl)
        rim = {"obj": rob, "data": rd, "con": con}
        # light-link the rim to the bottle only (Blender 4.x+, Cycles)
        try:
            rob.light_linking.receiver_collection = C_bottle
        except Exception:
            rim["linked"] = False
    return {"sun_obj": sun, "sun_data": sd, "uw_obj": uw, "uw_data": ud,
            "gobo": gobo, "rim": rim}

# ==============================================================================
#  OCEAN — FFT swell + foam + contact foam + scrolling micro-detail
# ==============================================================================
def build_ocean(coll, q):
    bm = bmesh.new()
    try:
        bmesh.ops.create_grid(bm, x_segments=2, y_segments=2, size=1.0)
    except TypeError:
        bmesh.ops.create_grid(bm, x_segments=2, y_segments=2, size=1.0, calc_uvs=True)
    ob = obj_from_bm(bm, "Ocean", coll, smooth=True, recalc=False)

    mod = ob.modifiers.new("Ocean", "OCEAN")
    # all guarded so ONE renamed property in 4.5 can't kill the whole ocean (= "no water")
    setp(mod, "geometry_mode",  "GENERATE")
    setp(mod, "spatial_size",   CONFIG["ocean_spatial"])
    setp(mod, "repeat_x",       CONFIG["ocean_repeat"])
    setp(mod, "repeat_y",       CONFIG["ocean_repeat"])
    setp(mod, "wave_scale",     CONFIG["ocean_wave_scale"])
    setp(mod, "choppiness",     CONFIG["ocean_choppiness"])
    setp(mod, "wind_velocity",  CONFIG["ocean_wind"])
    setp(mod, "wave_alignment", 0.55)
    setp(mod, "smallest_wave",  CONFIG["ocean_smallest"])
    setp(mod, "random_seed",    7)
    setp(mod, "resolution", q["ores"])
    setp(mod, "viewport_resolution", 4)        # tiny FFT while scrubbing (fast); full q["ores"] only on render
    setp(mod, "use_foam", True)
    setp(mod, "foam_coverage", CONFIG["ocean_foam"])
    setp(mod, "foam_layer_name", "foam")
    setp(mod, "use_spray", True)

    mat, nodes, links = new_mat("Water")
    out = clear_default_bsdf(nodes, links)
    water = nodes.new("ShaderNodeBsdfPrincipled")
    set_in(water, "Base Color", hexlin(HEX["deepJ"]))
    set_in(water, "Roughness", 0.045)
    set_in(water, "IOR", 1.333)
    set_in(water, ["Transmission Weight", "Transmission"], 1.0)   # REAL water: sun + god-rays penetrate, the over-under reads
    set_in(water, ["Specular IOR Level", "Specular"], 0.5)        # (opaque water blacked out the entire underwater world)
    setp(mat, "use_screen_refraction", True)                      # EEVEE viewport shows refraction instead of vanishing

    # scrolling micro-normal detail (two opposed noise layers; baked to keyframes)
    coord = nodes.new("ShaderNodeTexCoord")
    m1 = nodes.new("ShaderNodeMapping"); m2 = nodes.new("ShaderNodeMapping")
    n1 = nodes.new("ShaderNodeTexNoise"); n1.inputs["Scale"].default_value = 16.0   # broad undulation —
    n2 = nodes.new("ShaderNodeTexNoise"); n2.inputs["Scale"].default_value = 34.0   # fine frosting killed the Fuji mirror
    mixn = nodes.new("ShaderNodeMix") if hasattr(bpy.types, "ShaderNodeMix") else nodes.new("ShaderNodeMixRGB")
    try:
        mixn.data_type = "RGBA"
    except Exception:
        pass
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.10   # texture without shattering distant reflections (Fuji mirror)
    links.new(coord.outputs["Object"], m1.inputs["Vector"])
    links.new(coord.outputs["Object"], m2.inputs["Vector"])
    links.new(m1.outputs["Vector"], n1.inputs["Vector"])
    links.new(m2.outputs["Vector"], n2.inputs["Vector"])
    # feed one layer through Bump; second layer adds via Height mix if possible
    try:
        links.new(n1.outputs["Fac"], mixn.inputs[6] if mixn.bl_idname == "ShaderNodeMix" else mixn.inputs["Color1"])
        links.new(n2.outputs["Fac"], mixn.inputs[7] if mixn.bl_idname == "ShaderNodeMix" else mixn.inputs["Color2"])
        outsock = mixn.outputs[2] if mixn.bl_idname == "ShaderNodeMix" else mixn.outputs["Color"]
        links.new(outsock, bump.inputs["Height"])
    except Exception:
        links.new(n1.outputs["Fac"], bump.inputs["Height"])
    # ---- IMPACT RIPPLES: physical expanding rings from the splash point, keyed in the bake ----
    # ripple(r) = amp * sin((r - phase) * K) * exp(-2.5 r): a ring front that travels
    # outward and decays with distance — real water physics, not an emission halo.
    rip_phase = nodes.new("ShaderNodeValue"); rip_phase.name = "RipplePhase"; rip_phase.outputs[0].default_value = 0.0
    rip_amp   = nodes.new("ShaderNodeValue"); rip_amp.name = "RippleAmp"; rip_amp.outputs[0].default_value = 0.0
    rdist = nodes.new("ShaderNodeVectorMath"); rdist.operation = "DISTANCE"
    rdist.inputs[1].default_value = (0.0, -0.15, 0.0)          # entry point on the surface
    rsub = nodes.new("ShaderNodeMath"); rsub.operation = "SUBTRACT"
    rmul = nodes.new("ShaderNodeMath"); rmul.operation = "MULTIPLY"
    rmul.inputs[1].default_value = 40.0                        # ring wavelength ~16 cm
    rsin = nodes.new("ShaderNodeMath"); rsin.operation = "SINE"
    ratt = nodes.new("ShaderNodeMath"); ratt.operation = "MULTIPLY"
    ratt.inputs[1].default_value = -2.5
    rexp = nodes.new("ShaderNodeMath"); rexp.operation = "EXPONENT"
    rm1 = nodes.new("ShaderNodeMath"); rm1.operation = "MULTIPLY"
    rm2 = nodes.new("ShaderNodeMath"); rm2.operation = "MULTIPLY"; rm2.name = "RippleField"
    rbump = nodes.new("ShaderNodeBump"); rbump.name = "RippleBump"; rbump.inputs["Strength"].default_value = 1.0
    links.new(coord.outputs["Object"], rdist.inputs[0])
    links.new(rdist.outputs["Value"], rsub.inputs[0])
    links.new(rip_phase.outputs[0], rsub.inputs[1])
    links.new(rsub.outputs[0], rmul.inputs[0])
    links.new(rmul.outputs[0], rsin.inputs[0])
    links.new(rdist.outputs["Value"], ratt.inputs[0])
    links.new(ratt.outputs[0], rexp.inputs[0])
    links.new(rsin.outputs[0], rm1.inputs[0])
    links.new(rexp.outputs[0], rm1.inputs[1])
    links.new(rm1.outputs[0], rm2.inputs[0])
    links.new(rip_amp.outputs[0], rm2.inputs[1])
    links.new(rm2.outputs[0], rbump.inputs["Height"])
    links.new(bump.outputs["Normal"], rbump.inputs["Normal"])  # chain onto the ambient detail
    links.new(rbump.outputs["Normal"], water.inputs["Normal"])

    # foam: ocean foam attribute MAX contact-foam (AO senses rocks/bottle at the line)
    foam = nodes.new("ShaderNodeBsdfPrincipled")
    set_in(foam, "Base Color", hexlin(HEX["foam"]))
    set_in(foam, "Roughness", 0.55)
    attr = nodes.new("ShaderNodeAttribute")
    attr.attribute_name = "foam"
    ao = nodes.new("ShaderNodeAmbientOcclusion")
    set_in(ao, "Distance", 0.09)
    aoinv = nodes.new("ShaderNodeMath"); aoinv.operation = "SUBTRACT"
    aoinv.inputs[0].default_value = 1.0
    aopow = nodes.new("ShaderNodeMath"); aopow.operation = "POWER"
    aopow.inputs[1].default_value = 2.2
    fmax = nodes.new("ShaderNodeMath"); fmax.operation = "MAXIMUM"
    ramp = nodes.new("ShaderNodeValToRGB")
    try:
        ramp.color_ramp.elements[0].position = 0.06
        ramp.color_ramp.elements[1].position = 0.55
    except Exception:
        pass
    mixsh = nodes.new("ShaderNodeMixShader")
    links.new(ao.outputs["AO"], aoinv.inputs[1])
    links.new(aoinv.outputs[0], aopow.inputs[0])
    links.new(attr.outputs["Fac"], fmax.inputs[0])
    links.new(aopow.outputs[0], fmax.inputs[1])
    links.new(fmax.outputs[0], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], mixsh.inputs["Fac"])
    links.new(water.outputs[0], mixsh.inputs[1])
    links.new(foam.outputs[0], mixsh.inputs[2])
    links.new(mixsh.outputs[0], out.inputs["Surface"])
    ob.data.materials.append(mat)

    # light passes the surface unimpeded (sun/sky reach the lakebed) — refracted-light
    # paths are caustics Cycles can't sample, so shadow-transparent water is THE way
    # to get a lit underwater world. Camera rays still reflect/refract normally.
    setp(ob, "visible_shadow", False)
    if CONFIG["true_caustics"]:
        for attr_name in ("is_caustics_caster",):
            if not setp(ob, attr_name, True):
                try: setattr(ob.cycles, attr_name, True)
                except Exception: pass
    return {"obj": ob, "mod": mod, "mat": mat, "water_bsdf": water,
            "detail_maps": (m1, m2),
            "ripple": {"phase": rip_phase.outputs[0], "amp": rip_amp.outputs[0]}}

# ==============================================================================
#  SEABED — rippled sand + dual-layer animated caustics + scattered stones
# ==============================================================================
def build_seabed(coll):
    seg = 140
    bm = bmesh.new()
    try:
        bmesh.ops.create_grid(bm, x_segments=seg, y_segments=seg, size=20.0)
    except TypeError:
        bmesh.ops.create_grid(bm, x_segments=seg, y_segments=seg, size=20.0, calc_uvs=True)
    for v in bm.verts:
        x, y = v.co.x, v.co.y
        h  = 0.35 * math.sin(x * 0.5 + 1.3) * math.cos(y * 0.42 + 0.7)
        h += 0.12 * math.sin(x * 1.7 + y * 1.3)
        h += 0.03 * math.sin(x * 6.0 + 0.5) * math.sin(y * 5.3)
        h += 0.012 * math.sin(x * 14.0 + y * 2.0)          # sand ripple crests
        v.co.z += h
    ob = obj_from_bm(bm, "Seabed", coll, smooth=True, recalc=False)
    ob.location = (0.0, 0.0, -3.4)   # reference-depth lakebed (~3 m): dawn light actually reaches it

    mat, nodes, links = new_mat("Seabed")
    out = clear_default_bsdf(nodes, links)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    set_in(bsdf, "Roughness", 0.95)
    ncoord = nodes.new("ShaderNodeTexCoord")
    # sediment color variation
    cvar = nodes.new("ShaderNodeTexNoise"); cvar.inputs["Scale"].default_value = 1.1
    cramp0 = nodes.new("ShaderNodeValToRGB")
    try:
        cramp0.color_ramp.elements[0].color = hexlin("#9a8a6d")
        cramp0.color_ramp.elements[1].color = hexlin(HEX["sand"])
    except Exception:
        pass
    links.new(ncoord.outputs["Object"], cvar.inputs["Vector"])
    links.new(cvar.outputs["Fac"], cramp0.inputs["Fac"])
    links.new(cramp0.outputs["Color"], bsdf.inputs["Base Color"])
    # micro bump: grain + anisotropic ripples
    nnoise = nodes.new("ShaderNodeTexNoise"); nnoise.inputs["Scale"].default_value = 42.0
    wav = nodes.new("ShaderNodeTexWave")
    wav.inputs["Scale"].default_value = 3.2
    set_in(wav, "Distortion", 3.2)
    badd = nodes.new("ShaderNodeMath"); badd.operation = "ADD"
    nbump = nodes.new("ShaderNodeBump"); nbump.inputs["Strength"].default_value = 0.22
    links.new(ncoord.outputs["Object"], nnoise.inputs["Vector"])
    links.new(ncoord.outputs["Object"], wav.inputs["Vector"])
    links.new(nnoise.outputs["Fac"], badd.inputs[0])
    links.new(wav.outputs["Fac"], badd.inputs[1])
    links.new(badd.outputs[0], nbump.inputs["Height"])
    links.new(nbump.outputs["Normal"], bsdf.inputs["Normal"])

    caustic_nodes = None
    if CONFIG["build_caustics"]:
        # two voronoi webs scrolling against each other = living caustic net
        emit = nodes.new("ShaderNodeEmission")
        emit.inputs["Strength"].default_value = 0.0
        emit.inputs["Color"].default_value = (0.55, 0.92, 0.98, 1.0)
        cm1 = nodes.new("ShaderNodeMapping"); cm2 = nodes.new("ShaderNodeMapping")
        cv1 = nodes.new("ShaderNodeTexVoronoi"); cv1.feature = "SMOOTH_F1"
        cv1.inputs["Scale"].default_value = 3.2
        cv2 = nodes.new("ShaderNodeTexVoronoi"); cv2.feature = "SMOOTH_F1"
        cv2.inputs["Scale"].default_value = 4.6
        r1 = nodes.new("ShaderNodeValToRGB"); r2 = nodes.new("ShaderNodeValToRGB")
        for rr in (r1, r2):
            try:
                rr.color_ramp.elements[0].position = 0.52
                rr.color_ramp.elements[1].position = 0.82
            except Exception:
                pass
        cmul = nodes.new("ShaderNodeMath"); cmul.operation = "MULTIPLY"
        links.new(ncoord.outputs["Object"], cm1.inputs["Vector"])
        links.new(ncoord.outputs["Object"], cm2.inputs["Vector"])
        links.new(cm1.outputs["Vector"], cv1.inputs["Vector"])
        links.new(cm2.outputs["Vector"], cv2.inputs["Vector"])
        links.new(cv1.outputs["Distance"], r1.inputs["Fac"])
        links.new(cv2.outputs["Distance"], r2.inputs["Fac"])
        links.new(r1.outputs["Color"], cmul.inputs[0])
        links.new(r2.outputs["Color"], cmul.inputs[1])
        links.new(cmul.outputs[0], emit.inputs["Color"])
        addsh = nodes.new("ShaderNodeAddShader")
        links.new(bsdf.outputs[0], addsh.inputs[0])
        links.new(emit.outputs[0], addsh.inputs[1])
        links.new(addsh.outputs[0], out.inputs["Surface"])
        caustic_nodes = {"emit": emit, "map1": cm1, "map2": cm2}
    else:
        links.new(bsdf.outputs[0], out.inputs["Surface"])
    ob.data.materials.append(mat)

    if CONFIG["true_caustics"]:
        for attr_name in ("is_caustics_receiver",):
            if not setp(ob, attr_name, True):
                try: setattr(ob.cycles, attr_name, True)
                except Exception: pass
    return {"obj": ob, "mat": mat, "caustic": caustic_nodes}

# ==============================================================================
#  UNDERWATER CARD — the under-surface plate wrapped CLOSE to the camera.
#  The 120 m cyclorama is physically invisible underwater (any murk over 120 m
#  is opaque), so the submerged background must live a few meters out.
# ==============================================================================
def build_uwcard(coll, img_path, cam, q):
    """Camera-parented billboard 5 m out: the plate fills the submerged frame
    EXACTLY as composed (golden glow upper-right, rocks left). A world-space
    z-mask clips it at the waterline, so the dive reads as a true over-under
    split; emission strength is keyed to the underwater window in the bake."""
    D = 2.5                                                  # close: farther is murk-eaten
    card_h = 2.0 * D * math.tan(math.radians(34.0) / 2.0) * 1.3
    card_w = card_h * (q["rx"] / q["ry"])
    bm = bmesh.new()
    try:
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0, calc_uvs=True)
    except TypeError:
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0)
    for v in bm.verts:
        v.co.x *= card_w * 0.5
        v.co.y *= card_h * 0.5
    ob = obj_from_bm(bm, "UW_Card", coll, smooth=False, recalc=False)
    ob.display_type = "WIRE"   # viewport: wire only (the "grey block") — renders normally through the camera
    ob.parent = cam
    ob.location = (0.0, 0.0, -D)

    mat, nodes, links = new_mat("UW_Card")
    out = clear_default_bsdf(nodes, links)
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 0.0                # keyed: only glows while submerged
    img = bpy.data.images.load(img_path, check_existing=True)
    t = nodes.new("ShaderNodeTexImage"); t.image = img; t.extension = "EXTEND"
    # cover-fit the plate to the card
    ai = img.size[0] / max(img.size[1], 1)
    ac = card_w / card_h
    sx, sy = (ac / ai, 1.0) if ai > ac else (1.0, ai / ac)
    mp = nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (sx, sy, 1.0)
    mp.inputs["Location"].default_value = ((1.0 - sx) * 0.5, (1.0 - sy) * 0.5, 0.0)
    uvco = nodes.new("ShaderNodeTexCoord")
    links.new(uvco.outputs["UV"], mp.inputs["Vector"])
    links.new(mp.outputs["Vector"], t.inputs["Vector"])
    links.new(t.outputs["Color"], em.inputs["Color"])
    # world-space waterline clip: transparent above z=0 (over-under split on the dive)
    geo = nodes.new("ShaderNodeNewGeometry")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    mr = nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -0.015
    mr.inputs["From Max"].default_value = 0.0
    mr.inputs["To Min"].default_value = 1.0
    mr.inputs["To Max"].default_value = 0.0
    tr = nodes.new("ShaderNodeBsdfTransparent")
    mx = nodes.new("ShaderNodeMixShader")
    links.new(geo.outputs["Position"], sep.inputs["Vector"])
    links.new(sep.outputs["Z"], mr.inputs["Value"])
    links.new(mr.outputs["Result"], mx.inputs["Fac"])
    links.new(tr.outputs[0], mx.inputs[1])
    links.new(em.outputs[0], mx.inputs[2])
    links.new(mx.outputs[0], out.inputs["Surface"])
    setp(mat, "blend_method", "BLEND")
    ob.data.materials.append(mat)
    for attr in ("visible_diffuse", "visible_glossy", "visible_shadow", "visible_volume_scatter"):
        setp(ob, attr, False)                                # camera-only: never lights or reflects
    return {"obj": ob, "strength": em.inputs["Strength"]}

# ==============================================================================
#  UNDERWATER VOLUME — murk + base tint (top face just below the surface)
# ==============================================================================
def build_volume(coll):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    ob = obj_from_bm(bm, "UW_Volume", coll, smooth=False, recalc=False)
    ob.scale = (40.0, 40.0, 8.0)
    ob.location = (0.0, 0.0, -4.005)     # top ≈ -0.005: below the surface only
    ob.display_type = "WIRE"

    mat, nodes, links = new_mat("UW_Volume")
    out = clear_default_bsdf(nodes, links)
    scat = nodes.new("ShaderNodeVolumeScatter")
    scat.inputs["Color"].default_value = (0.10, 0.40, 0.37, 1.0)   # deep teal-green: god-ray shafts still read, but dark
    scat.inputs["Density"].default_value = 0.0
    set_in(scat, "Anisotropy", 0.55)                               # forward scatter -> stronger god-ray shafts
    absb = nodes.new("ShaderNodeVolumeAbsorption")
    absb.inputs["Color"].default_value = hexlin(HEX["murk"])       # #0e2b31 dark murk — darkening comes from absorption
    absb.inputs["Density"].default_value = 0.0
    addv = nodes.new("ShaderNodeAddShader")
    links.new(scat.outputs[0], addv.inputs[0])
    links.new(absb.outputs[0], addv.inputs[1])
    links.new(addv.outputs[0], out.inputs["Volume"])
    ob.data.materials.append(mat)
    return {"obj": ob, "scatter": scat, "absorption": absb}

# ==============================================================================
#  ROCK MATERIAL — wet-band waterline, strata (Greece), moss (Japan)
# ==============================================================================
def rock_mat(name, base_hex, strata=False, moss=False, bump_scale=14.0):
    mat, nodes, links = new_mat(name)
    out = clear_default_bsdf(nodes, links)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    set_in(bsdf, ["Specular IOR Level", "Specular"], 0.35)   # tame grazing-angle Fresnel so lit wet stone stays dark
    coord = nodes.new("ShaderNodeTexCoord")
    geo = nodes.new("ShaderNodeNewGeometry")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(geo.outputs["Position"], sep.inputs["Vector"])

    # ---- base color chain ----
    color_out = None
    base_rgb = nodes.new("ShaderNodeRGB")
    base_rgb.outputs[0].default_value = hexlin(base_hex)
    color_out = base_rgb.outputs[0]

    # mineral mottle — irregular lighter staining patches (lichen / leached minerals),
    # the thing that makes the reference rock read weathered instead of uniform
    mot = nodes.new("ShaderNodeTexNoise"); mot.inputs["Scale"].default_value = 2.3
    set_in(mot, "Detail", 6.0)
    set_in(mot, "Roughness", 0.7)
    mramp2 = nodes.new("ShaderNodeValToRGB")
    try:
        mramp2.color_ramp.elements[0].position = 0.52
        mramp2.color_ramp.elements[1].position = 0.72
    except Exception:
        pass
    lighter = tuple(min(1.0, c * 2.4) for c in hexlin(base_hex)[:3]) + (1.0,)
    motmix = nodes.new("ShaderNodeMixRGB")
    motmix.inputs["Color2"].default_value = lighter
    links.new(coord.outputs["Object"], mot.inputs["Vector"])
    links.new(mot.outputs["Fac"], mramp2.inputs["Fac"])
    links.new(mramp2.outputs["Color"], motmix.inputs["Fac"])
    links.new(color_out, motmix.inputs["Color1"])
    color_out = motmix.outputs["Color"]

    if strata:  # banded limestone
        wave = nodes.new("ShaderNodeTexWave")
        wave.inputs["Scale"].default_value = 3.6
        set_in(wave, "Distortion", 3.4)
        try:
            wave.bands_direction = "Z"
        except Exception:
            pass
        sramp = nodes.new("ShaderNodeValToRGB")
        try:
            sramp.color_ramp.elements[0].color = hexlin("#96876b")   # darker limestone bed
            sramp.color_ramp.elements[1].color = hexlin("#e7ddc8")   # bright sun-bleached bed
        except Exception:
            pass
        smix = nodes.new("ShaderNodeMixRGB"); smix.blend_type = "MIX"
        smix.inputs["Fac"].default_value = 0.3     # soft bedding tint — strong banding read as ribbed pods
        links.new(coord.outputs["Object"], wave.inputs["Vector"])
        links.new(wave.outputs["Fac"], sramp.inputs["Fac"])
        links.new(color_out, smix.inputs["Color1"])
        links.new(sramp.outputs["Color"], smix.inputs["Color2"])
        color_out = smix.outputs["Color"]

    if moss:    # up-facing damp moss patches
        nz = nodes.new("ShaderNodeSeparateXYZ")
        links.new(geo.outputs["Normal"], nz.inputs["Vector"])
        upmr = nodes.new("ShaderNodeMapRange")
        upmr.inputs["From Min"].default_value = 0.55
        upmr.inputs["From Max"].default_value = 0.95
        mnoise = nodes.new("ShaderNodeTexNoise"); mnoise.inputs["Scale"].default_value = 5.0
        mramp = nodes.new("ShaderNodeValToRGB")
        try:
            mramp.color_ramp.elements[0].position = 0.55
            mramp.color_ramp.elements[1].position = 0.72
        except Exception:
            pass
        mmul = nodes.new("ShaderNodeMath"); mmul.operation = "MULTIPLY"
        mossmix = nodes.new("ShaderNodeMixRGB")
        mossmix.inputs["Color2"].default_value = hexlin(HEX["moss"])
        links.new(nz.outputs["Z"], upmr.inputs["Value"])
        links.new(coord.outputs["Object"], mnoise.inputs["Vector"])
        links.new(mnoise.outputs["Fac"], mramp.inputs["Fac"])
        links.new(upmr.outputs["Result"], mmul.inputs[0])
        links.new(mramp.outputs["Color"], mmul.inputs[1])
        links.new(mmul.outputs[0], mossmix.inputs["Fac"])
        links.new(color_out, mossmix.inputs["Color1"])
        color_out = mossmix.outputs["Color"]

    # ---- wet band at the waterline: darker + glossier below z≈0.07 ----
    wet_mr = nodes.new("ShaderNodeMapRange")
    wet_mr.inputs["From Min"].default_value = 0.004   # soaked band hugs the waterline only —
    wet_mr.inputs["From Max"].default_value = 0.022   # the shelf TOP (z=0.03) stays dry & rough, so it can't mirror the sky
    wnoise = nodes.new("ShaderNodeTexNoise"); wnoise.inputs["Scale"].default_value = 8.0
    wadd = nodes.new("ShaderNodeMath"); wadd.operation = "MULTIPLY_ADD"
    wadd.inputs[1].default_value = 0.25
    wclamp = nodes.new("ShaderNodeClamp")
    links.new(sep.outputs["Z"], wet_mr.inputs["Value"])
    links.new(coord.outputs["Object"], wnoise.inputs["Vector"])
    links.new(wnoise.outputs["Fac"], wadd.inputs[0])
    links.new(wet_mr.outputs["Result"], wadd.inputs[2])
    links.new(wadd.outputs[0], wclamp.inputs["Value"])
    dry = wclamp.outputs["Result"]           # 0 = soaked, 1 = dry

    dark = nodes.new("ShaderNodeMixRGB"); dark.blend_type = "MULTIPLY"
    dark.inputs["Fac"].default_value = 1.0
    dark.inputs["Color2"].default_value = (0.30, 0.32, 0.34, 1.0)   # wet basalt goes properly DARK
    wetmix = nodes.new("ShaderNodeMixRGB")
    links.new(color_out, dark.inputs["Color1"])
    links.new(dry, wetmix.inputs["Fac"])
    links.new(dark.outputs["Color"], wetmix.inputs["Color1"])
    links.new(color_out, wetmix.inputs["Color2"])
    links.new(wetmix.outputs["Color"], bsdf.inputs["Base Color"])

    # roughness: dry break-up vs wet gloss
    rn = nodes.new("ShaderNodeTexNoise"); rn.inputs["Scale"].default_value = 6.0
    rramp = nodes.new("ShaderNodeValToRGB")
    try:
        rramp.color_ramp.elements[0].color = (0.62, 0.62, 0.62, 1)   # dry stone floor-roughness raised —
        rramp.color_ramp.elements[1].color = (0.95, 0.95, 0.95, 1)   # kills the grazing-angle sky mirror
    except Exception:
        pass
    rmix = nodes.new("ShaderNodeMixRGB")
    rmix.inputs["Color1"].default_value = (0.45, 0.45, 0.45, 1.0)   # wet sheen stays broad — grazing Fresnel can't white it out
    links.new(coord.outputs["Object"], rn.inputs["Vector"])
    links.new(rn.outputs["Fac"], rramp.inputs["Fac"])
    links.new(dry, rmix.inputs["Fac"])
    links.new(rramp.outputs["Color"], rmix.inputs["Color2"])
    links.new(rmix.outputs["Color"], bsdf.inputs["Roughness"])

    # multi-scale bump -> natural weathered stone: broad lumps + fine grain, then voronoi CRACKS
    b1 = nodes.new("ShaderNodeTexNoise")
    b1.inputs["Scale"].default_value = bump_scale
    set_in(b1, "Detail", 14.0)
    set_in(b1, "Roughness", 0.75)
    b2 = nodes.new("ShaderNodeTexNoise")
    b2.inputs["Scale"].default_value = bump_scale * 0.22
    bump2 = nodes.new("ShaderNodeBump"); bump2.inputs["Strength"].default_value = 0.75
    bump1 = nodes.new("ShaderNodeBump"); bump1.inputs["Strength"].default_value = 0.55
    links.new(coord.outputs["Object"], b1.inputs["Vector"])
    links.new(coord.outputs["Object"], b2.inputs["Vector"])
    links.new(b2.outputs["Fac"], bump2.inputs["Height"])
    links.new(b1.outputs["Fac"], bump1.inputs["Height"])
    links.new(bump2.outputs["Normal"], bump1.inputs["Normal"])
    # (voronoi "cracks" removed — they rendered as a turtle-shell web; the reference
    #  reads as MINERAL MOTTLE, which the color chain below now provides)
    links.new(bump1.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs[0], out.inputs["Surface"])
    return mat

# ==============================================================================
#  NEAR SET — stone shelf (FIXED placement) + boulders + pebbles + basalt
# ==============================================================================
def build_shelf(coll, mat, seed):
    """Slab 14 × 8 × 0.55 m. Top face at z = +0.03. Body INLAND (y 0 → +8);
    the ragged lip faces the sea (-y) and recedes INLAND, except in a protected
    corridor |x| < 0.30 so the bottle footprint (y 0.012…0.078) stays on stone."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= 14.0; v.co.y *= 8.0; v.co.z *= 7.4   # SOLID rock mass — face reaches the lakebed (never a floating slab)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=34, use_grid_fill=True)
    rnd = random.Random(seed)
    ph1 = rnd.random() * 6.28; ph2 = rnd.random() * 6.28
    for v in bm.verts:
        # seaward face = local -Y. Recede the LIP inland (top ~0.28 m band = the old slab
        # behavior), sparing the bottle corridor |x| < 0.30.
        fy = sstep(1.2, 3.9, -v.co.y) * sstep(0.30, 0.95, abs(v.co.x))
        if v.co.z > 3.425 and fy > 0.0:
            n = 0.5 + 0.34 * math.sin(v.co.x * 2.13 + ph1) + 0.22 * math.sin(v.co.x * 4.71 + ph2)
            v.co.y += fy * (0.15 + 0.72 * clamp(n, 0, 1))    # +y = inland recession
            v.co.z -= fy * 0.085 * clamp(n, 0, 1)             # lip droops toward the sea
        if v.co.z > 3.625:
            v.co.z += 0.015 * math.sin(v.co.x * 3.0 + ph1) * math.cos(v.co.y * 2.4)
            v.co.z += 0.006 * math.sin(v.co.x * 9.0 + ph2) * math.sin(v.co.y * 7.0)
        # submerged seaward face: fracture crags + a talus bulge growing with depth
        # (reference: the rock face continues craggy all the way down to the boulder bed)
        if v.co.y < -2.6 and v.co.z < 3.3:
            t = clamp((3.3 - v.co.z) / 6.6, 0.0, 1.0)         # 0 at the lip -> 1 at the bed
            n = (0.5 + 0.5 * math.sin(v.co.x * 1.7 + ph1) * math.sin(v.co.z * 1.1 + ph2)
                 + 0.25 * math.sin(v.co.x * 4.3 + v.co.z * 2.9 + ph2))
            guard = 1.0 if t > 0.25 else sstep(0.45, 1.2, abs(v.co.x))   # keep the bottle/camera corridor clear near the surface
            v.co.y -= (0.22 + 1.05 * t) * clamp(n, 0.0, 1.35) * guard
            v.co.x += 0.35 * t * math.sin(v.co.z * 1.9 + ph2) * math.sin(v.co.x * 0.7 + ph1)
    ob = obj_from_bm(bm, "Shelf", coll)
    ob.location = (0.0, 4.0, -3.67)     # top at +0.03; base ≈ -7.4, buried in the lakebed
    ob.data.materials.append(mat)
    if CONFIG["true_caustics"]:
        if not setp(ob, "is_caustics_receiver", True):
            try: ob.cycles.is_caustics_receiver = True
            except Exception: pass
    return ob

def _rock_bm(rnd, s, subdiv=3, style="volcanic"):
    """A UNIQUE weathered rock every call — random proportions, noise frequencies,
    amplitudes and orientation, so no two are alike. style routes the geology:
       'volcanic'  (Japan: jagged faceted basalt with rounded, water-worn edges)
       'limestone' (Greece: blocky, horizontally-bedded karst)."""
    bm = bmesh.new()
    try:
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    except TypeError:
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, diameter=2.0)
    R = rnd.random
    ph = [R() * 6.2832 for _ in range(6)]
    # random proportions -> slabs, tall chunks, squat rounds; never the same silhouette twice
    ax = 0.5 + 1.0 * R(); ay = 0.5 + 1.0 * R(); az = 0.55 + 0.85 * R()
    f1 = 1.4 + 1.8 * R()                    # big-mass frequency
    f2 = 3.5 + 4.0 * R()                    # facet frequency (the jaggedness)
    a1 = 0.16 + 0.18 * R()                  # big-mass amplitude
    # volcanic = high facet amplitude (jagged); limestone = gentler (blocky beds carry the read)
    a2 = (0.16 + 0.18 * R()) if style != "limestone" else (0.07 + 0.08 * R())
    fz = 2.2 + 2.0 * R()                    # per-rock bedding frequency (no repeating stripe pattern)
    # random orientation: full spin + a lean, so rocks sit at natural angles
    rot = Matrix.Rotation(R() * 6.2832, 3, "Z") @ Matrix.Rotation((R() - 0.5) * 0.7, 3, "X")
    for v in bm.verts:
        x, y, z = v.co.x, v.co.y, v.co.z
        if style == "limestone":
            k = (1.0
                 + a1 * math.sin(x * f1 + ph[0]) * math.sin(y * f1 * 0.8 + ph[1])
                 + 0.08 * (abs(math.sin(z * fz + ph[2])) - 0.5)                     # horizontal bedding ledges (subtle)
                 + a2 * math.sin(x * f2 + ph[3]) * math.sin(y * f2 + ph[4]))        # angular facets
            co = Vector((x * ax, y * ay, z * az * 1.15))                            # blockier / taller
        else:
            k = (1.0
                 + a1 * math.sin(x * f1 + ph[0]) * math.sin(y * f1 + ph[1]) * math.sin(z * f1 + ph[2])
                 + a2 * math.sin(x * f2 + ph[3]) * math.sin(z * f2 + ph[4])         # jagged volcanic facets
                 - 0.09 * abs(math.sin(x * f2 * 0.9 + ph[5]) * math.sin(z * f2 * 0.8 + ph[0]))  # creased FRACTURE valleys
                 + 0.05 * math.sin(x * f2 * 1.9 + y * f2 * 1.7 + ph[5]))            # fine surface break-up
            co = Vector((x * ax, y * ay, z * az))
        v.co = rot @ (co * (k * s))
    return bm

def build_boulders(coll, mat, seed, land_n, surf_n, stack_n, size_k, style="volcanic",
                   p_samples=None, x_side=None, detail_r2=12.25, big_n=0):
    """Three bands: LAND rocks scattered on the shelf, SURF rocks straddling
    the lip, and offshore SEA STACKS poking through the swell.
    style routes the geology; p_samples enables off-camera culling for this act;
    x_side=+1/-1 forces every rock onto one side of the bottle (reference staging);
    detail_r2 = squared radius inside which rocks build at full subdiv."""
    rnd = random.Random(seed)
    combined = bmesh.new()
    kept = [0, 0]

    def visible(center, radius):
        if not _cam_clearance(center, radius):
            kept[1] += 1
            return False                              # NEVER let a rock sit on the camera track
        if not (CONFIG["cull_offcamera"] and p_samples):
            return True
        ok = _cam_frustum_test(center, radius, p_samples)
        kept[0 if ok else 1] += 1
        return ok

    def merge(bm):
        me = bpy.data.meshes.new("_tmp")
        bm.to_mesh(me); bm.free()
        combined.from_mesh(me)
        bpy.data.meshes.remove(me)

    for _ in range(land_n):
        s = (0.05 + 0.14 * rnd.random() ** 2) * size_k
        x = (0.45 + rnd.random() ** 1.3 * 5.2) * (x_side or (1 if rnd.random() < 0.5 else -1))
        y = 0.35 + rnd.random() * 2.6
        sy = 0.62 + 0.5 * rnd.random(); sz = 0.52 + 0.42 * rnd.random()
        if not visible((x, y, 0.03), s * 1.8):
            continue
        bm = _rock_bm(rnd, s, subdiv=(3 if x * x + y * y < detail_r2 else 2), style=style)   # LOD: far rocks lighter
        for v in bm.verts:
            v.co.y *= sy; v.co.z *= sz
            v.co += Vector((x, y, 0.03 - s * sz * 0.28))
        merge(bm)

    for _ in range(surf_n):
        s = (0.05 + 0.17 * rnd.random() ** 2) * size_k
        x = (0.40 + rnd.random() ** 1.35 * 5.6) * (x_side or (1 if rnd.random() < 0.5 else -1))
        y = -0.35 + rnd.random() * 0.75
        sz = 0.55 + 0.4 * rnd.random()
        sink = 0.25 + 0.35 * rnd.random()
        if not visible((x, y, 0.0), s * 1.8):
            continue
        bm = _rock_bm(rnd, s, subdiv=(3 if x * x + y * y < detail_r2 else 2), style=style)
        for v in bm.verts:
            v.co.z *= sz
            v.co += Vector((x, y, -s * sz * sink))
        merge(bm)

    # BIG anchor boulders — large weathered masses straddling the lip (some on the
    # stone, some standing in the shallows): what makes the shore read real
    for _ in range(big_n):
        s = (0.30 + 0.45 * rnd.random()) * size_k
        x = (0.9 + 3.6 * rnd.random()) * (x_side or (1 if rnd.random() < 0.5 else -1))
        y = -0.6 + 1.9 * rnd.random()
        sz = 0.62 + 0.30 * rnd.random()
        if not visible((x, y, 0.03), s * 2.0):
            continue
        bm = _rock_bm(rnd, s, subdiv=3, style=style)
        base = 0.03 if y > 0.0 else 0.0
        for v in bm.verts:
            v.co.z *= sz
            v.co += Vector((x, y, base - s * sz * 0.42))
        merge(bm)

    for _ in range(stack_n):
        s = (0.20 + 0.42 * rnd.random()) * size_k
        x = (1.0 + 5.5 * rnd.random()) * (x_side or (1 if rnd.random() < 0.5 else -1))
        y = -(1.0 + 2.6 * rnd.random())
        sz = 0.6 + 0.35 * rnd.random()     # rounded zen boulders, not tall pointed sea stacks
        if not visible((x, y, 0.0), s * 2.0):
            continue
        bm = _rock_bm(rnd, s, subdiv=(3 if x * x + y * y < 12.25 else 2), style=style)   # LOD
        for v in bm.verts:
            v.co.z *= sz
            v.co += Vector((x, y, -s * sz * 0.45))
        merge(bm)

    if p_samples:
        print("  boulders(seed %d): kept %d, culled %d (never on camera)" % (seed, kept[0], kept[1]))
    ob = obj_from_bm(combined, "Boulders", coll)
    ob.data.materials.append(mat)
    return ob

def build_lakebed_rocks(coll, mat):
    """Dense boulder field paving the lakebed under the entry point — the reference
    shows the bed fully strewn with dark volcanic stones fading into the teal
    distance. Each rock sits ON the bed (same height formula as build_seabed),
    partially buried; a denser talus apron piles against the rock-mass base."""
    rnd = random.Random(41)
    combined = bmesh.new()

    def bed_h(x, y):
        return (0.35 * math.sin(x * 0.5 + 1.3) * math.cos(y * 0.42 + 0.7)
                + 0.12 * math.sin(x * 1.7 + y * 1.3)
                + 0.03 * math.sin(x * 6.0 + 0.5) * math.sin(y * 5.3)
                + 0.012 * math.sin(x * 14.0 + y * 2.0))

    def merge(bm):
        me = bpy.data.meshes.new("_tmp")
        bm.to_mesh(me); bm.free()
        combined.from_mesh(me)
        bpy.data.meshes.remove(me)

    kept = [0, 0]

    def drop(x, y, s):
        z = -3.4 + bed_h(x, y) + s * 0.42
        if not _cam_clearance((x, y, z), s * 1.9):
            kept[1] += 1
            return
        if CONFIG["cull_offcamera"] and not _cam_frustum_test((x, y, z), s * 1.9, P_UW):
            kept[1] += 1
            return
        kept[0] += 1
        bm = _rock_bm(rnd, s, subdiv=(2 if x * x + y * y < 49.0 else 1), style="volcanic")   # LOD: distant bed rocks lightest
        for v in bm.verts:
            v.co += Vector((x, y, z))                       # ~55% proud, rest buried
        merge(bm)

    # talus apron — piled against the base of the rock face
    for _ in range(55):
        drop((rnd.random() - 0.5) * 12.0, -0.1 - 2.6 * rnd.random(),
             0.20 + 0.85 * rnd.random() ** 1.7)
    # main field — paves the bed out to the murky distance
    for _ in range(105):
        drop((rnd.random() - 0.5) * 16.0, -2.0 - 5.5 * rnd.random(),
             0.14 + 0.62 * rnd.random() ** 1.5)
    print("  lakebed rocks: kept %d, culled %d (never on camera)" % (kept[0], kept[1]))
    ob = obj_from_bm(combined, "LakebedRocks", coll)
    ob.data.materials.append(mat)
    return ob

def build_pebble_instance(name, hex_col, park_x):
    bm = bmesh.new()
    try:
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    except TypeError:
        bmesh.ops.create_icosphere(bm, subdivisions=1, diameter=2.0)
    rnd = random.Random(hash(name) & 0xffff)
    for v in bm.verts:
        v.co.x *= 1.0 + 0.2 * math.sin(v.co.y * 3 + 1)
        v.co.z *= 0.55
    ob = obj_from_bm(bm, name, bpy.context.scene.collection)
    ob.location = (park_x, 6.0, -50.0)          # parked out of every possible shot
    m, n, l = new_mat(name)
    out = clear_default_bsdf(n, l)
    b = n.new("ShaderNodeBsdfPrincipled")
    set_in(b, "Base Color", hexlin(hex_col))
    set_in(b, "Roughness", 0.7)
    l.new(b.outputs[0], out.inputs["Surface"])
    ob.data.materials.append(m)
    return ob

def scatter_pebbles(emitter, inst, count, size):
    """Static hair-particle scatter (survives on 4.2 → 5.x; wrapped hard)."""
    emitter.modifiers.new("Pebbles", "PARTICLE_SYSTEM")
    psys = emitter.particle_systems[-1]
    s = psys.settings
    s.type = "HAIR"
    setp(s, "use_advanced_hair", True)
    s.count = count
    s.emit_from = "FACE"
    s.distribution = "RAND"
    s.render_type = "OBJECT"
    s.instance_object = inst
    s.particle_size = size
    s.size_random = 0.7
    setp(s, "use_rotations", True)
    setp(s, "rotation_mode", "NOR")
    setp(s, "rotation_factor_random", 0.9)
    setp(s, "hair_length", size)
    return psys

def build_basalt(coll, mat, seed):
    """Columnar basalt clusters — the volcanic signature of the Japanese shore."""
    rnd = random.Random(seed)
    combined = bmesh.new()
    clusters = [(-1.6, 0.45), (1.9, 0.30), (2.9, 0.95), (-2.8, 0.85)]
    for (cx, cy) in clusters:
        for _ in range(rnd.randint(7, 12)):
            r = 0.045 + 0.05 * rnd.random()
            h = 0.10 + 0.45 * rnd.random() ** 1.4
            x = cx + (rnd.random() - 0.5) * 0.6
            y = cy + (rnd.random() - 0.5) * 0.5
            rot = rnd.random() * PI
            tilt = (rnd.random() - 0.5) * 0.14
            bm = bmesh.new()
            vs_b, vs_t = [], []
            for k in range(6):
                a = rot + 2 * PI * k / 6.0
                px, py = math.cos(a) * r, math.sin(a) * r
                vs_b.append(bm.verts.new((px, py, 0.0)))
                vs_t.append(bm.verts.new((px + tilt * h, py, h * (0.9 + 0.2 * math.sin(a * 2)))))
            bm.faces.new(vs_b[::-1])
            bm.faces.new(vs_t)
            for k in range(6):
                k2 = (k + 1) % 6
                bm.faces.new((vs_b[k], vs_b[k2], vs_t[k2], vs_t[k]))
            for v in bm.verts:
                v.co += Vector((x, y, -0.02))
            me = bpy.data.meshes.new("_tmp")
            bm.to_mesh(me); bm.free()
            combined.from_mesh(me)
            bpy.data.meshes.remove(me)
    ob = obj_from_bm(combined, "Basalt", coll, smooth=False)
    ob.data.materials.append(mat)
    return ob

# ==============================================================================
#  FAR SCENERY — Fuji across the bay; Greek cliffs + village specks
# ==============================================================================
def build_fuji(coll):
    seg, rings = 96, 24
    verts, faces = [], []
    for i in range(rings + 1):
        t = i / rings
        rr = (1.0 - t) ** 1.55                # concave Fuji sweep
        z = t
        for j in range(seg):
            a = 2 * PI * j / seg
            ridge = 1.0 + 0.045 * math.sin(a * 7.0) * (1.0 - t) + 0.02 * math.sin(a * 17.0 + 2.0) * (1.0 - t)
            verts.append((math.cos(a) * rr * ridge, math.sin(a) * rr * ridge, z))
    for i in range(rings):
        for j in range(seg):
            j2 = (j + 1) % seg
            a = i * seg + j; b = i * seg + j2
            c = (i + 1) * seg + j2; d = (i + 1) * seg + j
            faces.append((a, b, c, d))
    ob = obj_from_pydata("Fuji", verts, faces, coll)
    ob.scale = (52.0, 52.0, 33.0)
    ob.location = (26.0, -170.0, -2.5)        # ACROSS THE BAY — seaward
    mat, nodes, links = new_mat("Fuji")
    out = clear_default_bsdf(nodes, links)
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    set_in(bsdf, "Roughness", 1.0)
    geo = nodes.new("ShaderNodeNewGeometry")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    snoise = nodes.new("ShaderNodeTexNoise"); snoise.inputs["Scale"].default_value = 60.0
    sadd = nodes.new("ShaderNodeMath"); sadd.operation = "MULTIPLY_ADD"
    sadd.inputs[1].default_value = 0.06
    ramp = nodes.new("ShaderNodeValToRGB")
    try:
        ramp.color_ramp.elements[0].position = 0.60
        ramp.color_ramp.elements[0].color = hexlin("#4b5560")
        ramp.color_ramp.elements[1].position = 0.74
        ramp.color_ramp.elements[1].color = (0.92, 0.94, 0.98, 1)
    except Exception:
        pass
    links.new(geo.outputs["Position"], sep.inputs["Vector"])
    links.new(geo.outputs["Position"], snoise.inputs["Vector"])
    links.new(snoise.outputs["Fac"], sadd.inputs[0])
    links.new(sep.outputs["Z"], sadd.inputs[2])
    links.new(sadd.outputs[0], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(bsdf.outputs[0], out.inputs["Surface"])
    ob.data.materials.append(mat)
    return ob

def build_cliffs(coll):
    rnd = random.Random(99)
    combined = bmesh.new()
    placements = [(-70, -130, 34, 22), (60, -150, 40, 26), (-30, -175, 30, 20), (95, -120, 26, 16)]
    for (x, y, w, h) in placements:
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=8, use_grid_fill=True)
        for v in bm.verts:
            v.co.x *= w; v.co.y *= w * 0.7; v.co.z *= h
            n = (0.5 + 0.4 * math.sin(v.co.x * 0.1 + rnd.random() * 3)
                 + 0.3 * math.sin(v.co.z * 0.2))
            if v.co.z > 0:
                v.co.z += n * h * 0.18
            v.co.x += 3.0 * math.sin(v.co.z * 0.2 + rnd.random())
            v.co.y += 2.0 * math.sin(v.co.z * 0.15 + rnd.random())
        for v in bm.verts:
            v.co += Vector((x, y, h * 0.5 - 6.0))
        me = bpy.data.meshes.new("_c")
        bm.to_mesh(me); bm.free()
        combined.from_mesh(me)
        bpy.data.meshes.remove(me)
    ob = obj_from_bm(combined, "Cliffs", coll)
    ob.data.materials.append(rock_mat("Cliff", "#c7b393", strata=True, bump_scale=1.2))
    return ob

def build_village(coll):
    """A handful of white specks + one blue dome on the clifftop — reads
    'Greece' from 150 m without stealing the frame."""
    rnd = random.Random(5)
    combined = bmesh.new()
    cx, cy, cz = 60.0, -148.0, 20.0
    for _ in range(9):
        w = 2.0 + rnd.random() * 3.0
        h = 2.2 + rnd.random() * 2.6
        x = cx + (rnd.random() - 0.5) * 26.0
        y = cy + (rnd.random() - 0.5) * 10.0
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        for v in bm.verts:
            v.co.x *= w; v.co.y *= w; v.co.z *= h
            v.co += Vector((x, y, cz + h * 0.5))
        me = bpy.data.meshes.new("_v")
        bm.to_mesh(me); bm.free()
        combined.from_mesh(me)
        bpy.data.meshes.remove(me)
    houses = obj_from_bm(combined, "Village", coll, smooth=False)
    hm, hn, hl = new_mat("VillageWhite")
    out = clear_default_bsdf(hn, hl)
    hb = hn.new("ShaderNodeBsdfPrincipled")
    set_in(hb, "Base Color", (0.93, 0.92, 0.90, 1.0))
    set_in(hb, "Roughness", 0.8)
    hl.new(hb.outputs[0], out.inputs["Surface"])
    houses.data.materials.append(hm)

    bm = bmesh.new()
    add_uvsphere_into(bm, (cx + 2.0, cy - 2.0, cz + 4.6), 2.2, u=16, v=10)
    dome = obj_from_bm(bm, "VillageDome", coll)
    dm, dn, dl = new_mat("VillageDome")
    out = clear_default_bsdf(dn, dl)
    db = dn.new("ShaderNodeBsdfPrincipled")
    set_in(db, "Base Color", hexlin(HEX["domeB"]))
    set_in(db, "Roughness", 0.45)
    dl.new(db.outputs[0], out.inputs["Surface"])
    dome.data.materials.append(dm)
    return houses

# ==============================================================================
#  KELP — swaying silhouettes for the underwater turn
# ==============================================================================
def build_kelp(coll):
    rnd = random.Random(31)
    kmat, kn, kl = new_mat("Kelp")
    out = clear_default_bsdf(kn, kl)
    kb = kn.new("ShaderNodeBsdfPrincipled")
    set_in(kb, "Base Color", hexlin("#2f4032"))
    set_in(kb, "Roughness", 0.6)
    set_in(kb, ["Subsurface Weight", "Subsurface"], 0.1)
    kl.new(kb.outputs[0], out.inputs["Surface"])

    spots = [(1.6, -2.2), (-2.1, -2.8), (0.8, -3.4), (-1.2, -1.9), (2.8, -3.1), (-3.0, -3.6)]
    strands = []
    for (x, y) in spots:
        L = 1.7 + rnd.random() * 0.7   # scaled to the 3.4 m bed — tips stay well below the surface
        rings = 16
        verts, faces = [], []
        for i in range(rings + 1):
            t = i / rings
            r = lerp(0.055, 0.010, t) * (1.0 + 0.18 * math.sin(t * 9.0 + rnd.random() * 3))
            for k in range(6):
                a = 2 * PI * k / 6
                verts.append((math.cos(a) * r, t * L, math.sin(a) * r))
        for i in range(rings):
            for k in range(6):
                k2 = (k + 1) % 6
                a = i * 6 + k; b = i * 6 + k2
                c = (i + 1) * 6 + k2; d = (i + 1) * 6 + k
                faces.append((a, b, c, d))
        ob = obj_from_pydata("Kelp", verts, faces, coll)
        # built along +Y, then raised: +Y -> +Z; wave displaces local Z = lateral sway
        ob.rotation_euler = Euler((PI / 2.0, 0.0, rnd.random() * PI), "XYZ")
        ob.location = (x, y, -3.4)
        try:
            wmod = ob.modifiers.new("Sway", "WAVE")
            wmod.use_x = False; wmod.use_y = True
            wmod.height = 0.45; wmod.width = 1.6
            wmod.speed = 0.22; wmod.narrowness = 1.2
            wmod.time_offset = rnd.random() * 80.0
        except Exception:
            pass
        ob.data.materials.append(kmat)
        strands.append(ob)
    return strands

# ==============================================================================
#  BOTTLE — real glass walls, punt, knurled cap, emboss, runnels, fizz
# ==============================================================================
GLASS_OUTER = [
    (0.0000, -0.1180), (0.0100, -0.1195), (0.0180, -0.1225), (0.0240, -0.1248),
    (0.0298, -0.1210), (0.0324, -0.1160), (0.0332, -0.1070), (0.0334, -0.0980),
    (0.0334,  0.0200), (0.0328,  0.0320), (0.0308,  0.0430), (0.0262,  0.0550),
    (0.0196,  0.0670), (0.0150,  0.0780), (0.0127,  0.0880), (0.0119,  0.0980),
    (0.0119,  0.1040),
]
GLASS_INNER = [
    (0.0095,  0.1040), (0.0095,  0.0980), (0.0103,  0.0880), (0.0126,  0.0780),
    (0.0172,  0.0670), (0.0238,  0.0550), (0.0284,  0.0430), (0.0304,  0.0320),
    (0.0310,  0.0200), (0.0310, -0.0940), (0.0300, -0.1040), (0.0240, -0.1120),
    (0.0140, -0.1130), (0.0000, -0.1085),
]
LIQ_PROFILE = [
    (0.0000, -0.1082), (0.0142, -0.1126), (0.0242, -0.1114), (0.0302, -0.1036),
    (0.0312, -0.0940), (0.0312,  0.0200), (0.0306,  0.0320), (0.0286,  0.0430),
    (0.0240,  0.0550), (0.0174,  0.0670), (0.0128,  0.0780), (0.0103,  0.0880),
    (0.0095,  0.0946), (0.0080,  0.0956), (0.0000,  0.0948),   # meniscus curl
]
CAP_PROFILE = [
    (0.0000, 0.1006), (0.0136, 0.1006), (0.0141, 0.1040), (0.0141, 0.1196),
    (0.0122, 0.1226), (0.0000, 0.1230),
]

def glass_material():
    gm, gn, gl = new_mat("Glass")
    out = clear_default_bsdf(gn, gl)
    gb = gn.new("ShaderNodeBsdfPrincipled")
    set_in(gb, "Base Color", (0.93, 0.965, 0.965, 1.0))
    set_in(gb, "Roughness", 0.025)
    set_in(gb, "IOR", 1.46)
    set_in(gb, ["Transmission Weight", "Transmission"], 1.0)
    set_in(gb, ["Coat Weight", "Clearcoat"], 0.4)
    # faint manufacturing waviness in the glass
    coord = gn.new("ShaderNodeTexCoord")
    wn = gn.new("ShaderNodeTexNoise"); wn.inputs["Scale"].default_value = 9.0
    wb = gn.new("ShaderNodeBump"); wb.inputs["Strength"].default_value = 0.02
    gl.new(coord.outputs["Object"], wn.inputs["Vector"])
    gl.new(wn.outputs["Fac"], wb.inputs["Height"])
    gl.new(wb.outputs["Normal"], gb.inputs["Normal"])
    gl.new(gb.outputs[0], out.inputs["Surface"])
    return gm

def build_procedural_bottle(coll, label_path):
    parts = []
    gm = glass_material()

    # glass — closed profile: outer wall up, over the rim, inner wall down
    v, f = lathe(GLASS_OUTER + GLASS_INNER, 96)
    glass = obj_from_pydata("Bottle_Glass", v, f, coll)
    glass.data.materials.append(gm)
    parts.append(glass)

    # liquid — slightly overlapping the inner glass wall (correct interface)
    v, f = lathe(LIQ_PROFILE, 72)
    liquid = obj_from_pydata("Bottle_Liquid", v, f, coll)
    lm, ln, ll = new_mat("Liquid")
    out = clear_default_bsdf(ln, ll)
    lb = ln.new("ShaderNodeBsdfPrincipled")
    set_in(lb, "Base Color", (0.87, 0.95, 0.93, 1.0))
    set_in(lb, "Roughness", 0.03)
    set_in(lb, "IOR", 1.34)
    set_in(lb, ["Transmission Weight", "Transmission"], 1.0)
    ll.new(lb.outputs[0], out.inputs["Surface"])
    liquid.data.materials.append(lm)
    parts.append(liquid)

    # label wrap + paper bump
    v, f = tube(0.0339, -0.07455, 0.00895, 96)
    label = obj_from_pydata("Bottle_Label", v, f, coll, recalc=False)
    me = label.data
    me.uv_layers.new(name="UVMap")
    uvl = me.uv_layers.active.data
    li = 0
    for poly in me.polygons:
        for loop_i in poly.loop_indices:
            vi = me.loops[loop_i].vertex_index
            ring = vi // 2
            top = vi % 2
            uvl[li].uv = (ring / 96.0, float(top))
            li += 1
    lm2, ln2, ll2 = new_mat("Label")
    out = clear_default_bsdf(ln2, ll2)
    lb2 = ln2.new("ShaderNodeBsdfPrincipled")
    set_in(lb2, "Roughness", 0.5)
    set_in(lb2, ["Sheen Weight", "Sheen"], 0.15)
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
    pn = ln2.new("ShaderNodeTexNoise"); pn.inputs["Scale"].default_value = 300.0
    pb = ln2.new("ShaderNodeBump"); pb.inputs["Strength"].default_value = 0.04
    ll2.new(pn.outputs["Fac"], pb.inputs["Height"])
    ll2.new(pb.outputs["Normal"], lb2.inputs["Normal"])
    ll2.new(lb2.outputs[0], out.inputs["Surface"])
    label.data.materials.append(lm2)
    parts.append(label)

    # cap — lathe + knurled flutes
    v, f = lathe(CAP_PROFILE, 72)
    cap = obj_from_pydata("Bottle_Cap", v, f, coll)
    for vert in cap.data.vertices:
        z = vert.co.z
        if 0.1035 < z < 0.1200:
            a = math.atan2(vert.co.y, vert.co.x)
            k = 1.0 + 0.016 * math.sin(a * 24.0)
            vert.co.x *= k; vert.co.y *= k
    cm, cn, cl = new_mat("Cap")
    out = clear_default_bsdf(cn, cl)
    cb = cn.new("ShaderNodeBsdfPrincipled")
    set_in(cb, "Base Color", hexlin("#33422c"))    # dark olive-green cap (reference)
    set_in(cb, "Metallic", 0.5)
    set_in(cb, "Roughness", 0.35)
    set_in(cb, "Anisotropic", 0.4)
    cl.new(cb.outputs[0], out.inputs["Surface"])
    cap.data.materials.append(cm)
    parts.append(cap)

    v, f = lathe([(0.0000, 0.0990), (0.0138, 0.0990), (0.0138, 0.1004), (0.0000, 0.1004)], 48)
    ring = obj_from_pydata("Bottle_Ring", v, f, coll)
    ring.data.materials.append(cm)
    parts.append(ring)

    # embossed glass logotype wrapped on the shoulder (best-effort)
    if CONFIG["bottle_emboss"]:
        try:
            cu = bpy.data.curves.new("EmbossPath", "CURVE")
            cu.dimensions = "3D"
            sp = cu.splines.new("BEZIER")
            sp.bezier_points.add(3)
            rr = 0.0318; kk = rr * 0.5523
            data = [((rr, 0), (rr, -kk), (rr, kk)),
                    ((0, rr), (kk, rr), (-kk, rr)),
                    ((-rr, 0), (-rr, kk), (-rr, -kk)),
                    ((0, -rr), (-kk, -rr), (kk, -rr))]
            for bpn, (co, hl_, hr_) in zip(sp.bezier_points, data):
                bpn.co = (co[0], co[1], 0.0)
                bpn.handle_left = (hl_[0], hl_[1], 0.0)
                bpn.handle_right = (hr_[0], hr_[1], 0.0)
                bpn.handle_left_type = "FREE"
                bpn.handle_right_type = "FREE"
            sp.use_cyclic_u = True
            path = bpy.data.objects.new("EmbossPath", cu)
            path.rotation_euler = Euler((0, 0, PI / 2), "XYZ")
            path.location = (0.0, 0.0, 0.030)
            coll.objects.link(path)

            txt = bpy.data.curves.new("EmbossText", "FONT")
            txt.body = "MASTRY"
            txt.size = 0.0062
            txt.extrude = 0.0005
            txt.align_x = "CENTER"
            setp(txt, "space_character", 1.3)
            tob = bpy.data.objects.new("Bottle_Emboss", txt)
            tob.rotation_euler = Euler((PI / 2, 0, 0), "XYZ")
            tob.location = (0.0, 0.0, 0.030)
            coll.objects.link(tob)
            mod = tob.modifiers.new("Wrap", "CURVE")
            mod.object = path
            mod.deform_axis = "POS_X"
            tob.data.materials.append(gm)
            parts.append(tob)
            parts.append(path)
        except Exception:
            pass

    # condensation: droplets + gravity runnels
    if CONFIG["build_condensation"]:
        rnd = random.Random(11)
        bm = bmesh.new()
        for _ in range(110):
            th = rnd.random() * 2 * PI
            z = -0.115 + rnd.random() * 0.145
            on_label = -0.0745 < z < 0.009
            rr = 0.0345 if on_label else 0.0339
            s = 0.0006 + rnd.random() * 0.0011
            add_uvsphere_into(bm, (math.sin(th) * rr, math.cos(th) * rr, z), s, 6, 5)
        for _ in range(16):   # runnels — vertically stretched beads
            th = rnd.random() * 2 * PI
            z = -0.095 + rnd.random() * 0.075
            rr = 0.03445 if (-0.0745 < z < 0.009) else 0.03385
            s = 0.0005 + rnd.random() * 0.0005
            add_uvsphere_into(bm, (math.sin(th) * rr, math.cos(th) * rr, z), s, 6, 6,
                              squash=(1.0, 1.0, 6.0 + rnd.random() * 5.0))
        cond = obj_from_bm(bm, "Condensation", coll)
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

        bm = bmesh.new()
        for _ in range(48):
            th = rnd.random() * 2 * PI
            rr = rnd.random() * 0.024
            s = 0.0006 + rnd.random() * 0.001
            add_uvsphere_into(bm, (math.sin(th) * rr, math.cos(th) * rr,
                                   -0.105 + rnd.random() * 0.185), s, 5, 4)
        fizz = obj_from_bm(bm, "Fizz", coll)
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
    for o in imported:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        coll.objects.link(o)
    try:
        bpy.context.view_layer.update()
    except Exception:
        pass
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
    for o in mesh_objs:
        for slot in o.material_slots:
            m = slot.material
            if not m or not m.use_nodes:
                continue
            nm = (m.name + " " + o.name).lower()
            is_opaque = any(k in nm for k in ("cap", "metal", "alumin", "label", "lable", "ring", "seal"))
            bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
            # the .glb glass material is NOT named "glass", so the old name test missed it and left
            # the bottle opaque. Everything that isn't the cap/label/metal is glass or liquid -> clear.
            if bsdf and not is_opaque:
                set_in(bsdf, ["Transmission Weight", "Transmission"], 1.0)
                set_in(bsdf, "Roughness", 0.02)
                set_in(bsdf, "IOR", 1.45)
                set_in(bsdf, ["Coat Weight", "Clearcoat"], 0.25)
                set_in(bsdf, "Alpha", 1.0)
                set_in(bsdf, "Base Color", (0.94, 0.97, 0.96, 1.0))   # clear glass, shows the background through
                setp(m, "use_screen_refraction", True)                # EEVEE Next: see-through in Material Preview too
    return imported

# ==============================================================================
#  FX — particles (splash / wake / breach / runoff / drips / marine snow),
#       foam rings, turbulence
# ==============================================================================
def _instance_sphere(name, radius, park, thin_film=False):
    bm = bmesh.new()
    try:
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius)
    except TypeError:
        bmesh.ops.create_icosphere(bm, subdivisions=1, diameter=radius * 2)
    ob = obj_from_bm(bm, name, bpy.context.scene.collection)
    ob.location = park
    m, n, l = new_mat(name)
    out = clear_default_bsdf(n, l)
    b = n.new("ShaderNodeBsdfPrincipled")
    set_in(b, "Base Color", (0.9, 0.96, 0.98, 1))
    set_in(b, "Roughness", 0.02)
    set_in(b, "IOR", 1.33)
    set_in(b, ["Transmission Weight", "Transmission"], 0.85)
    if thin_film:
        set_in(b, "Thin Film Thickness", 320.0)   # iridescent bubble skin (4.2+)
        set_in(b, "Thin Film IOR", 1.33)
    l.new(b.outputs[0], out.inputs["Surface"])
    ob.data.materials.append(m)
    return ob

def _emitter_disk(name, loc, radius, coll):
    bm = bmesh.new()
    try:
        bmesh.ops.create_circle(bm, cap_ends=True, segments=16, radius=radius)
    except TypeError:
        bmesh.ops.create_circle(bm, cap_ends=True, segments=16, diameter=radius * 2)
    ob = obj_from_bm(bm, name, coll, smooth=False, recalc=False)
    ob.location = loc
    ob.show_instancer_for_render = False
    ob.show_instancer_for_viewport = False
    return ob

def _emitter_cube(name, loc, scale, coll):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    ob = obj_from_bm(bm, name, coll, smooth=False, recalc=False)
    ob.location = loc
    ob.scale = scale
    ob.display_type = "WIRE"
    ob.show_instancer_for_render = False
    ob.show_instancer_for_viewport = False
    return ob

def _add_psys(emitter, name, inst, count, f0, f1, life, size, grav,
              nfac=0.0, rfac=0.0, emit_from="FACE", brownian=0.0, drag=0.0):
    emitter.modifiers.new(name, "PARTICLE_SYSTEM")
    psys = emitter.particle_systems[-1]
    s = psys.settings
    s.count = count
    s.frame_start = f0
    s.frame_end = f1
    s.lifetime = life
    s.lifetime_random = 0.5
    s.emit_from = emit_from
    s.distribution = "RAND"
    s.physics_type = "NEWTON"
    s.normal_factor = nfac
    s.factor_random = rfac
    s.particle_size = size
    s.size_random = 0.6
    s.effector_weights.gravity = grav
    s.render_type = "OBJECT"
    s.instance_object = inst
    setp(s, "use_rotations", False)
    setp(s, "brownian_factor", brownian)
    setp(s, "drag_factor", drag)
    try:
        s.display_method = "DOT"
    except Exception:
        pass
    return psys

def build_particles(coll, frames, geo_parent):
    fo = lambda p: frame_of(p, frames)
    drop = _instance_sphere("P_Drop", 1.0, (4.0, 6.0, -50.0))
    bub  = (_instance_sphere("P_Bubble", 1.0, (-4.0, 6.0, -50.0), thin_film=True)
            if CONFIG["build_bubbles"] else None)
    snow = _instance_sphere("P_Snow", 1.0, (0.0, 8.0, -50.0))

    # entry splash — droplets up and out at the plunge point
    em_s = _emitter_disk("Emit_Splash", T2B((0.0, 0.0, 0.135)), 0.035, coll)
    _add_psys(em_s, "Splash", drop, 160, fo(0.480), fo(0.560), int(0.055 * frames) + 4,
              0.005, 1.5, nfac=0.5, rfac=0.38, drag=0.05)
    # fine mist above the entry
    _add_psys(em_s, "Mist", drop, 90, fo(0.483), fo(0.545), int(0.04 * frames) + 3,
              0.0022, 0.9, nfac=0.85, rfac=0.5, drag=0.12)

    # bubble wake shed by the MOVING bottle (proxy parented to the bottle)
    if geo_parent is not None:
        bm = bmesh.new()
        try:
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.030)
        except TypeError:
            bmesh.ops.create_icosphere(bm, subdivisions=1, diameter=0.060)
        proxy = obj_from_bm(bm, "Emit_Wake", coll, smooth=False, recalc=False)
        proxy.parent = geo_parent
        proxy.show_instancer_for_render = False
        proxy.show_instancer_for_viewport = False
        if bub is not None:
            _add_psys(proxy, "Wake", bub, 300, fo(0.480), fo(0.705), int(0.10 * frames) + 6,
                      0.0035, -0.45, nfac=0.02, rfac=0.03, brownian=0.15)
        _add_psys(proxy, "Runoff", drop, 90, fo(0.732), fo(0.795), int(0.05 * frames) + 4,
                  0.004, 1.1, nfac=0.05, rfac=0.25, drag=0.04)

    # static bubble column at the rest point
    if bub is not None:
        em_b = _emitter_disk("Emit_Bubbles", T2B((0.0, -0.02, 0.12)), 0.05, coll)
        _add_psys(em_b, "Bubbles", bub, 150, fo(0.44), fo(0.70), int(0.10 * frames) + 6,
                  0.004, -0.5, nfac=0.06, rfac=0.04, brownian=0.2)

    # breach splash — sheet of droplets where the bottle punches out
    em_x = _emitter_disk("Emit_Breach", (0.0, -0.127, 0.0), 0.045, coll)
    _add_psys(em_x, "Breach", drop, 180, fo(0.712), fo(0.780), int(0.06 * frames) + 4,
              0.005, 1.4, nfac=0.55, rfac=0.4, drag=0.05)

    # landing drips off the standing bottle
    em_d = _emitter_disk("Emit_Drips", (0.0, 0.045, 0.205), 0.02, coll)
    _add_psys(em_d, "Drips", drop, 46, fo(0.803), fo(0.885), int(0.05 * frames) + 4,
              0.003, 1.0, nfac=0.02, rfac=0.15)

    # marine snow — drifting particulate for the turn
    if CONFIG["build_particles"]:
        em_m = _emitter_cube("Emit_Snow", (0.0, -0.2, -1.0), (5.0, 5.0, 2.2), coll)
        _add_psys(em_m, "MarineSnow", snow, 1200, fo(0.44), fo(0.60), int(0.30 * frames) + 8,
                  0.0013, -0.015, emit_from="VOLUME", brownian=0.45)   # denser particulate — reads flashier streaking through the god-ray flash

    # gentle turbulence so nothing falls in straight lines
    turb = None
    try:
        e = bpy.data.objects.new("Turbulence", None)
        coll.objects.link(e)
        e.location = (0.0, -0.1, 0.0)
        if e.field is None:
            raise RuntimeError("no field")
        e.field.type = "TURBULENCE"
        e.field.strength = 0.025
        e.field.size = 0.35
        e.field.flow = 0.4
        turb = e
    except Exception:
        pass
    return {"instances": [o for o in (drop, bub, snow) if o is not None], "turbulence": turb}

def build_rings(coll, frames):
    """Expanding foam rings at the entry point and the breach point."""
    def make_ring(name, loc):
        prof = []
        for k in range(12):
            a = 2 * PI * k / 12
            prof.append((1.0 + 0.010 * math.cos(a), 0.004 * math.sin(a)))
        prof.append(prof[0])
        v, f = lathe(prof, 64)
        ob = obj_from_pydata(name, v, f, coll)
        ob.location = loc
        ob.scale = (0.01, 0.01, 0.01)
        m, n, l = new_mat(name)
        out = clear_default_bsdf(n, l)
        em = n.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = hexlin(HEX["foam"])
        em.inputs["Strength"].default_value = 0.45   # soft foam ring, not a glowing white halo
        tr = n.new("ShaderNodeBsdfTransparent")
        mx = n.new("ShaderNodeMixShader")
        mx.inputs["Fac"].default_value = 0.0
        l.new(tr.outputs[0], mx.inputs[1])
        l.new(em.outputs[0], mx.inputs[2])
        l.new(mx.outputs[0], out.inputs["Surface"])
        setp(m, "blend_method", "BLEND")
        setp(ob, "visible_shadow", False)
        ob.data.materials.append(m)
        return {"obj": ob, "fac": mx.inputs["Fac"]}
    r1 = make_ring("Ring_Entry", (0.0, -0.135, 0.004))
    r1.update(p0=0.483, p1=0.60, maxr=0.36)   # tighter, fades sooner
    # rise/breach ring removed — the gentle un-topple doesn't punch the surface, so it read as a "random ring"
    return [r1]

# ==============================================================================
#  CAMERA — matched fov + tracked focus + animated aperture
# ==============================================================================
def build_camera(coll, ctrl):
    cd = bpy.data.cameras.new("Camera")
    cd.sensor_fit = "VERTICAL"
    cd.angle = math.radians(34.0)
    cd.clip_start = 0.005
    cd.clip_end = 2000.0
    try:
        cd.dof.use_dof = True
        cd.dof.focus_object = ctrl
        cd.dof.aperture_fstop = 4.0
        cd.dof.aperture_blades = 9
        cd.dof.aperture_rotation = math.radians(15.0)
    except Exception:
        pass
    cam = bpy.data.objects.new("Camera", cd)
    cam.rotation_mode = "QUATERNION"
    coll.objects.link(cam)
    bpy.context.scene.camera = cam
    return cam

# ==============================================================================
#  COMPOSITOR — bloom, underwater grade, chromatic fringe, vignette
# ==============================================================================
def build_compositor(scene):
    scene.use_nodes = True
    nt = scene.node_tree
    if nt is None:
        raise RuntimeError("no compositor tree")
    nt.nodes.clear()
    rl = nt.nodes.new("CompositorNodeRLayers")
    comp = nt.nodes.new("CompositorNodeComposite")

    # underwater teal push (Fac keyed to the murk in the bake)
    cb = nt.nodes.new("CompositorNodeColorBalance")
    cb.correction_method = "LIFT_GAMMA_GAIN"
    try:
        cb.gain = (0.90, 1.04, 1.08)
        cb.lift = (0.99, 1.005, 1.01)
    except Exception:
        pass
    set_in(cb, "Fac", 0.0)
    nt.links.new(rl.outputs["Image"], cb.inputs["Image"])
    prev = cb

    # bloom / glare
    try:
        gl = nt.nodes.new("CompositorNodeGlare")
        ok = False
        for gt in ("BLOOM", "FOG_GLOW"):
            try:
                gl.glare_type = gt
                ok = True
                break
            except Exception:
                continue
        if not ok:
            raise RuntimeError("no glare type")
        setp(gl, "quality", "HIGH")
        setp(gl, "mix", -0.72)
        setp(gl, "threshold", 1.6)
        setp(gl, "size", 7)
        set_in(gl, ["Threshold", "Highlights Threshold"], 1.6)
        set_in(gl, ["Strength"], 0.18)
        set_in(gl, ["Size"], 0.6)
        nt.links.new(prev.outputs["Image"], gl.inputs["Image"])
        prev = gl
    except Exception:
        pass

    # chromatic fringe + the faintest barrel distortion
    try:
        ld = nt.nodes.new("CompositorNodeLensdist")
        set_in(ld, ["Distort", "Distortion"], 0.012)
        set_in(ld, ["Dispersion"], 0.006)
        setp(ld, "use_fit", True)
        nt.links.new(prev.outputs["Image"], ld.inputs["Image"])
        prev = ld
    except Exception:
        pass

    # vignette
    try:
        mask = nt.nodes.new("CompositorNodeEllipseMask")
        mask.width = 1.35
        mask.height = 1.05
        blur = nt.nodes.new("CompositorNodeBlur")
        blur.size_x = 320; blur.size_y = 320
        setp(blur, "use_relative", False)
        inv = nt.nodes.new("CompositorNodeInvert")
        dark = nt.nodes.new("CompositorNodeMixRGB")
        dark.blend_type = "MULTIPLY"
        dark.inputs["Color2"].default_value = (0.62, 0.63, 0.68, 1.0)
        nt.links.new(mask.outputs["Mask"], blur.inputs["Image"])
        nt.links.new(blur.outputs["Image"], inv.inputs["Color"])
        nt.links.new(inv.outputs["Color"], dark.inputs["Fac"])
        nt.links.new(prev.outputs["Image"], dark.inputs["Color1"])
        prev = dark
    except Exception:
        pass

    nt.links.new(prev.outputs["Image"], comp.inputs["Image"])
    return {"balance_fac": cb.inputs["Fac"]}

# ==============================================================================
#  RENDER SETTINGS
# ==============================================================================
def setup_render(scene, q):
    eng = CONFIG["engine"]
    try:
        scene.render.engine = eng
    except Exception:
        scene.render.engine = "CYCLES"
        eng = "CYCLES"

    scene.render.resolution_x = q["rx"]
    scene.render.resolution_y = q["ry"]
    scene.render.resolution_percentage = 100
    scene.render.filepath = CONFIG["render_out"]
    scene.render.image_settings.file_format = "PNG"
    setp(scene.render.image_settings, "color_depth", "16")
    scene.render.film_transparent = False
    setp(scene.render, "use_persistent_data", True)

    # EEVEE Next (Material Preview + fast renders): raytraced reflections/refraction so
    # the glass bottle and the water read as see-through in the viewport, not opaque.
    try:
        ev = scene.eevee
        setp(ev, "use_raytracing", True)          # EEVEE Next
        setp(ev, "use_ssr", True)                 # legacy EEVEE
        setp(ev, "use_ssr_refraction", True)
        setp(ev, "use_gtao", True)
    except Exception:
        pass

    # motion blur (the bake is per-frame linear, so blur is meaningful)
    try:
        scene.render.use_motion_blur = q["mb"]
    except Exception:
        pass
    setp(scene.render, "motion_blur_shutter", 0.5)     # base; the bake widens it on fast beats
    setp(scene.render, "motion_blur_position", "CENTER")

    if eng == "CYCLES":
        cy = scene.cycles
        cy.samples = q["spp"]
        setp(cy, "use_adaptive_sampling", True)
        setp(cy, "adaptive_threshold", q["athr"])
        setp(cy, "use_denoising", True)
        setp(cy, "denoiser", "OPENIMAGEDENOISE")
        setp(cy, "denoising_use_gpu", True)
        setp(cy, "preview_samples", 32)
        setp(cy, "use_preview_denoising", True)
        setp(cy, "use_preview_adaptive_sampling", True)
        setp(cy, "use_light_tree", True)
        setp(cy, "use_guiding", q["guide"])           # CPU only; ignored on GPU
        setp(cy, "max_bounces", 12)
        setp(cy, "transmission_bounces", 16)
        setp(cy, "transparent_max_bounces", 32)
        setp(cy, "volume_bounces", 2)
        setp(cy, "volume_step_rate", q["vrate"])
        setp(cy, "volume_preview_step_rate", max(q["vrate"], 1.0))
        setp(cy, "volume_max_steps", 512)
        setp(cy, "blur_glossy", 1.0)
        setp(cy, "sample_clamp_indirect", 10.0)
        setp(cy, "motion_blur_position", "CENTER")
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
                            cy.device = "GPU"
                            break
                    except Exception:
                        continue
            except Exception:
                pass
        if CONFIG["true_caustics"]:
            setp(cy, "caustics_reflective", True)
            setp(cy, "caustics_refractive", True)

    try:
        scene.view_settings.view_transform = CONFIG["view_transform"]
    except Exception:
        pass
    # Nishita is physical-unit bright: -3 EV brings sky-lit geometry (dark stone, label,
    # sea) into range; the backdrop emission is raised x8 to compensate, so the plates
    # keep their look. Proven by a control render — do not "fix" materials instead.
    setp(scene.view_settings, "exposure", -3.0)
    for look in CONFIG["looks"]:
        try:
            scene.view_settings.look = look if look else "None"
            break
        except Exception:
            continue

# ==============================================================================
#  ANIMATION BAKE — everything keyed per frame; scroll ⇄ frame stays 1:1
# ==============================================================================
def bake_animation(scene, H, C_jp, C_gr, frames, fps):
    cam  = H["cam"]
    ctrl = H["ctrl"]
    L = H.get("lights") or {}
    sun_obj, sun_data = L.get("sun_obj"), L.get("sun_data")
    uw_data = L.get("uw_data")
    gobo = L.get("gobo")
    rim  = L.get("rim")
    world  = H.get("world")
    ocean  = H.get("ocean")
    seabed = H.get("seabed")
    volume = H.get("volume")
    clouds = H.get("clouds")
    comp   = H.get("comp")
    rings  = H.get("rings") or []

    warm   = hexlin(HEX["sunJ"])[:3]
    golden = hexlin(HEX["sunG"])[:3]
    deepJ  = hexlin(HEX["deepJ"])
    deepG  = hexlin(HEX["deepG"])

    if rim and rim.get("con") is not None:
        try:
            rim["con"].target = ctrl
            rim["con"].track_axis = "TRACK_NEGATIVE_Z"
            rim["con"].up_axis = "UP_Y"
        except Exception:
            pass

    _prev_cam_q = None
    _prev_bot_q = None
    for f in range(frames + 1):
        p = f / frames
        fr = 1 + f
        b = pv("blend", p)
        m = murk_val(p)
        uw = underwater_win(p)

        # ---- camera + focus ----
        loc, quat, _ = camera_matrix(p).decompose()
        loc, quat = cam_handheld(loc, quat, p)
        # keep the dense-baked quaternion continuous so the 2π barrel roll never
        # interpolates the "short way" at a double-cover sign flip
        if _prev_cam_q is not None and quat.dot(_prev_cam_q) < 0.0:
            quat.negate()
        _prev_cam_q = quat.copy()
        cam.location = loc
        cam.rotation_quaternion = quat
        cam.keyframe_insert("location", frame=fr)
        cam.keyframe_insert("rotation_quaternion", frame=fr)
        try:
            cam.data.dof.aperture_fstop = 4.0   # canon: fixed f/4 (lens spec) — no aperture ramp / rack focus
            cam.data.keyframe_insert("dof.aperture_fstop", frame=fr)
        except Exception:
            pass

        # ---- motion-blur shutter: open wider on the fast beats ----
        try:
            fast = (uw                                                        # underwater window keeps the shutter wide -> covers the disorienting wander
                    + sstep(0.44, 0.485, p) * (1.0 - sstep(0.495, 0.55, p))   # plunge
                    + sstep(0.70, 0.725, p) * (1.0 - sstep(0.74, 0.80, p)))   # breach
            shutter = 0.5 + 0.3 * clamp(fast, 0.0, 1.0)
            shutter += 0.20 * sstep(0.60, 0.62, p) * (1.0 - sstep(0.655, 0.70, p))   # FLASH-WHIP: extra streak as the eye breaks up out of the murk into the god-ray flash
            scene.render.motion_blur_shutter = clamp(shutter, 0.3, 1.0)
            scene.render.keyframe_insert("motion_blur_shutter", frame=fr)
        except Exception:
            pass

        # ---- bottle (+ secondary motion) ----
        bloc, bq = bottle_transform(p)
        bloc, bq = apply_plunge(bloc, bq, p)   # entry follow-through (decays before the launch)
        bloc, bq = apply_sway(bloc, bq, p)
        bloc, bq = apply_settle(bloc, bq, p)
        ctrl.location = bloc
        if _prev_bot_q is not None and bq.dot(_prev_bot_q) < 0.0:
            bq.negate()
        _prev_bot_q = bq.copy()
        ctrl.rotation_quaternion = bq
        ctrl.keyframe_insert("location", frame=fr)
        ctrl.keyframe_insert("rotation_quaternion", frame=fr)

        # ---- sun fill: matches the sky sun; dimmed by murk ----
        if sun_obj and sun_data:
            elev_deg = lerp(14.0, 4.5, b)
            az_deg   = lerp(20.0, 30.0, b)     # sun stays LEFT in both worlds (never flips to frame-right)
            sun_obj.rotation_euler = Euler((math.radians(90.0 - elev_deg), 0.0,
                                            math.radians(az_deg)), "XYZ")
            sun_obj.keyframe_insert("rotation_euler", frame=fr)
            col = tuple(lerp(warm[i], golden[i], b) for i in range(3))
            sun_data.color = col
            sun_data.energy = lerp(2.6, 4.4, b) * (1.0 - 0.6 * m)   # stronger golden key on the Greece side (pale limestone reads sunlit)
            sun_data.keyframe_insert("color", frame=fr)
            sun_data.keyframe_insert("energy", frame=fr)

        if uw_data:
            uw_data.energy = uw * 150.0 * (1.0 - m) ** 2   # fill also dies at the murk peak — nothing backlights the swap
            uw_data.keyframe_insert("energy", frame=fr)

        # ---- god-ray gobo: strong shafts; teal on the Japan side -> golden toward Greece ----
        if gobo:
            flash = 1.0 + 6.0 * sstep(0.600, 0.625, p) * (1.0 - sstep(0.655, 0.70, p))   # GREECE-gold god-ray FLASH as the eye breaks up out of the murk — starts AFTER the swap (p0.585), so it REVEALS Greece, never floodlights the swap
            gobo["data"].energy = uw * 2600.0 * (0.4 + 0.6 * b) * (1.0 - m) ** 2 * flash   # rays still die into the murk peak (swap stays BLACK); bloom hard on the re-open
            gobo["data"].keyframe_insert("energy", frame=fr)
            gc0, gc1 = (0.75, 0.91, 0.93), (1.0, 0.86, 0.55)   # cool teal-white -> golden hour
            bg = min(1.0, 1.6 * b)                             # bias the shafts golden faster so the flash reads GREECE-gold
            gobo["data"].color = tuple(lerp(gc0[i], gc1[i], bg) for i in range(3))
            gobo["data"].keyframe_insert("color", frame=fr)
            if gobo.get("map") is not None:
                try:
                    rot = gobo["map"].inputs["Rotation"]
                    rot.default_value = (0.0, 0.0, p * 2.2)
                    rot.keyframe_insert("default_value", frame=fr)
                except Exception:
                    pass

        # ---- rim light: Japan intro + Greek finale, bottle-only ----
        if rim:
            rim["data"].energy = 2.2 * (1.0 - sstep(0.40, 0.50, p)) + 3.6 * sstep(0.76, 0.85, p)
            rim["data"].keyframe_insert("energy", frame=fr)
            rc0, rc1 = (0.92, 0.96, 0.97), (1.0, 0.85, 0.62)
            rim["data"].color = tuple(lerp(rc0[i], rc1[i], b) for i in range(3))
            rim["data"].keyframe_insert("color", frame=fr)

        # ---- sky: morning -> golden; dimmed while submerged ----
        if world:
            sky = world["sky"]; bg = world["bg"]
            try:
                sky.sun_elevation = math.radians(lerp(14.0, 4.5, b))
                sky.sun_rotation  = math.radians(lerp(20.0, 30.0, b))
                sky.keyframe_insert("sun_elevation", frame=fr)
                sky.keyframe_insert("sun_rotation", frame=fr)
            except Exception:
                pass
            bg.inputs["Strength"].default_value = 0.4 * (1.0 - 0.55 * m)
            bg.inputs["Strength"].keyframe_insert("default_value", frame=fr)

        # ---- ocean: tint blend, FFT time, scrolling micro-detail ----
        if ocean:
            wb = ocean["water_bsdf"]
            col = tuple(lerp(deepJ[i], deepG[i], b) for i in range(4))
            bc = wb.inputs.get("Base Color")
            if bc:
                bc.default_value = col
                bc.keyframe_insert("default_value", frame=fr)
            mod = ocean["mod"]
            try:
                mod.time = fr / fps
                ocean["obj"].keyframe_insert(data_path='modifiers["Ocean"].time', frame=fr)
            except Exception:
                pass
            try:
                m1, m2 = ocean["detail_maps"]
                l1 = m1.inputs["Location"]; l2 = m2.inputs["Location"]
                l1.default_value = (p * 0.55, p * 0.30, 0.0)
                l2.default_value = (-p * 0.38, p * 0.52, 0.0)
                l1.keyframe_insert("default_value", frame=fr)
                l2.keyframe_insert("default_value", frame=fr)
            except Exception:
                pass
            # ---- impact ripples: entry splash (p0.483) + rise exit (p0.702) ----
            try:
                rip = ocean.get("ripple")
                if rip:
                    t1 = clamp((p - 0.483) / 0.15, 0.0, 1.0)   # fall impact rings
                    t2 = clamp((p - 0.702) / 0.15, 0.0, 1.0)   # rise-exit rings
                    if p < 0.68:
                        t, env = t1, sstep(0.0, 0.05, t1) * (1.0 - sstep(0.45, 1.0, t1))
                    else:
                        t, env = t2, sstep(0.0, 0.07, t2) * (1.0 - sstep(0.45, 1.0, t2))
                    rip["phase"].default_value = t * 1.6        # ring front travels ~1.6 m
                    rip["amp"].default_value = env * 0.018   # ~1.8 cm ring height — reads clearly in motion
                    rip["phase"].keyframe_insert("default_value", frame=fr)
                    rip["amp"].keyframe_insert("default_value", frame=fr)
                    if 0.5235 < p < 0.5265:
                        print("  [ripple debug] p=%.4f amp=%.3f phase=%.3f" % (p, rip["amp"].default_value, rip["phase"].default_value))
            except Exception:
                pass

        # ---- underwater volume: luminous teal everywhere, a brief deep dip hides the swap ----
        if volume:
            sden = volume["scatter"].inputs["Density"]
            aden = volume["absorption"].inputs["Density"]
            # narrow spike right over the Japan->Greece swap so the far/near set change stays unseen
            swap_cover = sstep(0.55, 0.585, p) * (1.0 - sstep(0.585, 0.63, p))
            sden.default_value = m * 1.7 + uw * 0.05 + swap_cover * 2.2   # CLEAR reference-grade water in the cruise window; swap stays opaque via m+cover
            aden.default_value = m * 1.1 + uw * 0.025 + swap_cover * 1.8  # daylight reaches the boulder bed (~6 m) like the reference
            sden.keyframe_insert("default_value", frame=fr)
            aden.keyframe_insert("default_value", frame=fr)

        # ---- caustics: bloom through the turn, linger through the ascent ----
        if seabed and seabed.get("caustic"):
            cn = seabed["caustic"]
            cstr = (sstep(0.46, 0.55, p) * (1.0 - sstep(0.72, 0.82, p))) * 4.6   # brighter, lingers to the rise
            cn["emit"].inputs["Strength"].default_value = cstr
            cn["emit"].inputs["Strength"].keyframe_insert("default_value", frame=fr)
            try:
                l1 = cn["map1"].inputs["Location"]; l2 = cn["map2"].inputs["Location"]
                l1.default_value = (p * 2.0, p * 1.4, 0.0)
                l2.default_value = (-p * 1.5, p * 1.9, 0.0)
                l1.keyframe_insert("default_value", frame=fr)
                l2.keyframe_insert("default_value", frame=fr)
            except Exception:
                pass

        # ---- clouds drift ----
        if clouds and clouds.get("map") is not None:
            try:
                lc = clouds["map"].inputs["Location"]
                lc.default_value = (p * 60.0, p * 14.0, 0.0)
                lc.keyframe_insert("default_value", frame=fr)
            except Exception:
                pass

        # ---- photo backdrop: dim with murk; crossfades at swap + waterline ----
        bd = H.get("backdrop")
        if bd:
            for wsp in bd.get("walls", []):
                st = wsp["strength"]
                st.default_value = 8.0 * (1.0 - 0.45 * m)   # x8 compensates the -3 EV film exposure
                st.keyframe_insert("default_value", frame=fr)
                if wsp.get("fac") is not None:
                    wsp["fac"].default_value = 0.0 if p < SWAP_P else 1.0
                    wsp["fac"].keyframe_insert("default_value", frame=fr)
                if wsp.get("ufac") is not None:
                    wsp["ufac"].default_value = uw
                    wsp["ufac"].keyframe_insert("default_value", frame=fr)

        # ---- near-field underwater card: glows only while submerged ----
        uwc = H.get("uwcard")
        if uwc:
            uwc["strength"].default_value = uw * 16.0 * (1.0 - m) ** 2   # glows in clear water, DIES into the murk (swap stays hidden)
            uwc["strength"].keyframe_insert("default_value", frame=fr)

        # ---- foam rings ----
        for ring in rings:
            t = clamp((p - ring["p0"]) / (ring["p1"] - ring["p0"]), 0.0, 1.0)
            s = lerp(0.05, 1.0, e_p1_out(t)) * ring["maxr"]
            alive = 0.0 < (p - ring["p0"]) < (ring["p1"] - ring["p0"])
            fac = ((1.0 - t) ** 1.6) * 0.85 if alive else 0.0
            ob = ring["obj"]
            ob.scale = (s, s, s)
            ob.keyframe_insert("scale", frame=fr)
            ring["fac"].default_value = fac
            ring["fac"].keyframe_insert("default_value", frame=fr)

        # ---- compositor: teal grade underwater ----
        if comp:
            try:
                fac = comp["balance_fac"]
                fac.default_value = clamp(m * 0.55 + uw * 0.22, 0.0, 0.8)
                fac.keyframe_insert("default_value", frame=fr)
            except Exception:
                pass

    # ---- Japan -> Greece hard swap, hidden under peak murk ----
    swap_fr = 1 + int(round(SWAP_P * frames))
    def key_vis(objs, visible_before):
        for ob in objs:
            ob.hide_render = not visible_before
            ob.hide_viewport = not visible_before
            ob.keyframe_insert("hide_render", frame=1)
            ob.keyframe_insert("hide_viewport", frame=1)
            ob.keyframe_insert("hide_render", frame=swap_fr - 1)
            ob.keyframe_insert("hide_viewport", frame=swap_fr - 1)
            ob.hide_render = visible_before
            ob.hide_viewport = visible_before
            ob.keyframe_insert("hide_render", frame=swap_fr)
            ob.keyframe_insert("hide_viewport", frame=swap_fr)
            ob.keyframe_insert("hide_render", frame=1 + frames)
            ob.keyframe_insert("hide_viewport", frame=1 + frames)
    key_vis(list(C_jp.objects), True)
    key_vis(list(C_gr.objects), False)
    # single-image walls: only show them during their own act
    bd = H.get("backdrop")
    for wsp in (bd.get("walls", []) if bd else []):
        if wsp.get("solo") == "J" and wsp.get("ufac") is None:
            key_vis([wsp["obj"]], True)
        elif wsp.get("solo") == "G" and wsp.get("ufac") is None:
            key_vis([wsp["obj"]], False)

    # ---- interpolation: LINEAR for the dense bake, CONSTANT for hides ----
    for act in bpy.data.actions:
        for fc in act.fcurves:
            is_hide = "hide" in fc.data_path
            for kp in fc.keyframe_points:
                kp.interpolation = "CONSTANT" if is_hide else "LINEAR"

# ==============================================================================
#  BUILD
# ==============================================================================
def build():
    report = []
    scene = bpy.context.scene
    purge_scene()

    q = QUALITY.get(CONFIG["quality"], QUALITY["final"])
    frames = CONFIG["frames"]
    fps = CONFIG["fps"]
    scene.frame_start = 1
    scene.frame_end = 1 + frames + fps    # hold the S6 finale ~1s (CONSTANT extrapolation holds the last pose)
    scene.render.fps = fps

    asset_dir = resolve_asset_dir()
    label_path = os.path.join(asset_dir, CONFIG["label_img_name"]) if asset_dir else ""
    glb_path = os.path.join(asset_dir, CONFIG["bottle_glb_name"]) if asset_dir else ""
    report.append("Quality preset: " + CONFIG["quality"] +
                  "  (%d spp, %dx%d)" % (q["spp"], q["rx"], q["ry"]))
    report.append("Asset dir: " + (asset_dir or "(none found — procedural bottle, no label)"))

    bgj = os.path.join(asset_dir, CONFIG["bg_japan_name"]) if asset_dir else ""
    bgg = os.path.join(asset_dir, CONFIG["bg_greece_name"]) if asset_dir else ""
    bgj = bgj if (bgj and os.path.isfile(bgj)) else ""
    bgg = bgg if (bgg and os.path.isfile(bgg)) else ""
    bgu = os.path.join(asset_dir, CONFIG["bg_underwater_name"]) if asset_dir else ""
    bgu = bgu if (bgu and os.path.isfile(bgu)) else ""
    bgjl = os.path.join(asset_dir, CONFIG["bg_japan_left_name"]) if asset_dir else ""
    bgjl = bgjl if (bgjl and os.path.isfile(bgjl)) else ""
    bggl = os.path.join(asset_dir, CONFIG["bg_greece_left_name"]) if asset_dir else ""
    bggl = bggl if (bggl and os.path.isfile(bggl)) else ""
    use_photo = CONFIG["photo_backdrop"] and (bgj or bgg or bgu or bgjl or bggl)
    found = [n for n, v in (("japan", bgj), ("greece", bgg), ("underwater", bgu),
                            ("japan-left", bgjl), ("greece-left", bggl)) if v]
    if use_photo:
        report.append("Photo backdrop: " + ", ".join(found) +
                      "  (far scenery/clouds skipped for covered acts)")

    C_env    = make_collection("ENV")
    C_jp     = make_collection("JP")
    C_gr     = make_collection("GR")
    C_bottle = make_collection("BOTTLE")
    C_fx     = make_collection("FX")

    handles = {}

    def step(name, fn):
        try:
            handles[name] = fn()
            report.append("  ok  " + name)
        except Exception as e:
            report.append("  !!  " + name + "  ->  " + repr(e))

    if CONFIG["build_world"]:
        step("world", lambda: build_world())
    if CONFIG["build_atmosphere"] and not use_photo:
        step("atmosphere", lambda: build_atmosphere(C_env))   # photos carry their own haze
    if CONFIG["build_clouds"] and not use_photo:
        step("clouds", lambda: build_clouds(C_env))
    step("lights", lambda: build_lights(C_env, C_bottle))
    if CONFIG["build_ocean"]:
        step("ocean", lambda: build_ocean(C_env, q))
    if CONFIG["build_seabed"]:
        step("seabed", lambda: build_seabed(C_env))
    if CONFIG["build_volume"]:
        step("volume", lambda: build_volume(C_env))
    if CONFIG["build_kelp"]:
        step("kelp", lambda: build_kelp(C_env))

    # near + far sets
    rock_j  = rock_mat("Rock_J", HEX["rockJ"], moss=True, bump_scale=18.0)   # finer volcanic grain (reference detail)
    rock_g  = rock_mat("Rock_G", HEX["rockG"], strata=True)
    shelf_j = rock_mat("Shelf_J", HEX["shelfJ"], moss=True)
    shelf_g = rock_mat("Shelf_G", HEX["shelfG"], strata=True)
    if CONFIG["build_near_japan"]:
        step("shelf_J", lambda: build_shelf(C_jp, shelf_j, 7))
        # reference staging: bottle's RIGHT stays clean open water — all rocks pile LEFT
        # (world +x), no offshore stacks, more rocks at full detail out to 6 m
        step("boulders_J", lambda: build_boulders(C_jp, rock_j, 7, 36, 26, 0, 1.15, style="volcanic",
                                                  p_samples=P_JP, x_side=1, detail_r2=36.0, big_n=8))
    if CONFIG["build_lakebed"]:
        step("lakebed_rocks", lambda: build_lakebed_rocks(C_env, rock_j))   # shared bed — mossy dark volcanic reads as algae-covered stone
        if CONFIG["build_basalt"]:
            step("basalt", lambda: build_basalt(C_jp, rock_j, 13))
    if CONFIG["build_near_greece"]:
        step("shelf_G", lambda: build_shelf(C_gr, shelf_g, 23))
        step("boulders_G", lambda: build_boulders(C_gr, rock_g, 23, 26, 18, 6, 0.85, style="limestone", p_samples=P_GR))
    if CONFIG["build_far_japan"] and not bgj:
        step("fuji", lambda: build_fuji(C_jp))
    if CONFIG["build_far_greece"] and not bgg:
        step("cliffs", lambda: build_cliffs(C_gr))
        if CONFIG["build_village"]:
            step("village", lambda: build_village(C_gr))

    if CONFIG["build_pebbles"]:
        def pebbles():
            made = []
            pj = build_pebble_instance("Pebble_J", "#2e3234", 6.0)
            pg = build_pebble_instance("Pebble_G", "#d9d0bc", 7.0)
            sh_j = handles.get("shelf_J"); sh_g = handles.get("shelf_G")
            if sh_j is not None:
                made.append(scatter_pebbles(sh_j, pj, 260, 0.011))
            if sh_g is not None:
                made.append(scatter_pebbles(sh_g, pg, 380, 0.012))
            sb = handles.get("seabed")
            if sb is not None:
                made.append(scatter_pebbles(sb["obj"], pj, 160, 0.05))
            return made
        step("pebbles", pebbles)

    # ---- bottle rig ----
    ctrl = bpy.data.objects.new("Bottle_CTRL", None)
    ctrl.empty_display_size = 0.1
    ctrl.rotation_mode = "QUATERNION"
    C_bottle.objects.link(ctrl)
    geo = bpy.data.objects.new("Bottle_GEO", None)
    geo.empty_display_size = 0.05
    geo.rotation_euler = Euler((0.0, 0.0, math.radians(151.0)), "XYZ")  # label facing
    C_bottle.objects.link(geo)
    geo.parent = ctrl
    handles["ctrl"] = ctrl

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
                report.append("  ok  bottle (procedural, real glass walls)")
            except Exception as e:
                report.append("  !!  procedural bottle failed. " + repr(e))
        for pth in parts:
            if pth.parent is None:
                pth.parent = geo
                pth.matrix_parent_inverse = Matrix.Identity(4)

    if CONFIG["build_particles"]:
        step("particles", lambda: build_particles(C_fx, frames, geo))
    if CONFIG["build_rings"]:
        step("rings", lambda: build_rings(C_fx, frames))

    step("camera", lambda: build_camera(C_env, ctrl))
    handles["cam"] = handles.get("camera")

    if bgu and handles.get("cam") is not None:
        step("uwcard", lambda: build_uwcard(C_env, bgu, handles["cam"], q))   # camera billboard: the far wall is murk-opaque underwater

    if use_photo and handles.get("cam") is not None:
        step("backdrop", lambda: build_backdrop(C_env, handles["cam"], q, bgj, bgg, bgu, bgjl, bggl))

    if CONFIG["build_compositor"]:
        step("comp", lambda: build_compositor(scene))

    setup_render(scene, q)

    if CONFIG["bake_animation"] and handles.get("cam") is not None:
        try:
            bake_animation(scene, handles, C_jp, C_gr, frames, fps)
            report.append("  ok  animation baked (%d frames, %.1f s @ %d fps)"
                          % (frames + 1, (frames + 1) / fps, fps))
        except Exception as e:
            report.append("  !!  bake_animation -> " + repr(e))

    scene.frame_set(1)

    # ---- surface the report inside the UI (macOS has no visible console) ----
    try:
        txt = bpy.data.texts.get("MASTRY_REPORT") or bpy.data.texts.new("MASTRY_REPORT")
        txt.clear()
        txt.write("\n".join(report))
    except Exception:
        pass
    ok_bd = handles.get("backdrop") is not None
    key_lines = [
        "Asset dir: " + (asset_dir or "NOT FOUND"),
        ("Backdrop photos: " + ", ".join(found)) if ok_bd else
        "Backdrop MISSING - set CONFIG['asset_dir'] to your assets folder path",
        "View: Numpad 0, then Z > Rendered.  Full log: MASTRY_REPORT text",
    ]
    # popup_menu SEGFAULTS in headless/background mode (no UI window) — a hard crash a
    # try/except can't catch — so only show it when Blender actually has a UI.
    if not bpy.app.background:
        try:
            def _draw(self, _ctx):
                for ln in key_lines:
                    self.layout.label(text=ln)
            bpy.context.window_manager.popup_menu(
                _draw, title="MASTRY v5 — " + ("OK" if ok_bd else "check assets"),
                icon="INFO" if ok_bd else "ERROR")
        except Exception:
            pass

    print("\n" + "=" * 68 + "\n MASTRY MAX — Blender build report\n" + "=" * 68)
    for r in report:
        print(r)
    print("=" * 68)
    print(" Scrub the timeline · F12 = still · Render ▸ Animation -> %s" % CONFIG["render_out"])
    print(" progress = (frame-1)/%d  — maps 1:1 onto the web scroll.\n" % CONFIG["frames"])

# ------------------------------------------------------------------------------
if __name__ == "__main__":
    build()
