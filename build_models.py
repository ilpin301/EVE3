"""Pure-stdlib generator for LEGO Mindstorms EV3 part models (mm, Z-up, CCW outward).
Run: python -I build_models.py   -> models/<id>.stl|obj|mtl and viewer/models.js, then self-check.
A mesh here is a plain list of triangles ((x,y,z),(x,y,z),(x,y,z)); a part is a list of (colour, mesh)."""
import math, struct, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "models"
VIEW = ROOT / "viewer"

LG, DG, WH, RED = "#a0a5a9", "#4a4a4a", "#f2f2f2", "#c4281c"
BLK, BEIGE, BLUE, STEEL, LCD, BTN = "#1a1a1a", "#d9c9a0", "#1f5fbf", "#c8c8c8", "#222b22", "#d8d8d8"

# (id, name, category, approx)
MANIFEST = [
    ("beam_3m", "Technic 3M Beam", "Beams", False),
    ("beam_5m", "Technic 5M Beam", "Beams", False),
    ("beam_7m", "Technic 7M Beam", "Beams", False),
    ("beam_9m", "Technic 9M Beam", "Beams", False),
    ("beam_11m", "Technic 11M Beam", "Beams", False),
    ("beam_13m", "Technic 13M Beam", "Beams", False),
    ("beam_15m", "Technic 15M Beam", "Beams", False),
    ("ang_3x5_90", "Technic Ang. Beam 3X5 90°", "Angular beams", False),
    ("ang_4x2_90", "Technic Ang. Beam 4X2 90°", "Angular beams", False),
    ("ang_4x4_53", "Technic Angular Beam 4X4", "Angular beams", False),
    ("ang_4x6_53", "Technic Angular Beam 4X6", "Angular beams", False),
    ("axle_3m", "Cross Axle 3M", "Axles", False),
    ("axle_4m", "Cross Axle 4M", "Axles", False),
    ("axle_5m", "Cross Axle 5M", "Axles", False),
    ("axle_6m", "Cross Axle 6M", "Axles", False),
    ("axle_7m", "Cross Axle 7M", "Axles", False),
    ("axle_8m", "Cross Axle 8M", "Axles", False),
    ("axle_10m", "Cross Axle 10M", "Axles", False),
    ("axle_12m", "Cross Axle 12M", "Axles", False),
    ("peg_friction_2m", "Connector Peg W. Friction 2M", "Pegs & bushes", False),
    ("peg_3m", "3M Connector Peg", "Pegs & bushes", False),
    ("peg_friction_3m", "Connector Peg W. Friction 3M", "Pegs & bushes", False),
    ("conn_peg_axle", "Conn.Bush W.Fric./Cross Axle", "Pegs & bushes", False),
    ("bush_cross_1m", "Bush For Cross Axle", "Pegs & bushes", False),
    ("gear_z8", "Gear Wheel T=8, M=1", "Gears", False),
    ("gear_z16", "Gear Wheel Z16", "Gears", False),
    ("gear_z24", "Gear Wheel Z24", "Gears", False),
    ("gear_z40", "Gear Wheel 40T", "Gears", False),
    ("wheel_56x28", "Tyre Low Wide Ø56 X 28 + Rim 43,2X26", "Wheels", False),
    ("steel_ball", "Steel Ball", "Misc", False),
    ("large_motor", "Large Motor", "Motors", True),
    ("medium_motor", "Medium Motor", "Motors", True),
    ("sensor_gyro", "EV3 Gyro Sensor", "Sensors", True),
    ("sensor_touch", "EV3 Touch Sensor", "Sensors", True),
    ("sensor_color", "EV3 Color Sensor", "Sensors", True),
    ("sensor_ultrasonic", "EV3 Ultrasonic Sensor", "Sensors", True),
    ("pbrick", "P-Brick", "Brick", True),
]
CATEGORIES = {"Beams", "Angular beams", "Axles", "Pegs & bushes", "Gears", "Wheels", "Motors", "Sensors", "Brick", "Misc"}
STRICT = {i for i, _, c, _ in MANIFEST if c in ("Beams", "Axles", "Gears")} | {"bush_cross_1m", "steel_ball"}  # must be watertight

# ---------------------------------------------------------------- mesh helpers
def T(m, dx=0.0, dy=0.0, dz=0.0):
    return [tuple((x + dx, y + dy, z + dz) for x, y, z in t) for t in m]

