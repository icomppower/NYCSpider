"""Vehicles + street furniture kit -> vehicles.glb, props.glb.
Each top-level object is exported by name so the game can instance it."""
import os
import sys
import math
sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from common import reset, material, ellipsoid, limb, box, cylinder, cone, join, export_glb  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "models")


def parent_all(objs, name):
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for o in objs:
        o.parent = root
    return root


def mats():
    return {
        "paint": material("Paint", (0.8, 0.8, 0.8), rough=0.3, metal=0.4, coat=1.0),
        "taxi": material("TaxiYellow", (0.95, 0.68, 0.05), rough=0.35, metal=0.3, coat=1.0),
        "glass": material("Glass", (0.03, 0.05, 0.08), rough=0.08, metal=0.6),
        "tire": material("Tire", (0.03, 0.03, 0.03), rough=0.9),
        "rim": material("Chrome", (0.8, 0.8, 0.82), rough=0.2, metal=1.0),
        "head": material("Headlight", (1, 1, 0.9), emit=(1, 0.95, 0.8), emit_strength=3),
        "tail": material("Taillight", (0.6, 0.02, 0.02), emit=(1, 0.05, 0.05), emit_strength=2),
        "trim": material("Trim", (0.05, 0.05, 0.05), rough=0.5),
        "bus": material("BusWhite", (0.88, 0.9, 0.92), rough=0.4, coat=0.5),
        "busblue": material("BusBlue", (0.05, 0.2, 0.6), rough=0.4),
        "sign": material("TaxiSign", (1, 1, 0.9), emit=(1, 0.9, 0.5), emit_strength=1.5),
        "metal": material("DarkMetal", (0.08, 0.09, 0.1), rough=0.45, metal=0.8),
        "green": material("ParkGreen", (0.08, 0.2, 0.12), rough=0.5, metal=0.5),
        "red": material("HydrantRed", (0.7, 0.06, 0.04), rough=0.5, metal=0.2),
        "wood": material("Wood", (0.35, 0.2, 0.1), rough=0.8),
        "leaf": material("Leaves", (0.12, 0.32, 0.1), rough=0.9),
        "bark": material("Bark", (0.2, 0.14, 0.09), rough=0.95),
        "lamp": material("LampGlow", (1, 0.9, 0.7), emit=(1, 0.85, 0.55), emit_strength=4),
        "tl_r": material("TL_Red", (0.3, 0.02, 0.02), emit=(1, 0.05, 0.03), emit_strength=0.0),
        "tl_y": material("TL_Yellow", (0.3, 0.25, 0.02), emit=(1, 0.7, 0.05), emit_strength=0.0),
        "tl_g": material("TL_Green", (0.02, 0.3, 0.1), emit=(0.1, 1, 0.4), emit_strength=0.0),
        "blue": material("MailBlue", (0.05, 0.15, 0.45), rough=0.5, metal=0.3),
        "tank": material("TankWood", (0.33, 0.24, 0.17), rough=0.9),
        "ac": material("ACGrey", (0.6, 0.62, 0.62), rough=0.6, metal=0.5),
        "concrete": material("Concrete", (0.5, 0.5, 0.48), rough=0.95),
        "news": material("NewsBox", (0.75, 0.1, 0.1), rough=0.5),
    }


def wheels(M, xs, zs, r, w, name):
    out = []
    for i, x in enumerate(xs):
        for j, zz in enumerate(zs):
            t = cylinder(f"{name}_wheel{i}{j}", (x, zz, r), r, w, M["tire"], 14, rot=(0, math.pi / 2, 0))
            h = cylinder(f"{name}_hub{i}{j}", (x + (w / 2 + 0.005) * (1 if x > 0 else -1), zz, r), r * 0.55, 0.02, M["rim"], 12, rot=(0, math.pi / 2, 0))
            out.append(join([t, h], f"{name}_Wheel{i}{j}"))
    return out


