"""Shared helpers for procedurally building NYCSpider assets in Blender (bpy).

Every asset is generated from code so the whole art pipeline is reproducible:
    npm run assets   ->  blender/build_all.sh  ->  public/models/*.glb
"""
import math
import bpy
import bmesh
from mathutils import Vector, Quaternion, Euler, Matrix

FPS = 30


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS


# ---------------------------------------------------------------- materials
def material(name, color, rough=0.6, metal=0.0, emit=None, emit_strength=1.0,
             image=None, coat=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if coat:
        bsdf.inputs["Coat Weight"].default_value = coat
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    if image is not None:
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = image
        m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def grid_texture(name, base, line, size=256, cells=(8, 8), width=2, diag=False):
    """Web-like line texture. On UV-spheres the u/v lines become the classic
    radial + concentric web pattern."""
    img = bpy.data.images.new(name, size, size, alpha=False)
    px = [0.0] * (size * size * 4)
    cu, cv = size // cells[0], size // cells[1]
    for y in range(size):
        for x in range(size):
            on = (x % cu) < width or (y % cv) < width
            if diag and not on:
                on = abs(((x + y) % cu)) < 1
            c = line if on else base
            i = (y * size + x) * 4
            px[i:i + 4] = (c[0], c[1], c[2], 1.0)
    img.pixels = px
    img.pack()
    return img


# ---------------------------------------------------------------- meshes
def _finish(obj, mat, smooth=True):
    if mat:
        obj.data.materials.append(mat)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    return obj


def ellipsoid(name, center, radii, mat, seg=16, rings=10, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1.0,
                                         location=center, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = radii
    apply_tf(o)
    return _finish(o, mat)


def limb(name, a, b, r0, r1, mat, seg=14, rings=10):
    """Tapered capsule between points a and b (poles at the ends, so a
    UV grid texture wraps as rings around the limb)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    length = d.length
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1.0)
    o = bpy.context.active_object
    o.name = name
    me = o.data
    for v in me.vertices:
        z = v.co.z                      # -1..1 along the limb
        t = (z + 1) / 2
        r = r0 + (r1 - r0) * t
        v.co.x *= r
        v.co.y *= r
        v.co.z = z * (length / 2 + (r0 + r1) / 4)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = q
    o.location = (a + b) / 2
    apply_tf(o)
    return _finish(o, mat)


def box(name, center, size, mat, bevel=0.0, smooth=False):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    apply_tf(o)
    if bevel > 0:
        mod = o.modifiers.new("bev", 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier="bev")
    return _finish(o, mat, smooth)


def cylinder(name, center, radius, depth, mat, verts=16, rot=(0, 0, 0), smooth=True):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth,
                                        location=center, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    apply_tf(o)
    return _finish(o, mat, smooth)


def apply_tf(o):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    return o


# ---------------------------------------------------------------- rigging
def bind_rigid(part, bone):
    """Weight every vertex of `part` 100% to `bone` (tag stored until join)."""
    vg = part.vertex_groups.new(name=bone)
    vg.add(list(range(len(part.data.vertices))), 1.0, 'REPLACE')
    return part


def skin(mesh_obj, arm_obj):
    mesh_obj.parent = arm_obj
    mod = mesh_obj.modifiers.new("Armature", 'ARMATURE')
    mod.object = arm_obj


def build_armature(name, bones):
    """bones: list of (name, head, tail, parent or None)."""
    arm = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for bname, head, tail, parent in bones:
        b = arm.edit_bones.new(bname)
        b.head, b.tail = head, tail
        b.roll = 0
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
        eb[bname] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in obj.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return obj


# ---------------------------------------------------------------- animation
class Animator:
    """Author clips with rotations expressed in *armature* axes
    (X = character's left, -Y = forward, Z = up), degrees.

    Blender convention reminder for this rig (character faces -Y):
      rot X  negative -> pitch a bone's tail forward (e.g. leg swings forward)
      rot Z  on a vertical bone -> twist/yaw
    """

    def __init__(self, arm_obj):
        self.arm = arm_obj
        self.rest = {pb.name: pb.bone.matrix_local.to_quaternion() for pb in arm_obj.pose.bones}

    def _local_q(self, bone, xyz):
        x, y, z = (math.radians(v) for v in xyz)
        # 'ZYX' => twist/swing (Z) first, then abduct (Y), then pitch (X) last
        q = Euler((x, y, z), 'ZYX').to_quaternion()
        r = self.rest[bone]
        return r.inverted() @ q @ r

    def clip(self, name, keys, loop=False, root_bone="hips"):
        """keys: list of (frame, {bone: (rx,ry,rz) | ('loc', (x,y,z))})."""
        arm = self.arm
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        arm.animation_data_create()
        arm.animation_data.action = act
        bones_used = set()
        for _, pose in keys:
            bones_used.update(k for k in pose.keys() if not k.endswith("@loc"))
        all_bones = [pb.name for pb in arm.pose.bones]
        prev = {}
        for frame, pose in keys:
            for bname in all_bones:
                pb = arm.pose.bones[bname]
                rot = pose.get(bname, (0, 0, 0))
                q = self._local_q(bname, rot)
                if bname in prev and prev[bname].dot(q) < 0:
                    q.negate()      # keep quaternion hemisphere continuous
                prev[bname] = q
                pb.rotation_quaternion = q
                pb.keyframe_insert("rotation_quaternion", frame=frame)
            # root / hips translation (armature space delta -> bone local)
            for bname in ("root", root_bone):
                if bname not in arm.pose.bones:
                    continue
                pb = arm.pose.bones[bname]
                d = Vector(pose.get(bname + "@loc", (0, 0, 0)))
                r = self.rest[bname]
                pb.location = r.inverted() @ d
                pb.keyframe_insert("location", frame=frame)
        # smooth interpolation (bezier with auto-clamped handles)
        for fc in _fcurves(act):
            for kp in fc.keyframe_points:
                kp.interpolation = 'BEZIER'
                kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
            if loop:
                fc.modifiers.new('CYCLES')
        tr = arm.animation_data.nla_tracks.new()
        tr.name = name
        tr.strips.new(name, int(keys[0][0]), act)
        arm.animation_data.action = None
        return act


def _fcurves(act):
    # Blender 4.4+ layered actions keep fcurves inside channelbags
    if hasattr(act, "fcurves") and len(act.fcurves):
        return list(act.fcurves)
    out = []
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out


def mirror_pose(pose):
    """Swap .L/.R and mirror rotations across the X=0 plane."""
    out = {}
    for k, v in pose.items():
        if k.endswith(".L"):
            nk = k[:-2] + ".R"
        elif k.endswith(".R"):
            nk = k[:-2] + ".L"
        else:
            nk = k
        if k.endswith("@loc"):
            out[nk] = (-v[0], v[1], v[2])
        else:
            out[nk] = (v[0], -v[1], -v[2])
    return out


def export_glb(path, extra=None):
    opts = dict(export_animations=True)
    opts.update(extra or {})
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_animation_mode='NLA_TRACKS',
        export_force_sampling=True,
        export_frame_step=1,
        export_skins=True,
        export_morph=False,
        export_apply=True,
        export_yup=True,
        export_image_format='AUTO',
        export_materials='EXPORT',
        export_optimize_animation_size=True,
        **opts,
    )


def cone(name, center, r1, depth, mat, verts=16, r2=0.0):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=center)
    o = bpy.context.active_object
    o.name = name
    return _finish(o, mat, smooth=False)
