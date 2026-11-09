"""EV3 part models from the official LDraw Parts Library (CC BY 4.0, see README.md / ldraw_cache/CAreadme.txt).
Run: python -I build_models_ldraw.py [--src <ldraw root with parts/ and p/>]
Reads from ./ldraw_cache by default; if absent, reads --src (default below) and fills ldraw_cache with the files used.
Writes models/<id>.stl|obj|mtl and viewer/models.js, then self-checks (non-zero exit on failure).
stdlib only. LDraw: 1 LDU = 0.4 mm, Y down; converted to Z-up mm via (x,y,z)->(x, z, -y)*0.4 (proper rotation)."""
import math, os, re, shutil, sys, json, struct
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import build_models as old  # fallback builder (steel ball) + shared helpers/manifest

OUT, VIEW, CACHE = ROOT / "models", ROOT / "viewer", ROOT / "ldraw_cache"
DEFAULT_SRC = Path(r"C:\Users\il720506\AppData\Local\Temp\claude\5ba35b3dd6ec3dbb\43baf85d-2f58-4227-b13a-ee642f0a0ffa\scratchpad\ldraw\ldraw")

# id -> (mode, [(ldraw file, default colour code), ...], note). Colour codes: 71 light bluish grey, 72 dark bluish grey,
# 15 white, 4 red, 0 black, 1 blue, 19 tan. mode: beam (long->X, thin->Z), axle (long->X), axis (LDraw Y axis -> Z),
# elec (upright, longest horizontal -> X), None = fallback to old parametric builder.
MAP = {}
for _n, _f in ((3, "32523"), (5, "32316"), (7, "32524"), (9, "40490"), (11, "32525"), (13, "41239"), (15, "32278")):
    MAP[f"beam_{_n}m"] = ("beam", [(_f + ".dat", 71)], f"Technic Beam {_n}")
MAP["ang_3x5_90"] = ("beam", [("32526.dat", 15)], "Technic Beam 3 x 5 Bent 90")
MAP["ang_4x2_90"] = ("beam", [("32140.dat", 4)], "Technic Beam 2 x 4 Liftarm Bent 90")
MAP["ang_4x4_53"] = ("beam", [("32348.dat", 15)], "Technic Beam 4 x 4 Liftarm Bent 53.13")
MAP["ang_4x6_53"] = ("beam", [("6629.dat", 72)], "Technic Beam 4 x 6 Liftarm Bent 53.13")
for _n, _f in ((3, "4519"), (4, "3705"), (5, "32073"), (6, "3706"), (7, "44294"), (8, "3707"), (10, "3737"), (12, "3708")):
    MAP[f"axle_{_n}m"] = ("axle", [(_f + ".dat", 72)], f"Technic Axle {_n}")
MAP["peg_friction_2m"] = ("axle", [("2780.dat", 0)], "Technic Pin with Friction and Slots")
MAP["peg_3m"] = ("axle", [("32556a.dat", 19)], "Technic Pin Long without Friction with Single Slot (32556 moved to 32556a)")
MAP["peg_friction_3m"] = ("axle", [("6558.dat", 1)], "Technic Pin Long with Friction and Slot")
MAP["conn_peg_axle"] = ("axle", [("43093.dat", 1)], "Technic Axle Pin with Friction")
MAP["bush_cross_1m"] = ("axis", [("3713.dat", 71)], "Technic Bush with Two Flanges")
MAP["gear_z8"] = ("axis", [("3647.dat", 72)], "Technic Gear 8 Tooth")
MAP["gear_z16"] = ("axis", [("4019.dat", 72)], "Technic Gear 16 Tooth")
MAP["gear_z24"] = ("axis", [("3648b.dat", 72)], "Technic Gear 24 Tooth with Single Axle Hole (3648 moved to 3648b)")
MAP["gear_z40"] = ("axis", [("3649.dat", 72)], "Technic Gear 40 Tooth")
MAP["wheel_56x28"] = ("axis", [("56908.dat", 71), ("41897.dat", 0)], "Wheel Rim 26 x 43 with 6 Spokes and 6 Pegholes + Tyre 28/ 23 x 43 ZR Street (56 x 28)")
MAP["steel_ball"] = (None, [], "no LDraw part: parametric sphere from build_models.py")
MAP["large_motor"] = ("elec", [("95658.dat", 15)], "Electric Mindstorms EV3 Large Motor")
MAP["medium_motor"] = ("elec", [("99455.dat", 15)], "Electric Mindstorms EV3 Medium Motor")
MAP["sensor_gyro"] = ("elec", [("99380.dat", 15)], "Electric Mindstorms EV3 Gyroscopic Sensor")
MAP["sensor_touch"] = ("elec", [("95648.dat", 15)], "Electric Mindstorms EV3 Touch Sensor")
MAP["sensor_color"] = ("elec", [("95650.dat", 15)], "Electric Mindstorms EV3 Colour Sensor")
MAP["sensor_ultrasonic"] = ("elec", [("95652.dat", 15)], "Electric Mindstorms EV3 Ultrasonic Sensor")
MAP["pbrick"] = ("elec", [("95646.dat", 15)], "Electric Mindstorms EV3")

