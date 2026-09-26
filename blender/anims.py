"""Pose + clip library shared by every humanoid (hero, thugs, civilians).

Conventions (armature axes, degrees, character faces -Y, see common.Animator):
  legs/arms  X < 0  -> swing forward        shin X > 0 -> knee bend
  spine/head X > 0  -> bend forward         foot X > 0 -> toes down
  arms (after side-normalisation with arm()):
      y > 0 -> lower from T-pose, z < 0 -> forward (T-plane), x pitch last
  forearm z < 0 -> elbow bend forward
Locomotion clips are generated from *foot trajectories* + analytic leg IK so
that the planted foot moves at a constant speed -> the game can match
playback rate to ground speed exactly (no foot sliding).
"""
import math

THIGH = 0.43
SHIN = 0.43
HIP_Z = 0.95
ANKLE_Z = 0.09
FOOT_LEN = 0.16
FPS = 30

SIDES = {"L": 1, "R": -1}


def arm(p, side, up=None, x=0, y=0, z=0, fx=0, fy=0, fz=0, hand=(0, 0, 0)):
    s = SIDES[side]
    p[f"upper_arm.{side}"] = (x, y * s, z * s)
    p[f"forearm.{side}"] = (fx, fy * s, fz * s)
    p[f"hand.{side}"] = (hand[0], hand[1] * s, hand[2] * s)


def leg_raw(p, side, x=0, y=0, z=0, sx=0, fx=0):
    s = SIDES[side]
    p[f"thigh.{side}"] = (x, y * s, z * s)
    p[f"shin.{side}"] = (sx, 0, 0)
    p[f"foot.{side}"] = (fx, 0, 0)


def leg_ik(p, side, fwd, height=0.0, hip_drop=0.0, hip_fwd=0.0, hip_pitch=0.0,
           splay=0.0, toe=0.0):
    """Place ankle at (fwd, height) in model space. Returns ankle lift needed
    when the leg is over-extended (used for toe-off)."""
    s = SIDES[side]
    d = (HIP_Z - hip_drop) - (ANKLE_Z + height)
    f = fwd - hip_fwd
    D = math.hypot(f, d)
    lift = 0.0
    maxD = THIGH + SHIN - 0.004
    if D > maxD:
        # heel rises, toes stay planted (toe-off) instead of the foot floating
        need = D - maxD
        lift = need
        d -= need
        D = math.hypot(f, d)
        if D > maxD:
            D = maxD
    a = math.atan2(f, d)
    cos_alpha = (THIGH ** 2 + D ** 2 - SHIN ** 2) / (2 * THIGH * D)
    alpha = math.acos(max(-1, min(1, cos_alpha)))
    cos_k = (THIGH ** 2 + SHIN ** 2 - D ** 2) / (2 * THIGH * SHIN)
    knee = math.pi - math.acos(max(-1, min(1, cos_k)))
    tx = -math.degrees(a + alpha) - hip_pitch
    sx = math.degrees(knee)
    toe_extra = toe + (math.degrees(math.asin(min(1, lift / FOOT_LEN))) if lift else 0)
    fx = -(tx + hip_pitch + sx) + toe_extra
    p[f"thigh.{side}"] = (tx, splay * s, 0)
    p[f"shin.{side}"] = (sx, 0, 0)
    p[f"foot.{side}"] = (fx, 0, 0)
    return lift


def mirror(p):
    out = {}
    for k, v in p.items():
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


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ base poses
STANCE = 0.07  # idle foot stagger shared by every clip that settles into idle


def stand(drop=0.02, arms_down=78, lean=0):
    p = {"hips@loc": (0, 0, -drop), "spine": (lean, 0, 0)}
    leg_ik(p, "L", STANCE, hip_drop=drop, splay=-3)
    leg_ik(p, "R", -STANCE, hip_drop=drop, splay=-3)
    arm(p, "L", y=arms_down, fz=-12)
    arm(p, "R", y=arms_down, fz=-12)
    return p


def guard(drop=0.12, twist=0):
    p = {"hips@loc": (0, 0, -drop), "spine": (8, 0, twist), "chest": (4, 0, 0),
         "head": (-6, 0, -twist)}
    leg_ik(p, "L", STANCE + 0.05, hip_drop=drop, splay=-10)
    leg_ik(p, "R", -STANCE - 0.07, hip_drop=drop, splay=-10)
    arm(p, "L", y=68, x=-25, fz=-125)
    arm(p, "R", y=72, x=-15, fz=-135)
    return p