def R(m, axis, deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    def f(p):
        x, y, z = p
        if axis == "z": return (x * c - y * s, x * s + y * c, z)
        if axis == "y": return (x * c + z * s, y, -x * s + z * c)
        return (x, y * c - z * s, y * s + z * c)
    return [tuple(f(p) for p in t) for t in m]

def vol(m):
    return sum(a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])
               for a, b, c in m) / 6.0

def _add(out, a, b, c):
    u = (b[0] - a[0], b[1] - a[1], b[2] - a[2]); v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
    n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
    if n[0] * n[0] + n[1] * n[1] + n[2] * n[2] > 1e-18:  # drop degenerate triangles
        out.append((a, b, c))

def circle(r, n=32):
    return [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n)) for i in range(n)]

def cross_poly(L=4.8, w=1.8):
    h, a = L / 2, w / 2
    return [(h, -a), (h, a), (a, a), (a, h), (-a, h), (-a, a), (-h, a), (-h, -a), (-a, -a), (-a, -h), (a, -h), (a, -a)]

def _radial(poly, th):
    dx, dy = math.cos(th), math.sin(th)
    best = None
    for i in range(len(poly)):
        ax, ay = poly[i]; bx, by = poly[(i + 1) % len(poly)]
        ex, ey = bx - ax, by - ay
        den = dx * ey - dy * ex
        if abs(den) < 1e-12: continue
        t = (ax * ey - ay * ex) / den
        s = (ax * dy - ay * dx) / den
        if t > 1e-9 and -1e-9 <= s <= 1 + 1e-9 and (best is None or t < best): best = t
    return (best * dx, best * dy)

def ring(cx, cy, outer, inner, z0, z1, wall=None):
    """Extruded annulus between two star-shaped polygons (relative to a common centre).
    inner=None gives a solid. wall(p,q) may veto outer wall segments (beam interiors)."""
    angs = sorted({math.atan2(y, x) % (2 * math.pi) for poly in (outer, inner or []) for x, y in poly})
    ded = [angs[0]]
    for a in angs[1:]:
        if a - ded[-1] > 1e-9: ded.append(a)
    if ded[-1] - ded[0] > 2 * math.pi - 1e-9: ded.pop()
    O = [_radial(outer, a) for a in ded]
    I = [_radial(inner, a) if inner else (0.0, 0.0) for a in ded]
    out, N = [], len(ded)
    P = lambda p, z: (cx + p[0], cy + p[1], z)
    for j in range(N):
        k = (j + 1) % N
        _add(out, P(I[j], z1), P(O[j], z1), P(O[k], z1)); _add(out, P(I[j], z1), P(O[k], z1), P(I[k], z1))
        _add(out, P(I[j], z0), P(O[k], z0), P(O[j], z0)); _add(out, P(I[j], z0), P(I[k], z0), P(O[k], z0))
        if wall is None or wall((cx + O[j][0], cy + O[j][1]), (cx + O[k][0], cy + O[k][1])):
            _add(out, P(O[j], z0), P(O[k], z0), P(O[k], z1)); _add(out, P(O[j], z0), P(O[k], z1), P(O[j], z1))
        if inner:
            _add(out, P(I[j], z0), P(I[k], z1), P(I[k], z0)); _add(out, P(I[j], z0), P(I[j], z1), P(I[k], z1))
    return out

def box(cx, cy, cz, sx, sy, sz):
    x0, x1, y0, y1, z0, z1 = cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2
    out = []
    for q in (((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)), ((x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)),
              ((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)), ((x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)),
              ((x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)), ((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1))):
        _add(out, q[0], q[1], q[2]); _add(out, q[0], q[2], q[3])
    return out

def cyl(axis, c1, c2, r, t0, t1, rin=None, n=32):
    """Cylinder/tube along axis x|y|z over [t0,t1]; (c1,c2) = the other two coords in order (x,y)/(y,z)/(x,z)."""
    m = ring(0, 0, circle(r, n), circle(rin, n) if rin else None, t0, t1)
    if axis == "z": return T(m, c1, c2, 0)
    if axis == "x": return T(R(m, "y", 90), 0, c1, c2)
    return T(R(m, "x", -90), c1, 0, c2)