EV3_SIZES = {"pbrick": (111.2, 72.0, 43.6), "large_motor": (107.2, 55.2, 40.0), "medium_motor": (72.4, 24.0, 31.2),
             "sensor_touch": (43.6, 24.0, 31.2), "sensor_color": (39.6, 24.0, 31.2), "sensor_gyro": (39.6, 24.0, 31.2),
             "sensor_ultrasonic": (47.4, 55.2, 31.2)}
SCALE = 0.4

# ---------------------------------------------------------------- LDraw loader
class Lib:
    def __init__(self, root):
        self.root, self.index, self.cache, self.used, self.missing = Path(root), {}, {}, set(), set()
        for sub in ("parts", "p"):
            for dp, _, fns in os.walk(self.root / sub):
                for fn in fns:
                    if fn.lower().endswith(".dat"):
                        rel = Path(dp, fn).relative_to(self.root).as_posix()
                        self.index[rel.lower()] = rel
        self.colours = {}
        for line in open(self.root / "LDConfig.ldr", encoding="utf-8", errors="replace"):
            m = re.search(r"!COLOU?R\s+\S+\s+CODE\s+(\d+)\s+VALUE\s+#([0-9A-Fa-f]{6})", line)
            if m: self.colours[int(m.group(1))] = "#" + m.group(2).lower()

    def find(self, name):
        n = name.replace("\\", "/").lower().strip()
        for pre in ("parts/", "p/", "parts/s/", "p/48/", "p/8/"):
            if pre + n in self.index: return self.index[pre + n]
        base = n.rsplit("/", 1)[-1]
        for pre in ("parts/s/", "p/48/", "p/8/"):
            if pre + base in self.index: return self.index[pre + base]
        return None

    def parse(self, rel):
        if rel in self.cache: return self.cache[rel]
        ops, cw, inv_next = [], False, False
        for line in open(self.root / rel, encoding="utf-8", errors="replace"):
            t = line.split()
            if not t: continue
            if t[0] == "0":
                if len(t) > 1 and t[1] == "BFC":
                    w = t[2:]
                    if "INVERTNEXT" in w: inv_next = True
                    elif "CW" in w: cw = True
                    elif "CCW" in w: cw = False
            elif t[0] == "1" and len(t) >= 15:
                ops.append(("s", int(t[1]) if t[1].isdigit() else self.direct(t[1]), tuple(map(float, t[2:14])), " ".join(t[14:]), inv_next))
                inv_next = False
            elif t[0] in ("3", "4"):
                k = 3 if t[0] == "3" else 4
                if len(t) < 2 + 3 * k: continue
                v = [tuple(map(float, t[2 + 3 * i:5 + 3 * i])) for i in range(k)]
                if cw: v = v[::-1]  # normalise to CCW in-file
                ops.append(("p", int(t[1]) if t[1].isdigit() else self.direct(t[1]), v))
        self.cache[rel] = ops
        return ops

    def direct(self, s):  # 0x2RRGGBB direct colour -> synthetic code kept as hex string
        return s

    def rgb(self, code):
        if isinstance(code, str):
            return "#" + code[3:].lower() if code.lower().startswith("0x2") else "#808080"
        return self.colours.get(code, "#808080")

    def flatten(self, name, colour, M, out, inv=False, depth=0):
        """Append (rgb, tri) to out; M = (r00..r22 row-major 9, tx,ty,tz) in LDU."""
        rel = self.find(name)
        if rel is None or depth > 40:
            self.missing.add(name); return
        self.used.add(rel)
        for op in self.parse(rel):
            if op[0] == "p":
                col = colour if op[1] in (16, 24) else op[1]
                v = [self.xf(M, p) for p in op[2]]
                if inv: v = v[::-1]
                rgb = self.rgb(col)
                out.append((rgb, (v[0], v[1], v[2])))
                if len(v) == 4: out.append((rgb, (v[0], v[2], v[3])))
            else:
                _, col, m, sub, invn = op
                col = colour if col in (16, 24) else col
                a, b, c, d, e, f, g, h, i = m[3:12]
                nm = self.xf_rot(M, (a, b, c, d, e, f, g, h, i))
                t = self.xf(M, m[0:3])
                det = (nm[0] * (nm[4] * nm[8] - nm[5] * nm[7]) - nm[1] * (nm[3] * nm[8] - nm[5] * nm[6]) + nm[2] * (nm[3] * nm[7] - nm[4] * nm[6]))
                self.flatten(sub, col, nm + t, out, inv ^ invn ^ (det < 0) ^ (self._det(M) < 0), depth + 1)

    def features(self, name, M, out, in_bush=False, depth=0):
        """Append (basename, M) for every snap-feature primitive (FEAT) below `name`; does not descend into them,
        except bush* (shaft) which holds the bush's cross hole. Same matrix chain as flatten."""
        rel = self.find(name)
        if rel is None or depth > 40: return
        for op in self.parse(rel):
            if op[0] != "s": continue
            nm, b = self.xf_rot(M, op[2][3:12]) + self.xf(M, op[2][0:3]), basename(op[3])
            hit = FEAT.match(b) and not (in_bush and b.startswith("bush"))
            if hit: out.append((b, nm))
            if not hit or b.startswith("bush"): self.features(op[3], nm, out, in_bush or b.startswith("bush"), depth + 1)

    def verts(self, name, M, depth=0):
        """Face vertices of a primitive under M (LDU); npeghol* sub-files are face patches reaching towards the
        neighbouring hole (origin 10 LDU off-axis), so they are left out of the hole's own geometry."""
        rel, out = self.find(name), []
        if rel is None or depth > 40: return out
        for op in self.parse(rel):
            if op[0] == "p": out += [self.xf(M, p) for p in op[2]]
            elif not basename(op[3]).startswith("npeghol"): out += self.verts(op[3], self.xf_rot(M, op[2][3:12]) + self.xf(M, op[2][0:3]), depth + 1)
        return out

    @staticmethod
    def _det(M):
        return M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6])

    @staticmethod
    def xf(M, p):
        return (M[0] * p[0] + M[1] * p[1] + M[2] * p[2] + M[9], M[3] * p[0] + M[4] * p[1] + M[5] * p[2] + M[10], M[6] * p[0] + M[7] * p[1] + M[8] * p[2] + M[11])

    @staticmethod
    def xf_rot(M, r):
        return tuple(M[3 * i] * r[j] + M[3 * i + 1] * r[3 + j] + M[3 * i + 2] * r[6 + j] for i in range(3) for j in range(3))