# ------------------------------------------------------------------ locomotion
def gait(frames, stride, stance, step_h, drop, bob, lean, arm_swing, arm_down=72,
         elbow=-40, sample=2, fwd_bias=0.0, head_comp=True):
    """Procedural biped cycle. Planted foot slides back linearly by `stride`
    during `stance` fraction of the cycle -> ground speed is exact."""
    keys = []
    for f in range(0, frames + 1, sample):
        ph = (f / frames) % 1.0
        p = {}
        feet = {}
        for side, off in (("L", 0.0), ("R", 0.5)):
            q = (ph + off) % 1.0
            if q < stance:
                u = q / stance
                y = lerp(stride / 2, -stride / 2, u) + fwd_bias
                h = 0.0
            else:
                u = (q - stance) / (1 - stance)
                e = smooth(u)
                y = lerp(-stride / 2, stride / 2, e) + fwd_bias
                h = step_h * math.sin(math.pi * u)
            feet[side] = (y, h, q)
        # hips bob: lowest mid-stance (twice per cycle)
        z = -drop - bob * (0.5 + 0.5 * math.cos(4 * math.pi * ph))
        p["hips@loc"] = (0, 0, z)
        # pelvis rotates with the stride
        p["hips"] = (0, 0, 6 * (feet["L"][0] / max(0.01, stride)) * 2)
        p["spine"] = (lean, 0, -p["hips"][2] * 1.6)
        p["chest"] = (2, 0, -p["hips"][2] * 0.6)
        if head_comp:
            p["head"] = (-lean * 0.6, 0, 0)
        for side in ("L", "R"):
            y, h, q = feet[side]
            toe = -12 * math.sin(math.pi * min(1, max(0, (q - 1 + 0.12) / 0.12))) if q > 0.88 else 0
            leg_ik(p, side, y, height=h, hip_drop=-z, splay=-3, toe=toe)
        # arms swing opposite to legs
        for side, other in (("L", "R"), ("R", "L")):
            k = feet[other][0] / max(0.01, stride / 2)
            arm(p, side, y=arm_down, x=-arm_swing * k, fz=elbow - 15 * max(0, k))
        keys.append((f, p))
    speed = stride / (stance * frames / FPS)
    return keys, speed


def idle():
    keys = []
    for f in (0, 30, 60):
        br = 1 if f == 30 else 0
        p = stand(drop=0.03 + 0.012 * br, arms_down=76 - 2 * br)
        p["chest"] = (-2 * br, 0, 0)
        p["head"] = (2 * br, 0, 0)
        keys.append((f, p))
    return keys


def walk():
    return gait(28, 0.72, 0.60, 0.07, 0.03, 0.02, 4, 22, elbow=-20)


def run():
    return gait(18, 0.92, 0.36, 0.20, 0.08, 0.035, 14, 50, arm_down=70, elbow=-85,
                fwd_bias=-0.08)


def sprint():
    return gait(16, 1.02, 0.28, 0.28, 0.10, 0.04, 22, 65, arm_down=60, elbow=-95,
                fwd_bias=-0.12)


def jump_start():
    crouch = guard(0.28)
    crouch["spine"] = (28, 0, 0)
    leg_ik(crouch, "L", 0.05, hip_drop=0.28)
    leg_ik(crouch, "R", 0.05, hip_drop=0.28)
    arm(crouch, "L", y=70, x=45, fz=-20)
    arm(crouch, "R", y=70, x=45, fz=-20)
    ext = {"hips@loc": (0, 0, 0.05), "spine": (-6, 0, 0)}
    leg_raw(ext, "L", x=0, sx=4, fx=35)
    leg_raw(ext, "R", x=6, sx=10, fx=35)
    arm(ext, "L", y=-20, x=-10, fz=-10)
    arm(ext, "R", y=-35, x=-20, fz=-10)
    air = fall_pose(0)
    return [(0, stand()), (4, crouch), (9, ext), (14, air)]


def fall_pose(t):
    p = {"spine": (8, 0, 0), "head": (-10, 0, 0)}
    leg_raw(p, "L", x=-35 - 8 * t, y=-8, sx=60 + 10 * t, fx=15)
    leg_raw(p, "R", x=-10 + 8 * t, y=-8, sx=40 - 10 * t, fx=15)
    arm(p, "L", y=25 - 10 * t, z=10, fz=-20)
    arm(p, "R", y=30 + 10 * t, z=5, fz=-25)
    return p


