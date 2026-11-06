# LEGO Mindstorms EV3 parts - 3D models

37 EV3 parts (beams, angular beams, axles, pegs, gears, wheel, motors, sensors, P-Brick) as STL / OBJ+MTL files and as a
browser viewer with a small assembly editor (`viewer/viewer.html`, data in `viewer/models.js`): place parts, move/rotate
and vertex-snap them, import STL/OBJ, export the assembly as STL or OBJ+MTL, save/load it as JSON. Units mm, Z-up, one mesh
per colour.

## Run

    python -I build_models_ldraw.py

Pure standard library. The script reads the LDraw files from `ldraw_cache/` (only the 367 `.dat` files actually used, plus
`LDConfig.ldr`, `CAreadme.txt`, `CAlicense4.txt`), so the build is reproducible offline. To refresh the cache from a full
LDraw library use `--src <path to ldraw folder containing parts/ and p/>`; the cache is then rewritten.
It writes `models/<id>.stl|obj|mtl` and `viewer/models.js`, then runs a self-check and exits non-zero on failure.
`build_models.py` is the older hand-built parametric generator; it is still used for the steel ball (no LDraw part exists).

To view or build an assembly: `python -m http.server` inside `viewer/`, open `viewer.html` (see "Assembly editor").

## Assembly editor