IDENT = (1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0)

# ---------------------------------------------------------------- snap features (hole / shaft axes)
# npeghol* (patches between holes), connectring/connectslit* (long-pin middle decoration), fric (inside confric*) are
# not features; edge-only primitives (axlehol2/3/9, axl2hol2/9, axl5hol9) have no faces and are dropped.
FEAT = re.compile(r"(peghole|beamhole|connhole|axl\w*|bush\w*|confric\w*|connect\d\w*)\.dat$")
basename = lambda s: s.replace("\\", "/").lower().rsplit("/", 1)[-1]
dot = lambda a, b: a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
sub = lambda a, b: (a[0] - b[0], a[1] - b[1], a[2] - b[2])
axpy = lambda s, a, b: (s * a[0] + b[0], s * a[1] + b[1], s * a[2] + b[2])  # s*a + b
unit = lambda a: axpy(1 / math.sqrt(dot(a, a)), a, (0, 0, 0))
crossn = lambda a, b: math.sqrt(dot(a, a) * dot(b, b) - dot(a, b) ** 2)  # |a x b|

def classify(b, mode):
    if b.startswith(("bush", "confric", "connect")): return "shaft", "round"
    if b.startswith("axl"): return ("shaft" if mode == "axle" else "hole"), "cross"  # axle parts use axlehol8 as shaft body
    return "hole", "round"  # peghole, beamhole, connhole