def fall():
    return [(0, fall_pose(0)), (12, fall_pose(1)), (24, fall_pose(0))]


def crouch_land(drop, spread=STANCE, lean=25):
    p = {"hips@loc": (0, 0, -drop), "spine": (lean, 0, 0), "head": (-lean * 0.8, 0, 0)}
    leg_ik(p, "L", spread, hip_drop=drop, splay=-12)
    leg_ik(p, "R", -spread, hip_drop=drop, splay=-12)
    arm(p, "L", y=40, z=15, fz=-30)
    arm(p, "R", y=40, z=15, fz=-30)
    return p


def land():
    return [(0, crouch_land(0.32)), (5, crouch_land(0.26, lean=20)), (14, stand())]


def land_hard():
    """Three-point 'superhero' landing (hand + one knee near the ground)."""
    p = {"hips@loc": (0, 0.0, -0.5), "spine": (45, 0, -8), "chest": (10, 0, 0),
         "head": (-45, 0, 0)}
    leg_ik(p, "L", STANCE + 0.12, hip_drop=0.5, splay=-12)
    leg_ik(p, "R", -STANCE - 0.12, height=0.05, hip_drop=0.5, splay=-4, toe=40)
    arm(p, "R", y=80, x=-35, fz=-5)       # hand planted in front
    arm(p, "L", y=20, z=35, fz=-25)       # other arm flung back
    q = dict(p)
    q["head"] = (-30, 0, 0)
    mid = crouch_land(0.25, lean=15)
    leg_ik(mid, "L", STANCE + 0.06, hip_drop=0.25, splay=-10)
    leg_ik(mid, "R", -STANCE - 0.06, hip_drop=0.25, splay=-10)
    return [(0, p), (16, q), (26, mid), (36, stand())]


def roll():
    """Forward roll for fast landings (game moves the body at ROLL_SPEED)."""
    keys = []
    n = 8
    for i in range(n + 1):
        t = i / n
        p = {"hips@loc": (0, 0, -0.45 + 0.1 * math.sin(math.pi * t)),
             "hips": (360 * smooth(t), 0, 0), "spine": (40, 0, 0), "head": (30, 0, 0)}
        leg_raw(p, "L", x=-110, sx=140, fx=20)
        leg_raw(p, "R", x=-100, sx=135, fx=20)
        arm(p, "L", y=60, x=-60, fz=-60)
        arm(p, "R", y=60, x=-60, fz=-60)
        keys.append((i * 3, p))
    keys.append((30, stand(0.05)))
    return keys


# ------------------------------------------------------------------ swinging
def swing_pose(t, web_side="R"):
    """t: 0 = behind anchor (start of dive), 0.5 = bottom, 1 = in front (rising)."""
    free = "L" if web_side == "R" else "R"
    p = {}
    legx = lerp(-70, -20, smooth(min(1, t * 2))) if t < 0.5 else lerp(-20, -85, smooth((t - .5) * 2))
    shin = lerp(110, 15, smooth(min(1, t * 2))) if t < 0.5 else lerp(15, 30, smooth((t - .5) * 2))
    p["spine"] = (lerp(20, -15, t), 0, 0)
    p["head"] = (lerp(-10, 10, t), 0, 0)
    leg_raw(p, "L", x=legx, y=-6, sx=shin, fx=20)
    leg_raw(p, "R", x=legx + 12, y=-6, sx=shin + 20, fx=20)
    arm(p, web_side, y=-80, z=-10, fz=-10 - 25 * (1 - t))      # holding the web
    arm(p, free, y=lerp(10, 40, t), z=lerp(40, -20, t), fz=-30)
    return p


def swing():
    return [(f, swing_pose(f / 30)) for f in range(0, 31, 3)]


def swing_flip():
    keys = []
    for i in range(9):
        t = i / 8
        p = {"hips": (-360 * smooth(t), 0, 0), "spine": (30, 0, 0), "head": (20, 0, 0)}
        leg_raw(p, "L", x=-100, sx=130, fx=20)
        leg_raw(p, "R", x=-95, sx=125, fx=20)
        arm(p, "L", y=40, x=-50, fz=-70)
        arm(p, "R", y=40, x=-50, fz=-70)
        keys.append((i * 3, p))
    keys.append((32, fall_pose(0)))
    return keys


