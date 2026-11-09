"""EV3 part models -> Rhino .3dm (one file per part id). stdlib + rhino3dm only. Run: python -I export_3dm.py [outdir]
Reads viewer/models.js (written by build_models_ldraw.py; same parse as its selfcheck), writes <outdir>/<id>.3dm
(file version 7, mm, Z-up), then reads every file back and verifies. Exit code != 0 on any failure."""
import json, re, struct, sys
from pathlib import Path
import rhino3dm as r

ROOT = Path(__file__).resolve().parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(r"F:\____IL_CPP\STM32F429I-DISCO\model3d\EVE3")
SRC = "LDraw Parts Library (CC BY 4.0), LEGO MINDSTORMS Team / Philippe Hurbain; built by build_models_ldraw.py"

txt = (ROOT / "viewer" / "models.js").read_text(encoding="utf-8")
# keys are unquoted JS; quote them (same approach as build_models_ldraw.selfcheck), then plain json
parts = json.loads(re.sub(r'([{,])(id|name|category|dims_mm|approx|meshes|features|color|v|f):', r'\1"\2":', txt[len("window.PARTS="):].rstrip().rstrip(";")))

def rgb(c): return int(c[1:3], 16), int(c[3:5], 16), int(c[5:7], 16), 255

def add_part(m, p, parent_idx, off=(0.0, 0.0)):
    """colour child layers + one mesh object per colour group; off = (dx, dy) mm."""
    for g in p["meshes"]:
        ly = r.Layer(); ly.Name = g["color"]; ly.Color = rgb(g["color"]); ly.ParentLayerId = m.Layers[parent_idx].Id
        li = m.Layers.Add(ly)
        me = r.Mesh()
        v = g["v"]
        for i in range(0, len(v), 3): me.Vertices.Add(v[i] + off[0], v[i + 1] + off[1], v[i + 2])
        f = g["f"]
        for i in range(0, len(f), 3): me.Faces.AddFace(f[i], f[i + 1], f[i + 2])
        me.Normals.ComputeNormals(); me.Compact()
        at = r.ObjectAttributes()
        at.Name = p["name"]; at.LayerIndex = li
        at.ObjectColor = rgb(g["color"]); at.ColorSource = r.ObjectColorSource.ColorFromObject
        at.SetUserString("source", SRC); at.SetUserString("category", p["category"]); at.SetUserString("approx", str(p["approx"]).lower())
        at.SetUserString("part_id", p["id"])
        m.Objects.AddMesh(me, at)

def new_doc():
    m = r.File3dm()
    m.Settings.ModelUnitSystem = r.UnitSystem.Millimeters
    m.Strings["source"] = SRC
    return m

def add_layer(m, name, parent_idx=None):
    ly = r.Layer(); ly.Name = name
    if parent_idx is not None: ly.ParentLayerId = m.Layers[parent_idx].Id
    return m.Layers.Add(ly)

def write(p):
    m = new_doc()
    m.Strings["category"] = p["category"]
    m.Strings["approx"] = str(p["approx"]).lower()
    m.Strings["part_id"] = p["id"]
    add_part(m, p, add_layer(m, p["name"]))
    path = OUT / (p["id"] + ".3dm")
    assert m.Write(str(path), 7), "write failed"
    return path

ORDER = ["Beams", "Angular beams", "Axles", "Pegs & bushes", "Gears", "Wheels", "Motors", "Sensors", "Brick", "Misc"]
GAP, ROWGAP, MAXW = 15.0, 40.0, 600.0
COMBINED = "EVE3_all_parts.3dm"

def layout(parts):
    """-> {id: (dx, dy)} offsets placing each part's bbox (centred on XY at origin in the source) in category rows."""
    assert set(p["category"] for p in parts) <= set(ORDER), "unknown category"
    pos, ycur = {}, 0.0
    for cat in ORDER:
        rows, row, w = [], [], 0.0
        for p in (q for q in parts if q["category"] == cat):
            if row and w + GAP + p["dims_mm"][0] > MAXW: rows.append(row); row, w = [], 0.0
            w += (GAP if row else 0.0) + p["dims_mm"][0]; row.append(p)
        if row: rows.append(row)
        for row in rows:
            depth, x = max(q["dims_mm"][1] for q in row), 0.0
            for q in row:
                pos[q["id"]] = (x + q["dims_mm"][0] / 2, ycur - q["dims_mm"][1] / 2)  # top edge of the row at ycur
                x += q["dims_mm"][0] + GAP
            ycur -= depth + ROWGAP
    return pos

def write_combined(parts):
    m = new_doc()
    pos = layout(parts)
    cats = {}
    for cat in ORDER:
        if any(p["category"] == cat for p in parts): cats[cat] = add_layer(m, cat)
    lab = add_layer(m, "Labels")
    for p in parts:
        add_part(m, p, add_layer(m, p["name"], cats[p["category"]]), pos[p["id"]])
        dx, dy = pos[p["id"]]
        at = r.ObjectAttributes(); at.Name = p["name"]; at.LayerIndex = lab
        at.SetUserString("part_id", p["id"]); at.SetUserString("category", p["category"]); at.SetUserString("source", SRC)
        m.Objects.AddTextDot(p["name"], r.Point3d(dx, dy, p["dims_mm"][2] + 5.0), at)
    path = OUT / COMBINED
    assert m.Write(str(path), 7), "combined write failed"
    return path