def build_ldraw(lib, files, mode=None):
    """files [(name,colour)] -> ({rgb: [tri,...]} in Z-up mm, feature point triples (o, o+d, o+u) in the same frame,
    feature meta [(k, p, name, r_mm, [t0, t1]_mm)], primitive log [(name, 'k/p' or 'edge-only, dropped')])."""
    raw, prims = [], []
    for name, col in files: lib.flatten(name, col, IDENT, raw); lib.features(name, IDENT, prims)
    cv = lambda p: (p[0] * SCALE, p[2] * SCALE, -p[1] * SCALE)  # (x,y,z)->(x,z,-y), det +1
    groups = {}
    for rgb, (a, b, c) in raw:
        groups.setdefault(rgb, []).append((cv(a), cv(b), cv(c)))
    ftris, fmeta, plog = [], [], []
    for b, M in prims:
        V = lib.verts(b, M)
        if not V: plog.append((b, "edge-only, dropped")); continue
        ax = 2 if b.startswith("bush") else 1  # bush primitives are modelled along their local Z, all others along Y
        o, d = M[9:12], unit((M[ax], M[3 + ax], M[6 + ax]))
        u = unit(axpy(-dot((M[0], M[3], M[6]), d), d, (M[0], M[3], M[6])))
        t = [dot(sub(v, o), d) for v in V]
        r = max(math.sqrt(max(0.0, dot(sub(v, o), sub(v, o)) - s * s)) for v, s in zip(V, t))
        k, p = classify(b, mode)
        ftris.append((cv(o), cv(axpy(1, d, o)), cv(axpy(1, u, o))))
        fmeta.append((k, p, b, r * SCALE, [min(t) * SCALE, max(t) * SCALE]))
        plog.append((b, f"{k}/{p}"))
    return groups, ftris, fmeta, plog

def merge_features(ftris, fmeta):
    """Final-frame triples + meta -> list of feature dicts. Coaxial holes (gap <= 7 mm, e.g. peghole ends on both faces)
    and contiguous cross shafts (axle body + ends) merge into one segment; round shafts (pin halves) stay separate."""
    segs = []
    for (a, b, c), (k, p, n, r, l) in zip(ftris, fmeta):
        d = unit(sub(b, a)); u = sub(c, a)
        segs.append(dict(k=k, p=p, o=a, d=d, u=unit(axpy(-dot(u, d), d, u)), r=r, l=l, n=n, w=1))
    def merge(s, t):
        if (s["k"], s["p"]) != (t["k"], t["p"]) or (s["k"], s["p"]) == ("shaft", "round") or abs(s["r"] - t["r"]) > 1.0: return False
        if crossn(s["d"], t["d"]) > 1e-3: return False
        w = sub(t["o"], s["o"]); a = dot(w, s["d"]); perp = axpy(-a, s["d"], w)
        if dot(perp, perp) > 0.3 ** 2: return False  # gear_z16's 4 axlehol6 teeth sit 0.11 mm off-centre
        sg = 1 if dot(s["d"], t["d"]) > 0 else -1
        lo, hi = sorted((a + sg * t["l"][0], a + sg * t["l"][1]))
        if max(lo - s["l"][1], s["l"][0] - hi) > (7.0 if s["k"] == "hole" else 0.1): return False  # face-to-face peghole pair: 6.4 mm
        s["l"] = [min(s["l"][0], lo), max(s["l"][1], hi)]; s["r"] = max(s["r"], t["r"])
        s["o"] = axpy(t["w"] / (s["w"] + t["w"]), perp, s["o"]); s["w"] += t["w"]  # o -> centroid of member axes
        return True
    i = 0
    while i < len(segs):
        j = next((j for j in range(i + 1, len(segs)) if merge(segs[i], segs[j])), None)
        if j is None: i += 1
        else: del segs[j]; i = 0
    rnd = lambda x: round(x, 3) + 0.0  # + 0.0 turns -0.0 into 0.0
    out = []
    for s in segs:
        f = {"k": s["k"], "p": s["p"], "o": [rnd(x) for x in s["o"]], "d": [rnd(x) for x in s["d"]], "u": [rnd(x) for x in s["u"]],
             "r": rnd(s["r"]), "l": [rnd(x) for x in s["l"]], "n": s["n"]}
        if f not in out: out.append(f)
    return out

