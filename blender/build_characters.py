"""Builds hero.glb (classic + symbiote suits on one rig) and npc.glb.

Run:  ~/.bpyenv/bin/python blender/build_characters.py  (or npm run assets)
"""
import os
import sys
import math
sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from common import (reset, material, grid_texture, ellipsoid, limb, box, cylinder, bind_rigid,  # noqa: E402
                    join, skin, build_armature, Animator, export_glb)
import anims  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "models")


def skeleton(name, scale=1.0):
    s = scale
    B = []

    def b(n, h, t, p):
        B.append((n, tuple(v * s for v in h), tuple(v * s for v in t), p))
    b("root", (0, 0, 0), (0, 0.2, 0), None)
    b("hips", (0, 0, 0.95), (0, 0, 1.05), "root")
    b("spine", (0, 0, 1.05), (0, 0, 1.2), "hips")
    b("chest", (0, 0, 1.2), (0, 0, 1.42), "spine")
    b("neck", (0, 0, 1.42), (0, 0, 1.52), "chest")
    b("head", (0, 0, 1.52), (0, 0, 1.78), "neck")
    for side, x in (("L", 1), ("R", -1)):
        b(f"shoulder.{side}", (0.03 * x, 0, 1.38), (0.17 * x, 0, 1.40), "chest")
        b(f"upper_arm.{side}", (0.17 * x, 0, 1.40), (0.45 * x, 0, 1.40), f"shoulder.{side}")
        b(f"forearm.{side}", (0.45 * x, 0, 1.40), (0.71 * x, 0, 1.40), f"upper_arm.{side}")
        b(f"hand.{side}", (0.71 * x, 0, 1.40), (0.80 * x, 0, 1.40), f"forearm.{side}")
        b(f"thigh.{side}", (0.10 * x, 0, 0.95), (0.10 * x, 0, 0.52), "hips")
        b(f"shin.{side}", (0.10 * x, 0, 0.52), (0.10 * x, 0, 0.09), f"thigh.{side}")
        b(f"foot.{side}", (0.10 * x, 0, 0.09), (0.10 * x, -0.15, 0.02), f"shin.{side}")
    return build_armature(name, B)