def web_zip():
    p = {"spine": (-10, 0, 0)}
    arm(p, "L", y=-5, z=-80, fz=-5)
    arm(p, "R", y=-10, z=-80, fz=-5)
    leg_raw(p, "L", x=15, sx=50, fx=20)
    leg_raw(p, "R", x=5, sx=70, fx=20)
    return [(0, p), (10, p)]


# ------------------------------------------------------------------ wall crawl
def crawl_pose(ph):
    """Belly faces the wall (model forward). Diagonal gait: L arm + R leg."""
    p = {"hips@loc": (0, -0.05, -0.18), "spine": (12, 0, 0), "chest": (6, 0, 0),
         "head": (-35, 0, 0)}
    for side, off in (("L", 0.0), ("R", 0.5)):
        q = (ph + off) % 1.0
        # reach = 1 at top of reach, -1 at bottom of push
        if q < 0.55:
            r = lerp(1, -1, q / 0.55)          # planted, pushes down
            away = 0
        else:
            u = (q - 0.55) / 0.45
            r = lerp(-1, 1, smooth(u))         # swings back up, off the wall
            away = math.sin(math.pi * u)
        arm(p, side, y=-25 - 35 * r, z=-40 + 10 * away, fz=-55 - 25 * away)
        other = "R" if side == "L" else "L"
        # opposite leg planted in sync (diagonal)
        leg_raw(p, other, x=-55 - 25 * r - 10 * away, y=-45, sx=95 + 20 * r + 15 * away,
                fx=-20)
    return p


def wall_crawl():
    return [(f, crawl_pose(f / 24)) for f in range(0, 25, 2)]


def wall_idle():
    a = crawl_pose(0.0)
    b = crawl_pose(0.0)
    b["hips@loc"] = (0, -0.07, -0.17)
    b["head"] = (-40, 0, 12)
    return [(0, a), (30, b), (60, a)]


# ------------------------------------------------------------------ combat
def punch_pose(side, ext):
    p = guard(0.12, twist=25 * ext * (1 if side == "R" else -1))
    arm(p, side, y=lerp(72, 2, ext), x=0, z=lerp(0, -88, ext), fz=lerp(-135, -4, ext))
    return p


def punch1():
    g = guard()
    return [(0, g), (3, punch_pose("R", 0.6)), (5, punch_pose("R", 1)), (9, punch_pose("R", 0.9)),
            (16, g)]


def punch2():
    g = guard()
    return [(0, g), (4, punch_pose("L", 0.5)), (6, punch_pose("L", 1)), (10, punch_pose("L", 0.9)),
            (18, g)]


def kick3():
    g = guard()
    wind = guard(0.1, twist=-25)
    kick = {"hips@loc": (0, 0, -0.05), "spine": (-20, -25, -20), "head": (10, 10, 10)}
    leg_ik(kick, "L", STANCE + 0.05, hip_drop=0.05, splay=-10)
    leg_raw(kick, "R", x=-95, y=-35, sx=5, fx=30)
    arm(kick, "L", y=50, x=-40, fz=-120)
    arm(kick, "R", y=40, z=40, fz=-40)
    return [(0, g), (5, wind), (10, kick), (14, kick), (24, g)]


def uppercut():
    g = guard()
    low = guard(0.3, twist=-20)
    arm(low, "R", y=85, x=20, fz=-100)
    up = {"hips@loc": (0, 0, 0.02), "spine": (-18, 0, 25), "head": (-15, 0, 0)}
    leg_ik(up, "L", STANCE + 0.05, hip_drop=-0.02, splay=-10)
    leg_raw(up, "R", x=-40, sx=70, fx=30)
    arm(up, "R", y=-70, z=-60, fz=-40)
    arm(up, "L", y=60, x=-20, fz=-120)
    return [(0, g), (5, low), (9, up), (14, up), (22, g)]


def air_base():
    p = {"spine": (5, 0, 0)}
    leg_raw(p, "L", x=-45, y=-6, sx=80, fx=15)
    leg_raw(p, "R", x=-25, y=-6, sx=60, fx=15)
    arm(p, "L", y=60, x=-25, fz=-120)
    arm(p, "R", y=65, x=-15, fz=-130)
    return p


def air_punch():
    b = air_base()
    h = air_base()
    h["spine"] = (10, 0, 25)
    arm(h, "R", y=5, z=-88, fz=-4)
    return [(0, b), (4, h), (8, h), (14, b)]