# ---------------------------------------------------------------- orientation / welding
def bbox(groups):
    pts = [p for m in groups.values() for t in m for p in t]
    return [min(p[i] for p in pts) for i in range(3)], [max(p[i] for p in pts) for i in range(3)]

def permute(groups, order):
    """new axes = old axes in `order`; negate the last axis if the permutation is odd (keeps a proper rotation)."""
    odd = sum(1 for i in range(3) for j in range(i + 1, 3) if order[i] > order[j]) % 2
    s = -1 if odd else 1
    f = lambda p: (p[order[0]], p[order[1]], s * p[order[2]])
    return {c: [tuple(f(p) for p in t) for t in m] for c, m in groups.items()}

def orient(groups, mode, feats=()):
    """Orient + centre the mesh; `feats` (point triples) get exactly the same ops. bbox comes from the mesh only."""
    lo, hi = bbox(groups)
    ext = [hi[i] - lo[i] for i in range(3)]
    if mode in ("beam", "axle"):
        order = sorted(range(3), key=lambda i: -ext[i])
        groups, feats = permute(groups, order), permute({0: feats}, order)[0]
    elif mode == "axis":  # rotation axis = the axis whose extent differs from the (equal) pair of diameters -> Z
        k = min(range(3), key=lambda a: abs(ext[(a + 1) % 3] - ext[(a + 2) % 3]))
        groups, feats = permute(groups, [(k + 1) % 3, (k + 2) % 3, k]), permute({0: feats}, [(k + 1) % 3, (k + 2) % 3, k])[0]
    elif mode == "elec":
        if ext[1] > ext[0]: groups, feats = {c: old.R(m, "z", 90) for c, m in groups.items()}, old.R(feats, "z", 90)
    lo, hi = bbox(groups)
    dx, dy, dz = -(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]
    return {c: old.T(m, dx, dy, dz) for c, m in groups.items()}, old.T(feats, dx, dy, dz)

def weld(tris):
    idx, V, F = {}, [], []
    for t in tris:
        f = []
        for p in t:
            k = (round(p[0] / 0.01), round(p[1] / 0.01), round(p[2] / 0.01))
            if k not in idx: idx[k] = len(V); V.append((k[0] * 0.01, k[1] * 0.01, k[2] * 0.01))
            f.append(idx[k])
        if len(set(f)) == 3: F.append(tuple(f))
    return V, F

def vol_idx(V, F):
    return sum(V[a][0] * (V[b][1] * V[c][2] - V[b][2] * V[c][1]) - V[a][1] * (V[b][0] * V[c][2] - V[b][2] * V[c][0]) + V[a][2] * (V[b][0] * V[c][1] - V[b][1] * V[c][0]) for a, b, c in F) / 6.0

# ---------------------------------------------------------------- writers
def write_obj_mtl(pid, groups):
    mn = lambda c: "c_" + c[1:]
    with open(OUT / f"{pid}.mtl", "w") as f:
        for c in groups:
            f.write(f"newmtl {mn(c)}\nKd {int(c[1:3],16)/255:.4f} {int(c[3:5],16)/255:.4f} {int(c[5:7],16)/255:.4f}\nKa 0 0 0\nd 1\n\n")
    with open(OUT / f"{pid}.obj", "w") as f:
        f.write(f"mtllib {pid}.mtl\no {pid}\n")
        off = 1
        for c, (V, F) in groups.items():
            f.write("".join("v %.2f %.2f %.2f\n" % p for p in V))
            f.write(f"g {pid}_{c[1:]}\nusemtl {mn(c)}\n")
            f.write("".join("f %d %d %d\n" % (a + off, b + off, c_ + off) for a, b, c_ in F))
            off += len(V)