def lathe(profile, n=48):
    """Revolve closed (r,z) profile about Z; CCW profile = outward normals."""
    area = sum(profile[i][0] * profile[(i + 1) % len(profile)][1] - profile[(i + 1) % len(profile)][0] * profile[i][1] for i in range(len(profile)))
    if area < 0: profile = profile[::-1]
    out = []
    pt = lambda r, z, j: (r * math.cos(2 * math.pi * j / n), r * math.sin(2 * math.pi * j / n), z)
    for i in range(len(profile)):
        (r0, z0), (r1, z1) = profile[i], profile[(i + 1) % len(profile)]
        for j in range(n):
            A, B, C, D = pt(r0, z0, j), pt(r0, z0, j + 1), pt(r1, z1, j + 1), pt(r1, z1, j)
            _add(out, A, B, C); _add(out, A, C, D)
    return out

# ---------------------------------------------------------------- parts
def beam_cells(n, th=7.2):
    sq = [(4, -4), (4, 4), (-4, 4), (-4, -4)]
    out = []
    for k in range(n):
        cx = k * 8.0
        def wall(p, q, k=k, cx=cx):
            mx, my = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
            return abs(abs(my) - 4) < 1e-6 or (k == n - 1 and abs(mx - cx - 4) < 1e-6) or (k == 0 and abs(mx - cx + 4) < 1e-6)
        out += ring(cx, 0, sq, circle(2.4), 0, th, wall)
    return out

def beam(n, color=LG): return [(color, beam_cells(n))]

def angular(a, b, phi, color):
    # arm A ends at the joint (origin); arm B starts at the joint, rotated by phi. Joint cell is in both.
    return [(color, T(beam_cells(a), -(a - 1) * 8.0) + R(beam_cells(b), "z", phi))]

def axle(n, color=DG):
    return [(color, axle_mesh(0, n * 8.0))]

def axle_mesh(x0, x1):
    return T(R(ring(0, 0, cross_poly(), None, 0, x1 - x0), "y", 90), x0)

def peg(L, ridges, color, collar=1.6):
    m = cyl("x", 0, 0, 2.4, -L / 2, L / 2) + cyl("x", 0, 0, 3.1, -collar / 2, collar / 2)
    for x in ridges:
        for s in (-1, 1): m += cyl("x", 0, 0, 2.65, s * x - 0.75, s * x + 0.75)
    return [(color, m)]

def conn_peg_axle():
    m = cyl("x", 0, 0, 2.4, -12, 3) + cyl("x", 0, 0, 2.65, -9.75, -8.25) + cyl("x", 0, 0, 2.65, -5.75, -4.25)
    m += cyl("x", 0, 0, 3.1, 3, 4.6) + axle_mesh(4.6, 12)
    return [(BLUE, m)]

def bush():
    return [(LG, ring(0, 0, circle(3.7), cross_poly(), 0, 8))]

def gear(Z):
    p, tip, root = 2 * math.pi / Z, Z / 2 + 1.0, max(Z / 2 - 1.25, 3.0)
    poly = []
    for i in range(Z):
        c = i * p
        for r, d in ((root, -0.30), (tip, -0.15), (tip, 0.15), (root, 0.30)):
            poly.append((r * math.cos(c + d * p), r * math.sin(c + d * p)))
    return [(DG, ring(0, 0, poly, cross_poly(), 0, 4))]

def wheel():
    tread = [(20, 0), (25, 0), (27, 2), (28, 5), (28, 10.4), (27.2, 10.8), (27.2, 11.2), (28, 11.6), (28, 16.4), (27.2, 16.8),
             (27.2, 17.2), (28, 17.6), (28, 23), (27, 26), (25, 28), (20, 28)]
    rim = T(lathe([(18.5, 0), (21.6, 0), (21.6, 2), (20.5, 2), (20.5, 24), (21.6, 24), (21.6, 26), (18.5, 26)]), 0, 0, 1)
    rim += ring(0, 0, circle(6), cross_poly(), 8, 20)
    for k in range(6):  # six round holes in the dish: one perforated sector each
        pol = lambda r, a: (r * math.cos(math.radians(a)), r * math.sin(math.radians(a)))
        pts = [pol(19.5, a) for a in range(-30, 31, 10)] + [pol(5.5, a) for a in range(30, -31, -10)]
        c, s = math.cos(math.radians(60 * k)), math.sin(math.radians(60 * k))
        rot = lambda p: (p[0] * c - p[1] * s, p[0] * s + p[1] * c)
        hc = rot((12.5, 0))
        rim += ring(hc[0], hc[1], [(rot(p)[0] - hc[0], rot(p)[1] - hc[1]) for p in pts], circle(3.0), 12, 16)
    return [(LG, rim), (BLK, lathe(tread))]