def air_kick():
    b = air_base()
    h = air_base()
    h["spine"] = (-15, 0, -10)
    leg_raw(h, "L", x=-95, y=-10, sx=5, fx=30)
    return [(0, b), (5, h), (9, h), (16, b)]


def air_spin():
    keys = []
    for i in range(7):
        t = i / 6
        p = air_base()
        p["hips"] = (0, 0, 360 * smooth(t))
        leg_raw(p, "R", x=-80, y=-40, sx=10, fx=30)
        arm(p, "L", y=10, z=10, fz=-10)
        arm(p, "R", y=10, z=10, fz=-10)
        keys.append((i * 3, p))
    keys.append((22, air_base()))
    return keys


def air_slam():
    b = air_base()
    up = air_base()
    up["spine"] = (-25, 0, 0)
    arm(up, "L", y=-80, z=-20, fz=-40)
    arm(up, "R", y=-80, z=-20, fz=-40)
    down = air_base()
    down["spine"] = (45, 0, 0)
    arm(down, "L", y=10, z=-80, x=40, fz=-10)
    arm(down, "R", y=10, z=-80, x=40, fz=-10)
    return [(0, b), (6, up), (12, down), (16, down), (24, b)]


def web_pull():
    g = guard(0.1)
    shoot = guard(0.08, twist=20)
    arm(shoot, "R", y=0, z=-85, fz=-3, hand=(0, 0, -30))
    pull = guard(0.2, twist=-30)
    pull["spine"] = (-15, 0, -30)
    arm(pull, "R", y=40, z=40, x=0, fz=-110)
    leg_ik(pull, "L", -0.3, hip_drop=0.2, splay=-10)
    leg_ik(pull, "R", 0.25, hip_drop=0.2, splay=-10)
    return [(0, g), (4, shoot), (8, shoot), (13, pull), (17, pull), (26, g)]


def hit():
    g = guard()
    h = guard(0.15)
    h["spine"] = (-20, 0, 10)
    h["head"] = (-25, 0, 10)
    return [(0, g), (3, h), (12, g)]


def dodge():
    g = guard()
    d = guard(0.35)
    d["spine"] = (25, -25, 0)
    return [(0, g), (6, d), (10, d), (18, g)]


def suit_change():
    s = stand()
    hunch = {"hips@loc": (0, 0, -0.3), "spine": (40, 0, 0), "chest": (15, 0, 0), "head": (25, 0, 0)}
    leg_ik(hunch, "L", 0.05, hip_drop=0.3, splay=-15)
    leg_ik(hunch, "R", -0.05, hip_drop=0.3, splay=-15)
    arm(hunch, "L", y=60, z=-70, fz=-110)       # clutching the chest
    arm(hunch, "R", y=60, z=-70, fz=-110)
    burst = {"hips@loc": (0, 0, -0.08), "spine": (-22, 0, 0), "chest": (-10, 0, 0),
             "head": (-35, 0, 0)}
    leg_ik(burst, "L", 0.0, hip_drop=0.08, splay=-18)
    leg_ik(burst, "R", 0.0, hip_drop=0.08, splay=-18)
    arm(burst, "L", y=-25, z=25, fz=-10)
    arm(burst, "R", y=-25, z=25, fz=-10)
    return [(0, s), (12, hunch), (30, hunch), (38, burst), (52, burst), (66, stand())]


# ------------------------------------------------------------------ NPC-only
def knockdown():
    h = guard(0.15)
    h["spine"] = (-30, 0, 0)
    fall1 = {"hips@loc": (0, 0.25, -0.5), "hips": (-40, 0, 0), "spine": (-20, 0, 0)}
    leg_raw(fall1, "L", x=-40, sx=40)
    leg_raw(fall1, "R", x=-60, sx=20)
    arm(fall1, "L", y=-10, z=30, fz=-20)
    arm(fall1, "R", y=-10, z=30, fz=-20)
    lie = down_pose()
    return [(0, h), (6, fall1), (14, lie), (20, lie)]


def down_pose():
    p = {"hips@loc": (0, 0.1, -0.83), "hips": (-88, 0, 0), "spine": (-4, 0, 0), "head": (5, 0, 20)}
    leg_raw(p, "L", x=-12, y=-8, sx=10, fx=-20)
    leg_raw(p, "R", x=-4, y=-12, sx=25, fx=-20)
    arm(p, "L", y=20, z=20, fz=-20)
    arm(p, "R", y=60, z=-10, fz=-40)
    return p