def car(name, M, paint, L=4.4, W=1.8, H=1.45, taxi=False):
    """Car faces -Y in Blender (=> +Z forward in glTF / three.js)."""
    hl = L / 2
    body = box(f"{name}_body", (0, 0, 0.55), (W, L, 0.6), paint, bevel=0.12, smooth=True)
    cab = box(f"{name}_cab", (0, 0.25, 1.05), (W * 0.86, L * 0.48, 0.5), paint, bevel=0.1, smooth=True)
    glass = box(f"{name}_glass", (0, 0.25, 1.06), (W * 0.88, L * 0.44, 0.4), M["glass"], bevel=0.06)
    parts = [body, cab, glass]
    for x in (1, -1):
        parts.append(box(f"{name}_hl{x}", (0.62 * x * W / 1.8, -hl + 0.02, 0.62), (0.3, 0.06, 0.12), M["head"]))
        parts.append(box(f"{name}_tl{x}", (0.66 * x * W / 1.8, hl - 0.02, 0.66), (0.26, 0.06, 0.1), M["tail"]))
    parts.append(box(f"{name}_bumperF", (0, -hl, 0.35), (W * 0.98, 0.12, 0.16), M["trim"], bevel=0.03))
    parts.append(box(f"{name}_bumperR", (0, hl, 0.35), (W * 0.98, 0.12, 0.16), M["trim"], bevel=0.03))
    if taxi:
        parts.append(box(f"{name}_sign", (0, 0.3, 1.38), (0.5, 0.2, 0.16), M["sign"], bevel=0.02))
        parts.append(box(f"{name}_stripe", (0, 0, 0.62), (W + 0.01, L * 0.7, 0.07), M["trim"]))
    body = join(parts, f"{name}_Body")
    ws = wheels(M, (W / 2 - 0.12, -W / 2 + 0.12), (-hl + 0.8, hl - 0.8), 0.34, 0.24, name)
    return parent_all([body] + ws, name)


def van(M):
    L, W = 5.2, 2.0
    body = box("van_body", (0, 0, 1.2), (W, L, 1.9), M["paint"], bevel=0.12, smooth=True)
    glass = box("van_ws", (0, -L / 2 + 0.3, 1.55), (W * 0.92, 0.5, 0.6), M["glass"], bevel=0.05)
    hl = [box(f"van_hl{x}", (0.7 * x, -L / 2, 0.65), (0.3, 0.06, 0.15), M["head"]) for x in (1, -1)]
    tl = [box(f"van_tl{x}", (0.85 * x, L / 2, 0.8), (0.18, 0.06, 0.3), M["tail"]) for x in (1, -1)]
    b = join([body, glass] + hl + tl, "Van_Body")
    ws = wheels(M, (W / 2 - 0.12, -W / 2 + 0.12), (-L / 2 + 0.9, L / 2 - 0.9), 0.38, 0.26, "van")
    return parent_all([b] + ws, "Van")


def bus(M):
    L, W = 11.5, 2.55
    body = box("bus_body", (0, 0, 1.75), (W, L, 2.8), M["bus"], bevel=0.15, smooth=True)
    band = box("bus_band", (0, 0, 1.05), (W + 0.02, L - 0.3, 0.35), M["busblue"])
    win = box("bus_win", (0, 0.4, 2.2), (W + 0.02, L - 1.8, 0.95), M["glass"])
    ws = box("bus_ws", (0, -L / 2, 2.0), (W * 0.9, 0.1, 1.5), M["glass"])
    sign = box("bus_sign", (0, -L / 2 - 0.02, 3.0), (1.6, 0.06, 0.25), M["sign"])
    hl = [box(f"bus_hl{x}", (0.95 * x, -L / 2 - 0.02, 0.7), (0.3, 0.06, 0.15), M["head"]) for x in (1, -1)]
    tl = [box(f"bus_tl{x}", (1.05 * x, L / 2 + 0.02, 0.9), (0.2, 0.06, 0.4), M["tail"]) for x in (1, -1)]
    b = join([body, band, win, ws, sign] + hl + tl, "Bus_Body")
    wh = wheels(M, (W / 2 - 0.15, -W / 2 + 0.15), (-L / 2 + 2.2, L / 2 - 2.6), 0.5, 0.3, "bus")
    return parent_all([b] + wh, "Bus")