def steel_ball():
    R_ = 8.0
    return [(STEEL, lathe([(R_ * math.sin(math.pi * i / 24), -R_ * math.cos(math.pi * i / 24)) for i in range(25)], 48))]

def holes_x(xs, ys, zs, r=2.8):  # dark discs on +-x faces
    m = []
    for x in xs:
        s = 1 if x > 0 else -1
        for y in ys:
            for z in zs: m += cyl("x", y, z, r, x - s * 0.2, x + s * 0.4)
    return m

def holes_y(ys, xs, zs, r=2.8):  # dark discs on +-y faces
    m = []
    for y in ys:
        s = 1 if y > 0 else -1
        for x in xs:
            for z in zs: m += cyl("y", x, z, r, y - s * 0.2, y + s * 0.4) if s > 0 else cyl("y", x, z, r, y - 0.4, y + 0.2)
    return m

def motor(length_body, width, big):
    w, g, k, red = [], [], [], []
    h = width / 2
    w += box(-36 + length_body / 2, 0, 20, length_body, width, 40)
    gx0 = -36 + length_body
    g += box((gx0 + 28) / 2, 0, 18 if big else 20, 28 - gx0, width - 8, 36 if big else 36)
    g += cyl("x", 0, 20, 14 if big else 11, 28, 32)
    red += cyl("x", 0, 20, 12 if big else 9, 32, 36)
    k += cyl("x", 0, 20, 4, 35.8, 36.4)
    k += box(-36, 0, 15, 0.8, 20, 10)  # cable socket
    k += holes_y([h, -h], [-28, -16, -4] if big else [-28, -12], [10, 30])
    if big: k += box(-18, 0, 40, 24, 24, 0.8)
    return [(WH, w), (LG, g), (BLK, k), (RED, red)]

def sensor(kind):
    g, w, k, red = box(0, -8, 20, 40, 32, 40), box(0, 16, 20, 40, 16, 40), [], []
    k += holes_x([20, -20], [-14, 0], [20])
    if kind == "gyro":
        k += cyl("z", 0, -8, 9, 39.8, 40.4); red += box(0, -8, 40.5, 10, 2, 0.6)
        k += box(0, -24.2, 20, 20, 0.8, 10)
    elif kind == "touch":
        red += box(0, -28, 20, 16, 8, 18); k += box(0, -24, 32, 20, 0.8, 4)
    else:
        red += cyl("y", 0, 20, 9, -28, -24, rin=6); k += cyl("y", 0, 20, 6, -27, -24)
    return [(LG, g), (WH, w), (BLK, k), (RED, red)]

def ultrasonic():
    blk, wh, red = box(0, -2, 20, 70, 24, 40), box(0, 20, 20, 70, 20, 40), []
    for x in (-17, 17):
        blk += cyl("y", x, 20, 14, -22, -14) + cyl("y", x, 20, 7.5, -23, -22)
        red += cyl("y", x, 20, 11, -23.5, -22, rin=7.5)
    return [(BLK, blk), (WH, wh), (RED, red)]

def pbrick():
    w = box(0, 0, 18, 112, 72, 36)
    g = box(0, 0, 37.5, 108, 68, 3)
    k = box(2, 14, 39.4, 50, 24, 1.2)  # LCD
    lcd = k
    k = []
    for s in (-1, 1):
        for x in (-33, -11, 11, 33): k += box(x, s * 36, 18, 14, 0.8, 10)  # output (-y) / input (+y) ports
    k += holes_x([56, -56], [-24, -8, 8, 24], [18])
    btn = []
    for bx, by in ((-34, 2), (-34, -18), (-44, -8), (-24, -8), (-34, -8), (-4, -22)): btn += box(bx, by, 39.4, 8, 8, 1.2)
    return [(WH, w), (LG, g), (LCD, lcd), (BLK, k), (BTN, btn)]