def main(src):
    OUT.mkdir(exist_ok=True); VIEW.mkdir(exist_ok=True)
    use_cache = CACHE.exists() and src is None
    lib = Lib(CACHE if use_cache else (src or DEFAULT_SRC))
    print("LDraw source:", lib.root, "(cache)" if use_cache else "(full library; will fill ldraw_cache)")
    entries, info = [], {}
    for pid, name, cat, approx in old.MANIFEST:
        mode, files, note = MAP[pid]
        fell_back = mode is None
        if fell_back:
            groups = old.finalize(old.BUILD[pid]())
            lname, feats, plog = "(parametric)", [], []
        else:
            groups, ftris, fmeta, plog = build_ldraw(lib, files, mode)
            groups, ftris = orient(groups, mode, ftris)
            feats = merge_features(ftris, fmeta)
            lname = "+".join(f[0][:-4] for f in files)
        for (n, kp), cnt in sorted(Counter(plog).items()): print(f"  feature-prim {pid:18}{n:14}{kp:20} x{cnt}")
        out, flipped, odd = {}, [], []
        for c, tris in groups.items():
            if old.vol(tris) < 0: tris = [(a, c_, b) for a, b, c_ in tris]; flipped.append(c)
            V, F = weld(tris)
            if vol_idx(V, F) <= 0: odd.append(c)
            if F: out[c] = (V, F)
        alltris = [(V[a], V[b], V[c]) for V, F in out.values() for a, b, c in F]
        old.write_stl(OUT / f"{pid}.stl", alltris); write_obj_mtl(pid, out)
        lo = [min(p[i] for t in alltris for p in t) for i in range(3)]; hi = [max(p[i] for t in alltris for p in t) for i in range(3)]
        dims = [round(hi[i] - lo[i], 2) for i in range(3)]
        meshes = ['{color:"%s",v:[%s],f:[%s]}' % (c, ",".join(old.fmt(x) for p in V for x in p), ",".join(str(i) for t in F for i in t)) for c, (V, F) in out.items()]
        entries.append('{id:%s,name:%s,category:%s,dims_mm:[%s],approx:%s,meshes:[%s],features:%s}' % (
            json.dumps(pid), json.dumps(name), json.dumps(cat), ",".join(old.fmt(d) for d in dims), "true" if fell_back else "false", ",".join(meshes),
            json.dumps(feats, separators=(",", ":"))))
        info[pid] = dict(ldraw=lname, tris=len(alltris), dims=dims, flipped=flipped, odd=odd, fallback=fell_back, groups=len(out))
    (VIEW / "models.js").write_text("window.PARTS=[\n" + ",\n".join(entries) + "\n];\n", encoding="utf-8")
    if lib.missing: print("missing sub-files (skipped):", sorted(lib.missing)[:40], len(lib.missing))
    if not use_cache:  # copy only used files so the build is reproducible offline
        for rel in lib.used:
            d = CACHE / rel; d.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(lib.root / rel, d)
        for extra in ("CAreadme.txt", "CAlicense4.txt", "LDConfig.ldr"): shutil.copyfile(lib.root / extra, CACHE / extra)
        print(f"ldraw_cache filled with {len(lib.used)} .dat files")
    return info

# beam holes run along final Y: a beam is 8 mm deep (hole axis) but only 7.2 mm high, so orient() puts the hole axis on Y
FEAT_EXPECT = {"beam_3m": (3, "hole", "round", 1), "peg_friction_2m": (2, "shaft", "round", 0), "axle_3m": (1, "shaft", "cross", 0),
               "gear_z8": (1, "hole", "cross", 2)}