def build_vehicles():
    reset()
    M = mats()
    car("Sedan", M, M["paint"])
    car("Taxi", M, M["taxi"], taxi=True)
    car("Coupe", M, M["paint"], L=4.1, W=1.78, H=1.3)
    van(M)
    bus(M)
    export_glb(os.path.join(OUT, "vehicles.glb"), {"export_animations": False})


def build_props():
    reset()
    M = mats()

    def group(name, parts):
        return join(parts, name)
    # street lamp (NYC 'cobra head')
    group("StreetLamp", [
        cylinder("sl_base", (0, 0, 0.4), 0.16, 0.8, M["green"], 10),
        cylinder("sl_pole", (0, 0, 3.8), 0.08, 6.4, M["green"], 10),
        limb("sl_arm", (0, 0, 6.8), (0, -1.6, 7.2), 0.05, 0.04, M["green"], 8, 6),
        box("sl_head", (0, -1.8, 7.15), (0.35, 0.8, 0.15), M["green"], bevel=0.04),
        box("sl_glow", (0, -1.8, 7.06), (0.28, 0.66, 0.04), M["lamp"]),
    ])
    # traffic light on a mast arm: lights named for runtime switching
    tl_parts = [cylinder("tl_pole", (0, 0, 3.0), 0.12, 6.0, M["metal"], 10),
                limb("tl_arm", (0, 0, 5.6), (0, -4.5, 5.6), 0.07, 0.05, M["metal"], 8, 6),
                box("tl_box", (0, -3.8, 5.0), (0.36, 0.3, 1.05), M["metal"], bevel=0.03)]
    group("TrafficLight", tl_parts)
    for n, z, m in (("TL_R", 5.33, "tl_r"), ("TL_Y", 5.0, "tl_y"), ("TL_G", 4.67, "tl_g")):
        o = cylinder(n, (0, -3.97, z), 0.11, 0.04, M[m], 12, rot=(math.pi / 2, 0, 0))
    # ped signal box on the pole
    group("Hydrant", [
        cylinder("hy_b", (0, 0, 0.3), 0.13, 0.6, M["red"], 12),
        ellipsoid("hy_t", (0, 0, 0.62), (0.13, 0.13, 0.1), M["red"], 12, 6),
        cylinder("hy_s", (0, 0, 0.42), 0.05, 0.4, M["red"], 8, rot=(0, math.pi / 2, 0)),
        cylinder("hy_f", (0, 0, 0.62), 0.05, 0.4, M["red"], 8, rot=(math.pi / 2, 0, 0)),
    ])
    group("TrashCan", [
        cylinder("tc", (0, 0, 0.45), 0.3, 0.9, M["green"], 14),
        cylinder("tc_rim", (0, 0, 0.9), 0.32, 0.05, M["metal"], 14),
    ])
    group("Bench", [
        box("b_seat", (0, 0, 0.45), (1.8, 0.45, 0.06), M["wood"]),
        box("b_back", (0, 0.22, 0.75), (1.8, 0.05, 0.4), M["wood"]),
        box("b_l1", (0.8, 0, 0.22), (0.06, 0.45, 0.45), M["metal"]),
        box("b_l2", (-0.8, 0, 0.22), (0.06, 0.45, 0.45), M["metal"]),
    ])
    group("Tree", [
        cylinder("tr_trunk", (0, 0, 1.6), 0.13, 3.2, M["bark"], 8),
        ellipsoid("tr_a", (0, 0, 3.8), (1.6, 1.6, 1.5), M["leaf"], 10, 7),
        ellipsoid("tr_b", (0.7, 0.4, 3.3), (1.1, 1.1, 1.0), M["leaf"], 8, 6),
        ellipsoid("tr_c", (-0.6, -0.5, 4.4), (1.0, 1.0, 0.9), M["leaf"], 8, 6),
        cylinder("tr_pit", (0, 0, 0.03), 0.7, 0.06, M["concrete"], 4, smooth=False),
    ])
    group("Mailbox", [
        box("mb", (0, 0, 0.75), (0.5, 0.5, 0.9), M["blue"], bevel=0.05),
        cylinder("mb_top", (0, 0, 1.2), 0.25, 0.5, M["blue"], 12, rot=(0, math.pi / 2, 0)),
        box("mb_l", (0, 0, 0.15), (0.45, 0.45, 0.3), M["metal"]),
    ])
    group("NewsBox", [box("nb", (0, 0, 0.55), (0.45, 0.42, 1.1), M["news"], bevel=0.03)])
    wt = [cylinder("wt_tank", (0, 0, 3.6), 1.6, 3.2, M["tank"], 16),
          cone("wt_roof", (0, 0, 5.75), 1.75, 1.1, M["tank"])]
    for i in range(6):
        a = i / 6 * math.tau
        wt.append(limb(f"wt_leg{i}", (1.3 * math.cos(a), 1.3 * math.sin(a), 0), (1.2 * math.cos(a), 1.2 * math.sin(a), 2.1), 0.07, 0.07, M["metal"], 6, 4))
    for z in (2.6, 3.6, 4.6):
        wt.append(cylinder(f"wt_band{z}", (0, 0, z), 1.62, 0.06, M["metal"], 16))
    wt.append(cylinder("wt_deck", (0, 0, 2.05), 1.7, 0.1, M["metal"], 16))
    group("WaterTower", wt)
    group("ACUnit", [
        box("ac", (0, 0, 0.6), (1.6, 1.1, 1.2), M["ac"], bevel=0.04),
        cylinder("ac_fan", (0, 0, 1.22), 0.4, 0.05, M["metal"], 14),
    ])
    group("Antenna", [
        cylinder("an", (0, 0, 4), 0.06, 8, M["metal"], 6),
        cylinder("an_b", (0, 0, 0.3), 0.4, 0.6, M["metal"], 8),
        ellipsoid("an_light", (0, 0, 8.1), (0.12, 0.12, 0.12), M["tail"], 8, 6),
    ])
    # one floor of NYC fire escape (3.5 m tall), instanced per floor on facades
    fe = [box("fe_plat", (0, -0.6, 0.0), (3.0, 1.2, 0.05), M["metal"]),
          box("fe_rail", (0, -1.18, 0.5), (3.0, 0.04, 0.04), M["metal"]),
          box("fe_rail2", (0, -1.18, 0.25), (3.0, 0.03, 0.03), M["metal"])]
    for x in (-1.48, -0.5, 0.5, 1.48):
        fe.append(box(f"fe_post{x}", (x, -1.18, 0.25), (0.04, 0.04, 0.5), M["metal"]))
    fe.append(limb("fe_ladder", (-1.1, -0.9, 0.0), (0.9, -0.9, 3.5), 0.03, 0.03, M["metal"], 6, 4))
    fe.append(limb("fe_ladder2", (-1.1, -0.7, 0.0), (0.9, -0.7, 3.5), 0.03, 0.03, M["metal"], 6, 4))
    group("FireEscape", fe)
    group("Billboard", [
        box("bb_frame", (0, 0, 0), (8.2, 0.3, 4.2), M["metal"]),
        limb("bb_leg1", (-2.5, 0.3, -4), (-2.5, 0.3, -2), 0.1, 0.1, M["metal"], 6, 4),
        limb("bb_leg2", (2.5, 0.3, -4), (2.5, 0.3, -2), 0.1, 0.1, M["metal"], 6, 4),
    ])
    bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -0.16, 0), rotation=(math.pi / 2, 0, 0))
    face = bpy.context.active_object
    face.name = "BillboardFace"
    face.scale = (7.8, 3.8, 1)
    face.data.materials.append(material("BillboardAd", (1, 1, 1), rough=0.6, emit=(0.4, 0.4, 0.4), emit_strength=0.5))
    steel = material("DecoSteel", (0.75, 0.76, 0.8), rough=0.2, metal=1.0)
    group("Spire", [
        cone("sp_a", (0, 0, 4.5), 2.2, 9, steel, 8),
        cylinder("sp_needle", (0, 0, 11), 0.12, 5, steel, 6),
    ])
    export_glb(os.path.join(OUT, "props.glb"), {"export_animations": False})


if __name__ == "__main__":
    build_vehicles()
    build_props()
    print("props done")