BUILD = {}
for n in (3, 5, 7, 9, 11, 13, 15): BUILD[f"beam_{n}m"] = lambda n=n: beam(n)
BUILD["ang_3x5_90"] = lambda: angular(3, 5, 90, WH)
BUILD["ang_4x2_90"] = lambda: angular(4, 2, 90, RED)
BUILD["ang_4x4_53"] = lambda: angular(4, 4, 53.13, WH)
BUILD["ang_4x6_53"] = lambda: angular(4, 6, 53.13, DG)
for n in (3, 4, 5, 6, 7, 8, 10, 12): BUILD[f"axle_{n}m"] = lambda n=n: axle(n)
BUILD["peg_friction_2m"] = lambda: peg(16, [4.5], BLK)
BUILD["peg_3m"] = lambda: peg(24, [], BEIGE)
BUILD["peg_friction_3m"] = lambda: peg(24, [4, 9], BLUE)
BUILD["conn_peg_axle"] = conn_peg_axle
BUILD["bush_cross_1m"] = bush
for z in (8, 16, 24, 40): BUILD[f"gear_z{z}"] = lambda z=z: gear(z)
BUILD["wheel_56x28"] = wheel
BUILD["steel_ball"] = steel_ball
BUILD["large_motor"] = lambda: motor(40, 56, True)
BUILD["medium_motor"] = lambda: motor(40, 40, False)
BUILD["sensor_gyro"] = lambda: sensor("gyro")
BUILD["sensor_touch"] = lambda: sensor("touch")
BUILD["sensor_color"] = lambda: sensor("color")
BUILD["sensor_ultrasonic"] = ultrasonic
BUILD["pbrick"] = pbrick

# ---------------------------------------------------------------- finalise + writers
def finalize(groups):
    """merge same-colour groups, centre bbox on X/Y, put zmin on 0."""
    merged = {}
    for col, m in groups: merged.setdefault(col, []).extend(m)
    pts = [p for m in merged.values() for t in m for p in t]
    lo = [min(p[i] for p in pts) for i in range(3)]; hi = [max(p[i] for p in pts) for i in range(3)]
    dx, dy, dz = -(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]
    return {c: T(m, dx, dy, dz) for c, m in merged.items()}

def indexed(m):
    return [p for t in m for p in t], list(range(3 * len(m)))

def fmt(x):
    s = "%.2f" % x
    s = s.rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s

def write_stl(path, mesh):
    with open(path, "wb") as f:
        f.write(b"EV3 parts generator".ljust(80, b"\0")); f.write(struct.pack("<I", len(mesh)))
        for a, b, c in mesh:
            u = (b[0] - a[0], b[1] - a[1], b[2] - a[2]); v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
            n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
            l = math.sqrt(sum(q * q for q in n)) or 1.0
            f.write(struct.pack("<12fH", n[0] / l, n[1] / l, n[2] / l, *a, *b, *c, 0))

def write_obj_mtl(pid, groups):
    mn = lambda c: "c_" + c[1:]
    with open(OUT / f"{pid}.mtl", "w") as f:
        for c in groups:
            f.write(f"newmtl {mn(c)}\nKd {int(c[1:3],16)/255:.4f} {int(c[3:5],16)/255:.4f} {int(c[5:7],16)/255:.4f}\nKa 0 0 0\nd 1\n\n")
    with open(OUT / f"{pid}.obj", "w") as f:
        f.write(f"mtllib {pid}.mtl\no {pid}\n")
        off = 1
        for c, m in groups.items():
            v, _ = indexed(m)
            f.write("".join("v %.4f %.4f %.4f\n" % p for p in v))
            f.write(f"g {pid}_{c[1:]}\nusemtl {mn(c)}\n")
            f.write("".join("f %d %d %d\n" % (off + i, off + i + 1, off + i + 2) for i in range(0, len(v), 3)))
            off += len(v)

def open_edges(m):
    key = lambda p: (round(p[0], 4), round(p[1], 4), round(p[2], 4))
    cnt = {}
    for a, b, c in m:
        for p, q in ((a, b), (b, c), (c, a)):
            e = (key(p), key(q))
            if e[0] != e[1]: cnt[e] = cnt.get(e, 0) + 1
    return sum(1 for (p, q), n in cnt.items() if cnt.get((q, p), 0) != n)