def selfcheck(info):
    fails = []
    txt = (VIEW / "models.js").read_text(encoding="utf-8")
    parts = json.loads(re.sub(r'([{,])(id|name|category|dims_mm|approx|meshes|features|color|v|f):', r'\1"\2":', txt[len("window.PARTS="):].rstrip().rstrip(";")))
    ids = [m[0] for m in old.MANIFEST]
    if [p["id"] for p in parts] != ids: fails.append("models.js ids != manifest")
    print(f"{'id':18}{'ldraw':16}{'tris':>8} {'groups':>6}  {'bbox X x Y x Z (mm)':28}{'size MB':>8}")
    for p in parts:
        pid = p["id"]; i = info[pid]
        for ext in ("stl", "obj", "mtl"):
            if not (OUT / f"{pid}.{ext}").exists(): fails.append(f"{pid}: missing .{ext}")
        ntri, pts = 0, []
        for m in p["meshes"]:
            v, f = m["v"], m["f"]
            if len(v) % 3 or len(f) % 3 or (f and (min(f) < 0 or max(f) >= len(v) // 3)): fails.append(f"{pid}: bad indices")
            ntri += len(f) // 3; pts += [tuple(v[k:k + 3]) for k in range(0, len(v), 3)]
        bb = [max(q[a] for q in pts) - min(q[a] for q in pts) for a in range(3)]
        if abs(min(q[2] for q in pts)) > 0.011 or abs(max(q[0] for q in pts) + min(q[0] for q in pts)) > 0.011: fails.append(f"{pid}: not centred/grounded")
        if pid.startswith("beam_") and abs(bb[0] - (int(pid[5:-1]) * 8 - 0.8)) > 0.1: fails.append(f"{pid}: beam length {bb[0]:.2f}")  # LDraw beams are 0.8 mm short of n*8
        if pid in EV3_SIZES and any(abs(a - b) > 0.5 for a, b in zip(sorted(bb), sorted(EV3_SIZES[pid]))): fails.append(f"{pid}: bbox {sorted(bb)} vs {sorted(EV3_SIZES[pid])}")
        with open(OUT / f"{pid}.stl", "rb") as fh: n_stl = struct.unpack("<I", fh.read(84)[80:84])[0]
        if n_stl != ntri or (OUT / f"{pid}.stl").stat().st_size != 84 + 50 * n_stl: fails.append(f"{pid}: STL count {n_stl} != {ntri}")
        if (OUT / f"{pid}.obj").read_text().count("usemtl") != len(p["meshes"]): fails.append(f"{pid}: obj usemtl count")
        if p["approx"] != i["fallback"]: fails.append(f"{pid}: approx flag")
        if i["odd"]: fails.append(f"{pid}: groups with volume <= 0 after flip: {i['odd']}")
        F = p["features"]; nh = sum(f["k"] == "hole" for f in F)
        lo3, hi3 = [min(q[a] for q in pts) for a in range(3)], [max(q[a] for q in pts) for a in range(3)]
        for f in F:
            if f["k"] not in ("hole", "shaft") or f["p"] not in ("round", "cross") or f["l"][0] > f["l"][1] or f["r"] <= 0: fails.append(f"{pid}: bad feature {f}")
            if any(not lo3[a] - 1 <= f["o"][a] <= hi3[a] + 1 for a in range(3)): fails.append(f"{pid}: feature origin outside bbox {f}")
            if abs(dot(f["d"], f["d"]) - 1) > 0.004 or abs(dot(f["u"], f["u"]) - 1) > 0.004 or abs(dot(f["d"], f["u"])) > 0.004: fails.append(f"{pid}: d/u not unit+perpendicular {f}")
        if pid in FEAT_EXPECT:  # (count, k, p, final axis index of d)
            n, k, pr, ax = FEAT_EXPECT[pid]
            if len(F) != n or any((f["k"], f["p"]) != (k, pr) or abs(f["d"][ax]) < 0.999 for f in F): fails.append(f"{pid}: features {[(f['k'], f['p'], f['d']) for f in F]}")
        if pid == "beam_3m":  # one row of holes, 8 mm pitch along X
            xs = sorted(f["o"][0] for f in F)
            if any(abs(b - a - 8) > 0.01 for a, b in zip(xs, xs[1:])) or any(abs(f["o"][a] - F[0]["o"][a]) > 0.05 for f in F for a in (1, 2)): fails.append(f"{pid}: hole row {[f['o'] for f in F]}")
        if pid == "axle_3m" and F and abs(F[0]["l"][1] - F[0]["l"][0] - bb[0]) > 0.5: fails.append(f"{pid}: shaft length {F[0]['l']} vs {bb[0]:.2f}")
        sz = sum(len(json.dumps(m)) for m in p["meshes"]) / 1e6
        print(f"{pid:18}{i['ldraw']:16}{ntri:>8} {i['groups']:>6}  {bb[0]:7.2f} x {bb[1]:6.2f} x {bb[2]:6.2f}  {sz:8.2f}  holes {nh:2} shafts {len(F) - nh:2}" + (f"  flipped {len(i['flipped'])}" if i["flipped"] else ""))
    size = (VIEW / "models.js").stat().st_size / 1e6
    print(f"parts: {len(parts)}   total triangles: {sum(i['tris'] for i in info.values())}   models.js size: {size:.2f} MB")
    if size > 30: fails.append("models.js > 30 MB")
    if fails:
        print("SELF-CHECK FAILED:"); [print("  -", f) for f in fails]; return 1
    print("SELF-CHECK PASSED"); return 0

if __name__ == "__main__":
    a = sys.argv[1:]
    sys.exit(selfcheck(main(Path(a[a.index("--src") + 1]) if "--src" in a else None)))