def body_parts(prefix, M, bulk=1.0, symbiote=False):
    """M: dict of materials: main, secondary, boot, glove, eye, frame, emblem"""
    k = bulk
    P = []

    def add(o, bone):
        P.append(bind_rigid(o, bone))
    # head + eyes
    add(ellipsoid(f"{prefix}head", (0, -0.005, 1.645), (0.104 * k, 0.116 * k, 0.13 * k), M["main"], 20, 14), "head")
    for side, x in (("L", 1), ("R", -1)):
        tilt = (0, x * (0.55 if symbiote else 0.42), 0)
        sz = (0.048, 0.016, 0.034) if symbiote else (0.042, 0.016, 0.03)
        add(ellipsoid(f"{prefix}eyeframe{side}", (0.046 * x, -0.098 * k, 1.665), sz, M["frame"], 12, 8, rot=tilt), "head")
        add(ellipsoid(f"{prefix}eye{side}", (0.047 * x, -0.108 * k, 1.665),
                      (sz[0] * 0.78, 0.012, sz[2] * 0.72), M["eye"], 12, 8, rot=tilt), "head")
    add(limb(f"{prefix}neck", (0, 0, 1.42), (0, 0, 1.56), 0.055 * k, 0.05 * k, M["main"]), "neck")
    # torso
    add(ellipsoid(f"{prefix}chest", (0, 0.005, 1.3), (0.185 * k, 0.118 * k, 0.16 * k), M["main"], 20, 14), "chest")
    add(ellipsoid(f"{prefix}abs", (0, 0.0, 1.12), (0.145 * k, 0.1 * k, 0.125 * k), M["main"], 18, 12), "spine")
    add(ellipsoid(f"{prefix}pelvis", (0, 0.008, 0.955), (0.158 * k, 0.108 * k, 0.105 * k), M["secondary"], 18, 12), "hips")
    if not symbiote:
        for side, x in (("L", 1), ("R", -1)):
            add(ellipsoid(f"{prefix}side{side}", (0.118 * x, 0.012, 1.2), (0.07, 0.1, 0.17), M["secondary"], 14, 10), "spine")
        add(cylinder(f"{prefix}belt", (0, 0.005, 1.04), 0.148, 0.03, M["frame"], 20), "hips")
    for side, x in (("L", 1), ("R", -1)):
        add(ellipsoid(f"{prefix}delt{side}", (0.185 * x, 0, 1.39), (0.078 * k, 0.074 * k, 0.072 * k), M["main"], 14, 10), f"upper_arm.{side}")
        add(limb(f"{prefix}uarm{side}", (0.2 * x, 0, 1.4), (0.45 * x, 0, 1.4), 0.058 * k, 0.047 * k, M["secondary"]), f"upper_arm.{side}")
        add(limb(f"{prefix}farm{side}", (0.45 * x, 0, 1.4), (0.7 * x, 0, 1.4), 0.047 * k, 0.036 * k, M["glove"]), f"forearm.{side}")
        add(ellipsoid(f"{prefix}hand{side}", (0.755 * x, -0.005, 1.395), (0.052, 0.034, 0.046), M["glove"], 12, 8), f"hand.{side}")
        if symbiote:
            add(ellipsoid(f"{prefix}handmark{side}", (0.755 * x, 0.012, 1.405), (0.04, 0.03, 0.03), M["emblem"], 10, 6), f"hand.{side}")
        add(limb(f"{prefix}thigh{side}", (0.1 * x, 0, 0.97), (0.1 * x, 0, 0.52), 0.083 * k, 0.058 * k, M["secondary"]), f"thigh.{side}")
        add(limb(f"{prefix}shin{side}", (0.1 * x, 0, 0.52), (0.1 * x, 0, 0.1), 0.058 * k, 0.042 * k, M["secondary"]), f"shin.{side}")
        add(limb(f"{prefix}boot{side}", (0.1 * x, 0, 0.34), (0.1 * x, 0, 0.08), 0.05 * k, 0.044 * k, M["boot"]), f"shin.{side}")
        add(ellipsoid(f"{prefix}foot{side}", (0.1 * x, -0.055, 0.045), (0.048, 0.112, 0.045), M["boot"], 12, 8), f"foot.{side}")
    # emblem
    if symbiote:
        add(ellipsoid(f"{prefix}emb", (0, -0.121, 1.31), (0.034, 0.012, 0.055), M["emblem"], 12, 8), "chest")
        add(ellipsoid(f"{prefix}embh", (0, -0.116, 1.37), (0.024, 0.012, 0.024), M["emblem"], 10, 6), "chest")
        for x in (1, -1):
            # upper legs sweep over the shoulders onto the back
            add(limb(f"{prefix}ul{x}a", (0.02 * x, -0.122, 1.35), (0.1 * x, -0.108, 1.43), 0.013, 0.011, M["emblem"], 8, 6), "chest")
            add(limb(f"{prefix}ul{x}b", (0.1 * x, -0.108, 1.43), (0.15 * x, -0.02, 1.47), 0.011, 0.009, M["emblem"], 8, 6), "chest")
            add(limb(f"{prefix}ul{x}c", (0.15 * x, -0.02, 1.47), (0.12 * x, 0.1, 1.38), 0.009, 0.007, M["emblem"], 8, 6), "chest")
            # lower legs wrap round the ribs
            add(limb(f"{prefix}ll{x}a", (0.02 * x, -0.122, 1.28), (0.12 * x, -0.1, 1.2), 0.012, 0.01, M["emblem"], 8, 6), "chest")
            add(limb(f"{prefix}ll{x}b", (0.12 * x, -0.1, 1.2), (0.17 * x, 0.0, 1.16), 0.01, 0.007, M["emblem"], 8, 6), "chest")
    else:
        add(ellipsoid(f"{prefix}emb", (0, -0.121, 1.33), (0.014, 0.008, 0.024), M["frame"], 8, 6), "chest")
        for i, (ang, ln) in enumerate(((35, 0.05), (15, 0.045), (-15, 0.045), (-35, 0.05))):
            for x in (1, -1):
                a = math.radians(ang)
                st = (0.008 * x, -0.121, 1.33)
                en = (x * (0.008 + ln * math.cos(a)), -0.118, 1.33 + ln * math.sin(a) * 1.2)
                add(limb(f"{prefix}sl{i}{x}", st, en, 0.004, 0.003, M["frame"], 6, 4), "chest")
    return P


def build_hero():
    reset()
    arm_obj = skeleton("HeroRig")
    red_tex = grid_texture("web_red", (0.62, 0.02, 0.03), (0.08, 0.0, 0.01), 256, (16, 12), 2)
    blue_tex = grid_texture("suit_blue", (0.03, 0.08, 0.36), (0.02, 0.05, 0.25), 128, (8, 8), 1)
    sym_tex = grid_texture("sym_black", (0.012, 0.012, 0.018), (0.035, 0.04, 0.06), 256, (10, 14), 1)
    classic = {
        "main": material("Classic_Red", (1, 1, 1), rough=0.55, image=red_tex),
        "secondary": material("Classic_Blue", (1, 1, 1), rough=0.6, image=blue_tex),
        "glove": material("Classic_Red", (1, 1, 1)),
        "boot": material("Classic_Red", (1, 1, 1)),
        "eye": material("Classic_Lens", (0.92, 0.95, 1.0), rough=0.15, emit=(0.6, 0.7, 0.8), emit_strength=0.4),
        "frame": material("Classic_Black", (0.01, 0.01, 0.012), rough=0.4),
    }
    sym = {
        "main": material("Symbiote_Black", (1, 1, 1), rough=0.22, coat=1.0, image=sym_tex),
        "eye": material("Symbiote_Lens", (0.95, 0.97, 1.0), rough=0.2, emit=(0.8, 0.85, 1.0), emit_strength=0.6),
        "emblem": material("Symbiote_White", (0.93, 0.94, 0.96), rough=0.35),
    }
    sym["secondary"] = sym["glove"] = sym["boot"] = sym["frame"] = sym["main"]
    c_parts = body_parts("c_", classic)
    classic_obj = join(c_parts, "Suit_Classic")
    skin(classic_obj, arm_obj)
    s_parts = body_parts("s_", sym, bulk=1.05, symbiote=True)
    sym_obj = join(s_parts, "Suit_Symbiote")
    skin(sym_obj, arm_obj)
    animate(arm_obj, anims.HERO_CLIPS)
    os.makedirs(OUT, exist_ok=True)
    export_glb(os.path.join(OUT, "hero.glb"))