def main():
    OUT.mkdir(exist_ok=True); VIEW.mkdir(exist_ok=True)
    ids = [m[0] for m in MANIFEST]
    assert len(ids) == len(set(ids)) == 37 and set(BUILD) == set(ids), "manifest/builder mismatch"
    entries, raw_open, tri_counts = [], {}, {}
    for pid, name, cat, approx in MANIFEST:
        assert cat in CATEGORIES
        groups = finalize(BUILD[pid]())
        allm = [t for m in groups.values() for t in m]
        write_stl(OUT / f"{pid}.stl", allm); write_obj_mtl(pid, groups)
        tri_counts[pid] = len(allm)
        raw_open[pid] = sum(open_edges(m) for m in groups.values())
        pts = [p for t in allm for p in t]
        dims = [round(max(p[i] for p in pts) - min(p[i] for p in pts), 2) for i in range(3)]
        meshes = []
        for c, m in groups.items():
            v, f = indexed(m)
            meshes.append('{color:"%s",v:[%s],f:[%s]}' % (c, ",".join(fmt(x) for p in v for x in p), ",".join(map(str, f))))
        entries.append('{id:%s,name:%s,category:%s,dims_mm:[%s],approx:%s,meshes:[%s]}' % (
            json.dumps(pid), json.dumps(name), json.dumps(cat), ",".join(fmt(d) for d in dims), "true" if approx else "false", ",".join(meshes)))
    js = "window.PARTS=[\n" + ",\n".join(entries) + "\n];\n"
    (VIEW / "models.js").write_text(js, encoding="utf-8")
    return ids, tri_counts, raw_open

def selfcheck(ids, tri_counts, raw_open):
    fails = []
    txt = (VIEW / "models.js").read_text(encoding="utf-8")
    import re
    # JS object keys are unquoted; quote them so json can parse the contract back
    parts = json.loads(re.sub(r'([{,])(id|name|category|dims_mm|approx|meshes|color|v|f):', r'\1"\2":', txt[len("window.PARTS="):].rstrip().rstrip(";")))
    if [p["id"] for p in parts] != ids: fails.append("models.js ids != manifest")
    print(f"{'id':18}{'tris':>7}  {'bbox X x Y x Z (mm)':28}{'volume mm3':>12}  open-edges")
    for p in parts:
        pid = p["id"]
        for ext in ("stl", "obj", "mtl"):
            if not (OUT / f"{pid}.{ext}").exists(): fails.append(f"{pid}: missing .{ext}")
        ntri, pts, vtot = 0, [], 0.0
        for m in p["meshes"]:
            v, f = m["v"], m["f"]
            if len(v) % 3 or len(f) % 3 or (f and (min(f) < 0 or max(f) >= len(v) // 3)): fails.append(f"{pid}: bad indices")
            tri = [tuple(tuple(v[3 * i:3 * i + 3]) for i in f[k:k + 3]) for k in range(0, len(f), 3)]
            vv = vol(tri)
            if vv <= 0: fails.append(f"{pid}: non-positive volume in {m['color']}")
            vtot += vv; ntri += len(tri); pts += [q for t in tri for q in t]
        bb = [max(q[i] for q in pts) - min(q[i] for q in pts) for i in range(3)]
        if abs(min(q[2] for q in pts)) > 0.011 or abs(max(q[0] for q in pts) + min(q[0] for q in pts)) > 0.011: fails.append(f"{pid}: not centred/grounded")
        if pid.startswith("beam_") and abs(bb[0] - int(pid[5:-1]) * 8) > 0.011: fails.append(f"{pid}: beam length {bb[0]:.2f}")
        if pid.startswith("axle_") and abs(bb[0] - int(pid[5:-1]) * 8) > 0.011: fails.append(f"{pid}: axle length {bb[0]:.2f}")
        if pid in STRICT and raw_open[pid]: fails.append(f"{pid}: {raw_open[pid]} open edges")
        with open(OUT / f"{pid}.stl", "rb") as fh:
            hdr = fh.read(84)
        n_stl = struct.unpack("<I", hdr[80:84])[0]
        if n_stl != ntri or (OUT / f"{pid}.stl").stat().st_size != 84 + 50 * n_stl: fails.append(f"{pid}: STL count {n_stl} != {ntri}")
        if (OUT / f"{pid}.obj").read_text().count("usemtl") != len(p["meshes"]): fails.append(f"{pid}: obj usemtl count")
        print(f"{pid:18}{ntri:>7}  {bb[0]:7.2f} x {bb[1]:6.2f} x {bb[2]:6.2f}   {vtot:12.1f}  {raw_open[pid]}")
    print(f"parts: {len(parts)}   models.js size: {(VIEW / 'models.js').stat().st_size / 1e6:.2f} MB")
    if fails:
        print("SELF-CHECK FAILED:"); [print("  -", f) for f in fails]; return 1
    print("SELF-CHECK PASSED"); return 0

if __name__ == "__main__":
    sys.exit(selfcheck(*main()))