def down():
    a = down_pose()
    return [(0, a), (40, a)]


def getup():
    mid = {"hips@loc": (0, 0.1, -0.55), "hips": (-20, 0, 0), "spine": (50, 0, 0)}
    leg_raw(mid, "L", x=-90, sx=130, fx=-30)
    leg_raw(mid, "R", x=-50, sx=100, fx=-30)
    arm(mid, "L", y=80, x=10, fz=-10)
    arm(mid, "R", y=80, x=10, fz=-10)
    return [(0, down_pose()), (12, mid), (24, guard())]


def pulled():
    p = {"hips@loc": (0, 0, -0.1), "spine": (30, 0, 0), "head": (-30, 0, 0)}
    leg_raw(p, "L", x=-40, sx=30, fx=10)
    leg_raw(p, "R", x=20, sx=60, fx=30)
    arm(p, "L", y=0, z=-60, fz=-10)
    arm(p, "R", y=10, z=-50, fz=-15)
    q = dict(p)
    leg_raw(q, "L", x=10, sx=60, fx=30)
    leg_raw(q, "R", x=-35, sx=30, fx=10)
    return [(0, p), (8, q), (16, p)]


def juggle():
    p = {"spine": (-25, 0, 0), "head": (-30, 0, 0)}
    leg_raw(p, "L", x=-30, sx=60)
    leg_raw(p, "R", x=-10, sx=40)
    arm(p, "L", y=-20, z=20, fz=-20)
    arm(p, "R", y=-30, z=30, fz=-20)
    q = dict(p)
    arm(q, "L", y=-40, z=10, fz=-40)
    return [(0, p), (10, q), (20, p)]


def cower():
    p = {"hips@loc": (0, 0, -0.25), "spine": (30, 0, 0), "head": (20, 0, 0)}
    leg_ik(p, "L", 0.1, hip_drop=0.25, splay=-8)
    leg_ik(p, "R", -0.05, hip_drop=0.25, splay=-8)
    arm(p, "L", y=40, z=-60, fz=-140)
    arm(p, "R", y=40, z=-60, fz=-140)
    q = dict(p)
    q["head"] = (25, 0, 8)
    return [(0, p), (15, q), (30, p)]


def thug_idle():
    a = guard(0.1)
    b = guard(0.13)
    b["head"] = (0, 0, 8)
    return [(0, a), (20, b), (40, a)]


def thug_punch():
    g = guard()
    wind = guard(0.12, twist=-30)
    arm(wind, "R", y=60, x=30, fz=-120)
    return [(0, g), (8, wind), (13, punch_pose("R", 1)), (17, punch_pose("R", 0.9)), (28, g)]


def wave():
    p = stand()
    arm(p, "R", y=-60, z=10, fz=-50)
    q = dict(p)
    arm(q, "R", y=-60, z=10, fz=-10)
    return [(0, p), (8, q), (16, p), (24, q), (32, p)]


# clip name -> (factory, loop)
HERO_CLIPS = {
    "Idle": (idle, True), "Walk": (walk, True), "Run": (run, True), "Sprint": (sprint, True),
    "JumpStart": (jump_start, False), "Fall": (fall, True), "Land": (land, False),
    "LandHard": (land_hard, False), "Roll": (roll, False),
    "Swing": (swing, False), "SwingFlip": (swing_flip, False), "WebZip": (web_zip, True),
    "WallIdle": (wall_idle, True), "WallCrawl": (wall_crawl, True),
    "Punch1": (punch1, False), "Punch2": (punch2, False), "Kick3": (kick3, False),
    "Uppercut": (uppercut, False), "AirPunch": (air_punch, False), "AirKick": (air_kick, False),
    "AirSpin": (air_spin, False), "AirSlam": (air_slam, False), "WebPull": (web_pull, False),
    "Hit": (hit, False), "Dodge": (dodge, False), "SuitChange": (suit_change, False),
}

NPC_CLIPS = {
    "Idle": (thug_idle, True), "Stand": (idle, True), "Walk": (walk, True), "Run": (run, True),
    "Punch": (thug_punch, False), "Hit": (hit, False), "Knockdown": (knockdown, False),
    "Down": (down, True), "GetUp": (getup, False), "Pulled": (pulled, True),
    "Juggle": (juggle, True), "Cower": (cower, True), "Fall": (fall, True), "Wave": (wave, True),
}


def build_keys(fn):
    r = fn()
    if isinstance(r, tuple):
        return r
    return r, None