def build_npc():
    reset()
    arm_obj = skeleton("NpcRig")
    M = {
        "skin": material("Skin", (0.62, 0.43, 0.32), rough=0.7),
        "jacket": material("Jacket", (0.8, 0.8, 0.8), rough=0.8),
        "pants": material("Pants", (0.12, 0.14, 0.2), rough=0.85),
        "shoe": material("Shoes", (0.05, 0.05, 0.05), rough=0.6),
        "hat": material("Hat", (0.1, 0.1, 0.1), rough=0.9),
        "eye": material("NpcEye", (0.02, 0.02, 0.02), rough=0.3),
    }
    P = []

    def add(o, bone):
        P.append(bind_rigid(o, bone))
    add(ellipsoid("head", (0, 0.0, 1.64), (0.1, 0.11, 0.125), M["skin"], 16, 12), "head")
    add(ellipsoid("hat", (0, 0.01, 1.7), (0.105, 0.115, 0.09), M["hat"], 16, 10), "head")
    for x in (1, -1):
        add(ellipsoid(f"eye{x}", (0.038 * x, -0.1, 1.645), (0.014, 0.008, 0.012), M["eye"], 8, 6), "head")
    add(ellipsoid("nose", (0, -0.112, 1.615), (0.018, 0.02, 0.026), M["skin"], 8, 6), "head")
    add(limb("neck", (0, 0, 1.42), (0, 0, 1.56), 0.055, 0.05, M["skin"]), "neck")
    add(ellipsoid("chest", (0, 0.01, 1.29), (0.2, 0.13, 0.17), M["jacket"], 18, 12), "chest")
    add(ellipsoid("belly", (0, -0.005, 1.1), (0.165, 0.125, 0.14), M["jacket"], 16, 10), "spine")
    add(ellipsoid("pelvis", (0, 0.008, 0.95), (0.16, 0.11, 0.11), M["pants"], 16, 10), "hips")
    for side, x in (("L", 1), ("R", -1)):
        add(ellipsoid(f"delt{side}", (0.19 * x, 0, 1.39), (0.08, 0.078, 0.075), M["jacket"], 12, 8), f"upper_arm.{side}")
        add(limb(f"uarm{side}", (0.2 * x, 0, 1.4), (0.46 * x, 0, 1.4), 0.064, 0.055, M["jacket"]), f"upper_arm.{side}")
        add(limb(f"farm{side}", (0.45 * x, 0, 1.4), (0.66 * x, 0, 1.4), 0.056, 0.046, M["jacket"]), f"forearm.{side}")
        add(ellipsoid(f"hand{side}", (0.74 * x, -0.005, 1.395), (0.055, 0.035, 0.048), M["skin"], 10, 8), f"hand.{side}")
        add(limb(f"thigh{side}", (0.1 * x, 0, 0.97), (0.1 * x, 0, 0.52), 0.085, 0.064, M["pants"]), f"thigh.{side}")
        add(limb(f"shin{side}", (0.1 * x, 0, 0.52), (0.1 * x, 0, 0.1), 0.064, 0.052, M["pants"]), f"shin.{side}")
        add(ellipsoid(f"foot{side}", (0.1 * x, -0.05, 0.05), (0.055, 0.12, 0.05), M["shoe"], 10, 8), f"foot.{side}")
    body = join(P, "NpcBody")
    skin(body, arm_obj)
    animate(arm_obj, anims.NPC_CLIPS)
    export_glb(os.path.join(OUT, "npc.glb"))


def animate(arm_obj, clips):
    A = Animator(arm_obj)
    speeds = {}
    for name, (fn, loop) in clips.items():
        keys, speed = anims.build_keys(fn)
        A.clip(name, keys, loop=loop)
        if speed:
            speeds[name] = round(speed, 4)
    # authored ground speeds travel with the file (game re-measures anyway)
    arm_obj["clipGroundSpeed"] = speeds


if __name__ == "__main__":
    which = sys.argv[-1] if len(sys.argv) > 1 else "all"
    if which in ("all", "hero"):
        build_hero()
    if which in ("all", "npc"):
        build_npc()
    print("characters done")