def check_combined(parts, path):
    errs = []
    m = r.File3dm.Read(str(path))
    if m is None: return ["unreadable"], None
    ng, ntri = sum(len(p["meshes"]) for p in parts), sum(len(g["f"]) // 3 for p in parts for g in p["meshes"])
    if len(m.Objects) != ng + len(parts): errs.append(f"objects {len(m.Objects)} != {ng}+{len(parts)}")
    if m.Settings.ModelUnitSystem != r.UnitSystem.Millimeters: errs.append("units not mm")
    faces, dots, bb = 0, 0, {}
    for o in m.Objects:
        g, pid = o.Geometry, o.Attributes.GetUserString("part_id")
        if isinstance(g, r.Mesh):
            faces += len(g.Faces); b = g.GetBoundingBox()
            c = bb.setdefault(pid, [[1e18] * 3, [-1e18] * 3])
            for i, (a, z) in enumerate(((b.Min.X, b.Max.X), (b.Min.Y, b.Max.Y), (b.Min.Z, b.Max.Z))): c[0][i] = min(c[0][i], a); c[1][i] = max(c[1][i], z)
        elif isinstance(g, r.TextDot): dots += 1
        else: errs.append("unexpected object type")
    if faces != ntri: errs.append(f"faces {faces} != {ntri}")
    if dots != len(parts): errs.append(f"labels {dots}")
    if len(bb) != len(parts): errs.append("part_id coverage")
    ids = list(bb)
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = bb[ids[i]], bb[ids[j]]
            if a[0][0] < b[1][0] and b[0][0] < a[1][0] and a[0][1] < b[1][1] and b[0][1] < a[1][1]: errs.append(f"overlap {ids[i]} / {ids[j]}")
    for p in parts:
        if p["id"] in bb and abs(bb[p["id"]][0][2]) > 0.05: errs.append(f"{p['id']} zmin != 0")
    lo = [min(b[0][i] for b in bb.values()) for i in range(3)]; hi = [max(b[1][i] for b in bb.values()) for i in range(3)]
    return errs, (ng, len(m.Objects), faces, [hi[i] - lo[i] for i in range(3)])

def stl_tris(pid):
    b = (ROOT / "models" / (pid + ".stl")).read_bytes()
    return struct.unpack_from("<I", b, 80)[0]

def check(p, path):
    errs = []
    m = r.File3dm.Read(str(path))
    if m is None: return ["unreadable"], 0, 0
    ng, ntri = len(p["meshes"]), sum(len(g["f"]) // 3 for g in p["meshes"])
    if len(m.Objects) != ng: errs.append(f"objects {len(m.Objects)} != {ng}")
    if m.Settings.ModelUnitSystem != r.UnitSystem.Millimeters: errs.append("units not mm")
    if ntri != stl_tris(p["id"]): errs.append(f"source tris {ntri} != STL {stl_tris(p['id'])}")
    faces, lo, hi = 0, [1e18] * 3, [-1e18] * 3
    for o in m.Objects:
        g = o.Geometry
        if not isinstance(g, r.Mesh): errs.append("non-mesh object"); continue
        faces += len(g.Faces)
        if o.Attributes.Name != p["name"]: errs.append("name mismatch")
        if len(g.Normals) != len(g.Vertices): errs.append("normals missing")
        bb = g.GetBoundingBox()
        for i, (a, b) in enumerate(zip((bb.Min.X, bb.Min.Y, bb.Min.Z), (bb.Max.X, bb.Max.Y, bb.Max.Z))): lo[i] = min(lo[i], a); hi[i] = max(hi[i], b)
    if faces != ntri: errs.append(f"faces {faces} != {ntri}")
    for i in range(3):
        if abs((hi[i] - lo[i]) - p["dims_mm"][i]) > 0.05: errs.append(f"bbox axis {i}: {hi[i]-lo[i]:.3f} vs {p['dims_mm'][i]}")
    if abs(lo[2]) > 0.05 or abs(lo[0] + hi[0]) > 0.1 or abs(lo[1] + hi[1]) > 0.1: errs.append("not centred / zmin != 0")
    if len(m.Layers) != ng + 1 or any(l.ParentLayerId != m.Layers[0].Id for l in list(m.Layers)[1:]): errs.append("layer structure")
    if m.Strings["source"] != SRC: errs.append("doc string missing")
    return errs, len(m.Objects), faces

OUT.mkdir(parents=True, exist_ok=True)
bad, tot = 0, 0
print(f"{'id':18}{'objects':>8}{'faces':>9}{'bytes':>10}  status")
for p in parts:
    path = write(p)
    errs, no, nf = check(p, path)
    sz = path.stat().st_size; tot += sz; bad += bool(errs)
    print(f"{p['id']:18}{no:>8}{nf:>9}{sz:>10}  {'OK' if not errs else 'FAIL ' + '; '.join(errs)}")
n3 = len(list(OUT.glob("*.3dm")))
print(f"parts {len(parts)}, files in folder {n3 - (OUT / COMBINED).exists()}, total {tot} bytes, failures {bad}")
if n3 - (OUT / COMBINED).exists() != len(parts): bad += 1; print("FAIL: file count != part count")
cpath = write_combined(parts)
cerrs, ci = check_combined(parts, cpath)
bad += bool(cerrs)
print(f"{COMBINED}: objects {ci[1]} (mesh {ci[0]} + labels {len(parts)}), faces {ci[2]}, bbox {ci[3][0]:.1f} x {ci[3][1]:.1f} x {ci[3][2]:.1f} mm, "
      f"{cpath.stat().st_size} bytes  {'OK' if not cerrs else 'FAIL ' + '; '.join(cerrs)}")
n3 = len(list(OUT.glob("*.3dm")))
print(f"files in folder: {n3} (expected {len(parts) + 1})")
if n3 != len(parts) + 1: bad += 1; print("FAIL: total file count")
sys.exit(1 if bad else 0)