Run `python -m http.server` inside `viewer/` and open `http://localhost:8000/viewer.html`. Opening `viewer.html` directly
(file://) also works: plain scripts, no modules, no network. Adding `?debug` to the URL exposes `window.EVEDBG`, a handle
for browser tests; without it the handle does not exist.

Modes (header): **Preview** shows one part (old behaviour); **Assembly** shows all placed parts on a 400 mm grid. In
Assembly mode "Reset view" and "Frame all" frame the whole assembly and "Wireframe" applies to all parts.

| Action | How |
|---|---|
| Add a part | select it in the sidebar, "Add to assembly" (placed 20 mm in +X past the existing parts; the first at the origin). With several parts marked in the sidebar (see Multi-select) all of them are added in one undo step |
| Select | click it in the Assembly list or in the 3D view; Up/Down step through the visible rows; Esc or a click on empty space deselects |
| Assembly list | one group per part (header = name and "×N", click it to select all its instances, the small caret collapses/expands); instances are listed below with their `#uid` |
| Multi-select | Ctrl+click toggles, Shift+click marks the range from the last clicked row (in the Assembly list a group header counts as its instances; rows inside a collapsed sidebar category are skipped). Ctrl+click on a part in the 3D view toggles it too. **Ctrl + left-drag** on the 3D view (Assembly mode, from anywhere, also from a part) draws a translucent rubber band; on release every instance whose projected bounding box touches the rectangle is ADDED to the marks (no occlusion test; nothing inside = nothing changes; Esc during the drag cancels; Orbit and the gizmo are off for that drag; a Ctrl+click under 4 px still toggles). Shift + left-drag still pans via the orbit controls. Selection is not an undo step. Marked rows are highlighted; Esc clears the marks. Exactly one marked: the gizmo uses the part's own axes. Two or more marked: one gizmo at the centroid of their bounding-box centres, in world axes; Move/Rotate (W/E) and the snap toggles work as usual and a drag moves or rotates (about that centroid) ALL marked instances as ONE undo step; the gizmo is hidden during vertex snap. Delete removes all marked instances (one undo step) |
| Move / rotate | gizmo on the selected part; "Move" (W) / "Rotate" (E) |
| Camera | left drag orbits, **middle button (wheel pressed) drag pans**, wheel zooms; the right button does nothing |
| Snap 15° / Snap 1 mm | toggles for rotation / translation snap (default off; keys A / Z). The gizmo works in the part's local axes, so the 1 mm steps are along the part's own axes |
| Snap vertex | "Snap vertex" or S (Assembly mode, at least 2 parts), see below |
| Delete | "Delete" or Del removes the selected (marked) parts |
| Undo / Redo | Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z (also the buttons; 100 steps) |

Snap vertex (translation only, the part keeps its rotation):
1. Press S (or the button). The gizmo is hidden, the cursor becomes a crosshair.
2. Click a vertex on the part to MOVE (A); a red marker shows the picked vertex.
3. Click a vertex on another part (B); a green marker appears and A is moved so its vertex lands on B's vertex (one undo step).

A click picks the nearest of the 3 vertices of the clicked triangle, not the nearest vertex of the whole part. Backspace
re-picks A, Esc (or S) cancels. A second click that hits nothing or only A shows "click a different part".

With 2 or more instances marked the whole marked set moves: A must be picked on a marked part and B on an unmarked one, and every marked instance is translated by the same A-to-B delta (one undo step). A needs at least one unmarked part as the target.

### Import

"Import parts…" in the sidebar accepts several files at once: STL (ASCII or binary) and OBJ, with an optional MTL matched to
the OBJ by basename (`gear.obj` + `gear.mtl`; MTL `Kd` gives the colour, default `#969696`). The scale field multiplies
the file coordinates to get mm; presets mm (1), cm (10), inch (25.4), m (1000). Limits per file: 50 MB and 500 000
triangles. OBJ polygons are fan-triangulated, so concave polygon faces come out wrong (triangulate them in the source
tool first). Imported parts keep the file origin (no re-centering), appear under "Imported" with id `user_<name>`, and are
removed with the × next to them (their placed instances are deleted too, after a confirm; undo brings both back).

Imported parts are remembered: they are stored in the browser's IndexedDB (database `eve3`, store `parts`) and restored on
the next start ("restored N imported parts" in the status line); removing one with × removes it from the store too, and
undo/redo keep the store in step. This also covers parts that arrive embedded in a loaded JSON file. The assembly itself is
not stored (use Save/Load JSON). If IndexedDB is unavailable (private mode, blocked storage, some `file://` setups) the
viewer silently falls back to session-only behaviour.

### Settings and shortcuts

The "Settings" button (header) lists every keyboard action with its shortcut. Click a shortcut, press the new combination
(Ctrl/Shift/Alt + key; Esc cancels), or use "Clear" / "Reset" per action and "Reset all". A combination already used by
another action is refused with the name of that action. Defaults: Move gizmo W, Rotate gizmo E, Snap vertex S, Delete Del,
Undo Ctrl+Z, Redo Ctrl+Y / Ctrl+Shift+Z, Deselect Esc, Snap 15° A, Snap 1 mm Z, Frame all F, Reset view R, Toggle wireframe X,
Toggle grid G, Toggle auto-rotate T (it was A in an earlier version: a saved auto-rotate = A override is ignored, the
Snap 15° default keeps A), Add to assembly Ctrl+Enter. Up/Down list stepping and Backspace (snap re-pick) are fixed and cannot be bound;
Esc always leaves snap mode. Shortcuts are ignored while typing in a field or while the dialog is open. The browser keeps
some combinations for itself (e.g. Ctrl+W, Ctrl+T, Ctrl+N), they cannot be captured. Shift+letter still triggers a plain
letter binding (as before) unless that Shift combination is bound itself. Bindings are saved in localStorage
(`eve3.keys`, only the changed actions); missing or corrupt data falls back to the defaults. Button tooltips show the
current shortcuts.

### Export

In Assembly mode: "Export STL" downloads `eve3_assembly.stl` (binary, one solid, per-face normals); "Export OBJ + MTL"
downloads `eve3_assembly.obj` (one `o <part>_<uid>` per placed part, `usemtl` per colour) and `eve3_assembly.mtl` as
two downloads, so the browser may ask to allow multiple downloads. Units mm, Z-up. Gizmo, grid and markers are never
exported.

### Save / load JSON

"Save JSON" downloads `eve3_assembly.json`:

    {"format": "eve3-assembly", "version": 1, "units": "mm",
     "instances": [{"part": "<part id>", "matrix": [16 numbers, column-major like three.js Matrix4.elements]}],
     "userParts": [{"id": "...", "name": "...", "category": "...",
                    "meshes": [{"color": "#rrggbb", "v": [x, y, z, ...], "f": [i, j, k, ...]}]}]}

Built-in parts are referenced by id; ALL imported parts in the library are embedded (also unused ones), so the file is
self-contained. `dims_mm` is not stored, it is recomputed on load. "Load JSON" (max 50 MB) validates format, version,
matrices (16 finite numbers, invertible) and embedded meshes (finite numbers, face indices in range; bad colours become
`#969696`), then REPLACES the current assembly (a confirm is asked when the assembly is not empty or the file brings parts). Embedded parts are merged into the library by id:
- same id and identical mesh data as a part already there: the existing part is reused;
- same id but different geometry: added under a suffixed id (`<id>_2`, ...) and the loaded instances use it (a note
  names the rename);
- new id: added to the library.

Instances with an unknown part id are skipped and reported. The whole load is one undo step.

### Tests

    node viewer/test_io.js

Unit tests for `viewer/io.js` (parsers, export, JSON, keyboard bindings); prints `ALL TESTS PASSED (49 tests)` and exits 0.

### Smoke checklist (manual, 2 minutes)

- [ ] Assembly mode, add 3 parts (e.g. two beams and a motor): all visible, listed in the Assembly panel
- [ ] Select a part in the list and by clicking it in 3D; Esc deselects
- [ ] Move a part (W) and rotate it (E) with the gizmo; orbiting still works when not on the gizmo
- [ ] Snap vertex (S): click a vertex on beam A, then on beam B; A jumps onto B
- [ ] Ctrl+Z undoes the snap and the moves, Ctrl+Y redoes them
- [ ] Delete a part, undo brings it back
- [ ] Import a STL and an OBJ(+MTL): they appear under "Imported", preview, can be added and moved
- [ ] Remove an imported part with ×, confirm; undo brings back the part and its instances
- [ ] Reload the page: imported parts are restored (status "restored N imported parts"); remove one, reload: it stays gone
- [ ] Add two parts of the same kind plus a third: the Assembly list shows "×2" and "×1" groups; the caret collapses a group
- [ ] Ctrl+click / Shift+click in both lists and Ctrl+click in 3D mark several items; Delete removes all marked, Ctrl+Z restores them; Esc clears
- [ ] Assembly mode, 3 parts: Ctrl+drag a rectangle over two of them (rubber band visible, status shows "Box select: 2 added"), a second rectangle adds to the marks, Esc during a drag cancels, plain drag still orbits
- [ ] Mark two parts: one gizmo at their centre; drag it (Move, then Rotate): both move/rotate together, the unmarked part stays, one Ctrl+Z restores both, Ctrl+Y redoes
- [ ] Snap vertex (S) with two marked: vertex on a marked part, then on an unmarked part: both marked parts move by the same delta
- [ ] Keys A / Z toggle Snap 15° / Snap 1 mm, T toggles auto-rotate
- [ ] Sidebar: mark several parts, "Add to assembly" adds all of them (one Ctrl+Z removes all)
- [ ] Settings: rebind a key, conflict is refused, reload keeps the binding, "Reset all" restores the defaults
- [ ] Middle-button drag pans, right-button drag does nothing, wheel zooms, left drag orbits
- [ ] Export STL and Export OBJ + MTL; open both in another tool (e.g. Rhino, MeshLab): positions match the viewer
- [ ] Save JSON, reload the page, Load JSON: same parts at the same positions, imported parts restored
- [ ] No errors in the browser console

### Known limits

- No peg/hole or axle connection detection; parts are joined only by the translation-only vertex snap.
- No scaling or mirroring of placed parts.
- Removed imported parts are kept in memory for the session only (for undo); they are dropped from the persistent store and not saved to JSON.

## Part mapping (id -> LDraw file)

| id | LDraw file | description |
|---|---|---|
| beam_3m..beam_15m | 32523, 32316, 32524, 40490, 32525, 41239, 32278 | Technic Beam 3,5,7,9,11,13,15 |
| ang_3x5_90 | 32526 | Technic Beam 3 x 5 Bent 90 |
| ang_4x2_90 | 32140 | Technic Beam 2 x 4 Liftarm Bent 90 |
| ang_4x4_53 | 32348 | Technic Beam 4 x 4 Liftarm Bent 53.13 |
| ang_4x6_53 | 6629 | Technic Beam 4 x 6 Liftarm Bent 53.13 |
| axle_3m..axle_12m | 4519, 3705, 32073, 3706, 44294, 3707, 3737, 3708 | Technic Axle 3,4,5,6,7,8,10,12 |
| peg_friction_2m | 2780 | Technic Pin with Friction and Slots |
| peg_3m | 32556a | Technic Pin Long without Friction with Single Slot |
| peg_friction_3m | 6558 | Technic Pin Long with Friction and Slot |
| conn_peg_axle | 43093 | Technic Axle Pin with Friction |
| bush_cross_1m | 3713 | Technic Bush with Two Flanges |
| gear_z8, z16, z24, z40 | 3647, 4019, 3648b, 3649 | Technic Gear 8, 16, 24, 40 Tooth |
| wheel_56x28 | 56908 + 41897 | Wheel Rim 26 x 43 (6 pegholes) + Tyre 28/ 23 x 43 ZR Street (56 x 28) |
| steel_ball | (none) | parametric sphere, 16 mm (marked approx) |
| large_motor | 95658 | Electric Mindstorms EV3 Large Motor |
| medium_motor | 99455 | Electric Mindstorms EV3 Medium Motor |
| sensor_gyro / touch / color / ultrasonic | 99380 / 95648 / 95650 / 95652 | EV3 Gyroscopic / Touch / Colour / Ultrasonic Sensor |
| pbrick | 95646 | Electric Mindstorms EV3 (intelligent brick) |

Notes: LDraw beams are 0.8 mm shorter than n x 8 mm (real part tolerance), axles 0.4 mm shorter. Colours come from the
LDraw colour table. Beams, axles and pegs have their length along X; gears and wheel have their axis along Z; motors,
sensors and brick keep the upright LDraw pose with the longest side along X.

## Rhino export

    python -I export_3dm.py [outdir]

Needs `rhino3dm` (`pip install rhino3dm`; with the SOCKS system proxy use `$env:NO_PROXY='*'`). Reads `viewer/models.js`
(run `build_models_ldraw.py` first) and writes one `<id>.3dm` per part (Rhino 7 file format, mm, Z-up, bbox centred on XY,
zmin = 0) to `F:\____IL_CPP\STM32F429I-DISCO\model3d\EVE3\` (or `outdir`). Layers: parent = part name, one child per colour
(layer colour = group colour); one mesh object per colour group, coloured by object. Source, category and approx flag are
stored as document and object user strings. Every file is read back and checked (object/face counts, units, bbox vs
`dims_mm`); exit code is non-zero on any failure.
The same run also writes `EVE3_all_parts.3dm`: all parts on the XY plane in rows by category (Beams, Angular beams, Axles, Pegs & bushes, Gears, Wheels, Motors, Sensors, Brick, Misc; 15 mm between parts, 40 mm between rows, rows wrap at about 600 mm), one layer per category and part, plus a `Labels` layer with a TextDot per part.

## Attribution

Geometry is taken from the LDraw Parts Library (https://www.ldraw.org), licensed under CC BY 4.0 (see
`ldraw_cache/CAreadme.txt` and `ldraw_cache/CAlicense4.txt`). The original EV3 shapes were designed by the LEGO
MINDSTORMS Team; the LDraw files were prepared by Philippe Hurbain (Philo) and the LDraw community.

`viewer/TransformControls.js` and `viewer/OrbitControls.js` are from the three.js r128 examples (`examples/js/controls/`,
MIT license, https://threejs.org).

LEGO and MINDSTORMS are trademarks of the LEGO Group, which does not sponsor, authorize or endorse this project.
This is not an official LEGO product.
