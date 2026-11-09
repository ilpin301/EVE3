// Unit tests for viewer/io.js. Run: node viewer/test_io.js  (or: node test_io.js inside viewer/)
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var IO = require(path.join(__dirname, 'io.js'));

// ---------------------------------------------------------------- test data

// Box 10 x 20 x 30, 8 corners, 6 outward quads.
var CORNERS = [[0, 0, 0], [10, 0, 0], [10, 20, 0], [0, 20, 0], [0, 0, 30], [10, 0, 30], [10, 20, 30], [0, 20, 30]];
var QUADS = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];

function boxTris(off) {
  off = off || [0, 0, 0];
  var p = CORNERS.map(function (c) { return [c[0] + off[0], c[1] + off[1], c[2] + off[2]]; });
  var tris = [];
  QUADS.forEach(function (q) { tris.push([p[q[0]], p[q[1]], p[q[2]]], [p[q[0]], p[q[2]], p[q[3]]]); });
  return tris;
}

function asciiSTL(tris, eol, upper) {
  eol = eol || '\n';
  var s = ['solid box'];
  tris.forEach(function (t) {
    s.push(' facet normal 0 0 0', '  outer loop');
    t.forEach(function (v) { s.push('   vertex ' + v.join(' ')); });
    s.push('  endloop', ' endfacet');
  });
  s.push('endsolid box');
  var txt = s.join(eol) + eol;
  return upper ? txt.toUpperCase() : txt;
}

function binarySTL(tris, header, extra) {
  var b = Buffer.alloc(84 + 50 * tris.length + (extra || 0));
  b.write(header || 'binary box', 0, 'latin1');
  b.writeUInt32LE(tris.length, 80);
  tris.forEach(function (t, i) {
    var o = 84 + 50 * i + 12;
    t.forEach(function (v, j) { for (var k = 0; k < 3; k++) b.writeFloatLE(v[k], o + 12 * j + 4 * k); });
  });
  return b;
}

function objVerts(off) {
  off = off || [0, 0, 0];
  return CORNERS.map(function (c) { return 'v ' + (c[0] + off[0]) + ' ' + (c[1] + off[1]) + ' ' + (c[2] + off[2]); });
}
function objQuads(base) {
  return QUADS.map(function (q) { return 'f ' + q.map(function (i) { return i + 1 + base; }).join(' '); });
}

// ---------------------------------------------------------------- helpers

function checkMesh(m) {
  assert.ok(/^#[0-9a-f]{6}$/.test(m.color), 'colour ' + m.color);
  assert.strictEqual(m.v.length % 3, 0);
  assert.strictEqual(m.f.length % 3, 0);
  var nv = m.v.length / 3;
  m.f.forEach(function (i) { assert.ok(Number.isInteger(i) && i >= 0 && i < nv, 'bad index ' + i); });
  // every vertex is used by the mesh
  var used = new Set(m.f);
  assert.strictEqual(used.size, nv, 'mesh has unused vertices');
}
function tris(r) { return r.meshes.reduce(function (s, m) { return s + m.f.length / 3; }, 0); }
function verts(r) { return r.meshes.reduce(function (s, m) { return s + m.v.length / 3; }, 0); }
function checkBox(r) {
  r.meshes.forEach(checkMesh);
  assert.strictEqual(tris(r), 12, 'triangles');
  assert.strictEqual(verts(r), 8, 'welded vertices');
  assert.deepStrictEqual(r.dims_mm, [10, 20, 30]);
}

// ---------------------------------------------------------------- tests

var tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('exports and limits', function () {
  assert.deepStrictEqual(IO.LIMITS, { maxBytes: 50 * 1024 * 1024, maxTriangles: 500000 });
  ['parseSTL', 'parseOBJ', 'finishPart', 'bakeAssembly', 'toSTLBinary', 'toOBJ', 'toMTL', 'serializeAssembly', 'parseAssemblyJSON', 'meshesEqual'].forEach(function (k) { assert.strictEqual(typeof IO[k], 'function'); });
  var src = fs.readFileSync(path.join(__dirname, 'io.js'), 'utf8');
  assert.ok(!/\bTHREE\.|\bdocument\.|\bwindow\.(?!EVEIO)/.test(src), 'io.js must not reference THREE or document');
});

test('ASCII STL box', function () {
  var r = IO.parseSTL(Buffer.from(asciiSTL(boxTris())));
  checkBox(r);
  assert.strictEqual(r.meshes.length, 1);
  assert.strictEqual(r.meshes[0].color, '#969696');
  assert.deepStrictEqual(r.warnings, []);
});

test('ASCII STL with BOM and CRLF', function () {
  checkBox(IO.parseSTL(Buffer.from('﻿' + asciiSTL(boxTris(), '\r\n'), 'utf8')));
});

test('ASCII STL uppercase keywords, tabs, scientific notation', function () {
  var t = asciiSTL(boxTris(), '\n', true).replace(/ 10\b/g, '\t1.0E+01').replace(/ 30\b/g, '  3e1');
  checkBox(IO.parseSTL(Buffer.from(t)));
});

test('ASCII STL not misread as binary (exact-length collision checked for feasibility)', function () {
  // Bytes 80-83 of an ASCII file are text (>= 0x09 each), so n >= 0x09090909 and 84+50*n is > 7 GB:
  // an ASCII file of exactly that length cannot be built here. We verify that bound and that parsing stays ASCII.
  var b = Buffer.from(asciiSTL(boxTris()));
  var n = b.readUInt32LE(80);
  assert.ok(n >= 0x09090909 && 84 + 50 * n > IO.LIMITS.maxBytes, 'n=' + n);
  var r = IO.parseSTL(b);
  checkBox(r);
  assert.deepStrictEqual(r.warnings, []);
});

test('binary STL box (Buffer, ArrayBuffer, offset Uint8Array)', function () {
  var b = binarySTL(boxTris());
  checkBox(IO.parseSTL(b));
  var ab = new ArrayBuffer(b.length);
  new Uint8Array(ab).set(b);
  checkBox(IO.parseSTL(ab));
  var big = new Uint8Array(b.length + 7);
  big.set(b, 5);
  checkBox(IO.parseSTL(big.subarray(5, 5 + b.length)));
});

test('binary STL whose header starts with "solid ... facet" is binary', function () {
  var r = IO.parseSTL(binarySTL(boxTris(), 'solid exported by CAD facet normals'));
  checkBox(r);
  assert.deepStrictEqual(r.warnings, []);
});

test('binary STL with trailing bytes parses with warning', function () {
  var r = IO.parseSTL(binarySTL(boxTris(), 'plain header', 17));
  checkBox(r);
  assert.ok(r.warnings.some(function (w) { return /17 trailing bytes/.test(w); }), r.warnings.join('|'));
});

test('binary STL "solid ... facet" header + trailing bytes: ASCII fails, retried as binary', function () {
  var r = IO.parseSTL(binarySTL(boxTris(), 'solid facet', 4));
  checkBox(r);
  assert.ok(r.warnings.some(function (w) { return /read as binary/.test(w); }), r.warnings.join('|'));
  assert.ok(r.warnings.some(function (w) { return /trailing/.test(w); }), r.warnings.join('|'));
});

test('binary STL truncated throws', function () {
  var b = binarySTL(boxTris());
  assert.throws(function () { IO.parseSTL(b.subarray(0, b.length - 10)); }, /STL: .*truncated/);
  var s = binarySTL(boxTris(), 'solid facet');
  assert.throws(function () { IO.parseSTL(s.subarray(0, s.length - 10)); }, /truncated/);
});

test('garbage, empty and tiny STL throw', function () {
  var g = Buffer.alloc(200);
  for (var i = 0; i < g.length; i++) g[i] = (i * 73 + 41) & 255;
  g.writeUInt32LE(0xFFFFFFF0, 80);
  assert.throws(function () { IO.parseSTL(g); }, /STL: not a valid STL/);
  assert.throws(function () { IO.parseSTL(new ArrayBuffer(0)); }, /STL: file is empty/);
  assert.throws(function () { IO.parseSTL(Buffer.from('hello world')); }, /too short/);
  assert.throws(function () { IO.parseSTL(Buffer.from('solid x\nfacet\nendsolid')); }, /no "vertex x y z"/);
  assert.throws(function () { IO.parseSTL('not a buffer'); }, /expected an ArrayBuffer/);
  assert.throws(function () { IO.parseSTL(binarySTL([])); }, /STL: no triangles/);
});

test('ASCII STL with NaN vertex throws', function () {
  var t = asciiSTL(boxTris()).replace('vertex 0 0 0', 'vertex nan 0 0');
  assert.throws(function () { IO.parseSTL(Buffer.from(t)); }, /not a finite number/);
});

test('STL triangle limit (opts.maxTriangles)', function () {
  assert.throws(function () { IO.parseSTL(Buffer.from(asciiSTL(boxTris())), { maxTriangles: 11 }); }, /too many triangles \(12, limit 11\)/);
  assert.throws(function () { IO.parseSTL(binarySTL(boxTris()), { maxTriangles: 11 }); }, /too many triangles/);
  checkBox(IO.parseSTL(binarySTL(boxTris()), { maxTriangles: 12 }));
});

test('STL degenerate triangle dropped, near vertices welded', function () {
  var t = boxTris();
  t.push([[0, 0, 0], [0, 0, 0.00001], [10, 0, 0]]); // collapses after welding
  t = t.map(function (tri, i) {
    return tri.map(function (v) { return v.map(function (x) { return x + (i % 2 ? 3e-5 : -3e-5); }); });
  });
  var r = IO.parseSTL(Buffer.from(asciiSTL(t)));
  r.meshes.forEach(checkMesh);
  assert.strictEqual(tris(r), 12);
  assert.strictEqual(verts(r), 8);
  assert.ok(r.warnings.some(function (w) { return /dropped 1 degenerate/.test(w); }), r.warnings.join('|'));
});

test('OBJ quads (with BOM): 6 quads -> 12 triangles', function () {
  var o = '﻿# box\nmtllib box.mtl\no box\ng g1\ns off\n' + objVerts().join('\n') + '\n' + objQuads(0).join('\n') + '\n';
  var r = IO.parseOBJ(o);
  checkBox(r);
  assert.strictEqual(r.meshes[0].color, '#969696');
});

test('OBJ negative indices', function () {
  var f = QUADS.map(function (q) { return 'f ' + q.map(function (i) { return i - 8; }).join(' '); });
  checkBox(IO.parseOBJ(objVerts().join('\n') + '\n' + f.join('\n')));
});

test('OBJ v/vt/vn, v//vn tokens and extra vertex columns', function () {
  var v = objVerts().map(function (l, i) { return l + (i % 2 ? ' 1.0' : ' 0.5 0.5 0.5'); });
  var f = QUADS.map(function (q, k) {
    return 'f ' + q.map(function (i) { return k % 2 ? (i + 1) + '/1/1' : (i + 1) + '//1'; }).join(' ');
  });
  checkBox(IO.parseOBJ(v.concat(['vt 0 0', 'vn 0 0 1'], f).join('\r\n')));
});

test('OBJ + MTL: red and unknown material -> 2 meshes', function () {
  var mtl = '﻿newmtl red\nKd 1 0 0\nnewmtl blue\nKd 0 0 1\n';
  var q = objQuads(0);
  var o = objVerts().concat(['usemtl red'], q.slice(0, 1), ['usemtl ghost'], q.slice(1)).join('\n');
  var r = IO.parseOBJ(o, mtl);
  assert.strictEqual(r.meshes.length, 2);
  r.meshes.forEach(checkMesh);
  var red = r.meshes.filter(function (m) { return m.color === '#ff0000'; })[0];
  var grey = r.meshes.filter(function (m) { return m.color === '#969696'; })[0];
  assert.ok(red && grey, r.meshes.map(function (m) { return m.color; }).join(','));
  assert.strictEqual(red.f.length / 3, 2);
  assert.strictEqual(grey.f.length / 3, 10);
  assert.strictEqual(red.v.length / 3, 4, 'per-mesh re-indexing (bottom quad only)');
  assert.strictEqual(grey.v.length / 3, 8);
  assert.deepStrictEqual(r.dims_mm, [10, 20, 30]);
  assert.ok(r.warnings.some(function (w) { return /"ghost" not found in MTL/.test(w); }), r.warnings.join('|'));
  // no MTL given at all: one default-coloured mesh plus a warning
  var r2 = IO.parseOBJ(o);
  assert.strictEqual(r2.meshes.length, 1);
  assert.ok(r2.warnings.length === 2, r2.warnings.join('|'));
});

test('two cubes sharing no vertices -> 16 welded vertices', function () {
  var o = objVerts().concat(objVerts([100, 0, 0]), objQuads(0), objQuads(8)).join('\n');
  var r = IO.parseOBJ(o);
  r.meshes.forEach(checkMesh);
  assert.strictEqual(verts(r), 16);
  assert.strictEqual(tris(r), 24);
  assert.deepStrictEqual(r.dims_mm, [110, 20, 30]);
  // duplicated vertex lines at the same position still weld
  var d = IO.parseOBJ(objVerts().concat(objVerts(), objQuads(0), objQuads(8)).join('\n'));
  assert.strictEqual(verts(d), 8);
});

test('OBJ errors: NaN, Infinity, index out of range, short face, bad token', function () {
  var base = objVerts();
  assert.throws(function () { IO.parseOBJ(base.concat(['v nan 0 0'], objQuads(0)).join('\n')); }, /OBJ line 9: vertex coordinate 'nan' is not a finite number/);
  assert.throws(function () { IO.parseOBJ(base.concat(['v Infinity 0 0']).join('\n')); }, /not a finite number/);
  assert.throws(function () { IO.parseOBJ(base.concat(['v 1 2']).join('\n')); }, /needs 3 coordinates/);
  assert.throws(function () { IO.parseOBJ(base.concat(['f 1 2 12']).join('\n')); }, /face references vertex 12 but only 8 vertices exist/);
  assert.throws(function () { IO.parseOBJ(base.concat(['f -1 -2 -9']).join('\n')); }, /vertex -9 but only 8/);
  assert.throws(function () { IO.parseOBJ(base.concat(['f 0 1 2']).join('\n')); }, /vertex 0 /);
  assert.throws(function () { IO.parseOBJ(base.concat(['f 1 2']).join('\n')); }, /face has 2 vertices \(need at least 3\)/);
  assert.throws(function () { IO.parseOBJ(base.concat(['f 1 2 x/1']).join('\n')); }, /invalid face vertex/);
  assert.throws(function () { IO.parseOBJ(base.join('\n')); }, /OBJ: no triangles/);
  assert.throws(function () { IO.parseOBJ(new ArrayBuffer(4)); }, /expected the file content as text/);
});

test('OBJ triangle limit (opts.maxTriangles)', function () {
  var o = objVerts().concat(objQuads(0)).join('\n');
  assert.throws(function () { IO.parseOBJ(o, null, { maxTriangles: 11 }); }, /OBJ: too many triangles/);
  checkBox(IO.parseOBJ(o, null, { maxTriangles: 12 }));
});

test('finishPart recomputes dims, sets flags, normalises colour', function () {
  var r = IO.parseOBJ(objVerts().concat(objQuads(0)).join('\n'));
  var p = { id: 'user_box', name: 'Box', category: 'Imported', dims_mm: [1, 1, 1], approx: true, meshes: r.meshes };
  p.meshes[0].color = 'red';
  var out = IO.finishPart(p);
  assert.strictEqual(out, p);
  assert.deepStrictEqual(p.dims_mm, [10, 20, 30]);
  assert.strictEqual(p.approx, false);
  assert.strictEqual(p.user, true);
  assert.strictEqual(p.meshes[0].color, '#969696');
  var q = IO.finishPart({ id: 'c', meshes: [{ color: '#AbC123', v: [0, 0, 0, 1, 2, 3, 4, 0, 0], f: [0, 1, 2] }] });
  assert.strictEqual(q.meshes[0].color, '#AbC123');
  assert.deepStrictEqual(q.dims_mm, [4, 2, 3]);
});

test('finishPart rejects bad input', function () {
  function part(m) { return { id: 'x', meshes: [m] }; }
  var good = function () { return { color: '#ff0000', v: [0, 0, 0, 1, 0, 0, 0, 1, 0], f: [0, 1, 2] }; };
  var m;
  assert.throws(function () { IO.finishPart(null); }, /expected a part object/);
  assert.throws(function () { IO.finishPart({ id: 'x', meshes: [] }); }, /meshes must be a non-empty array/);
  m = good(); m.v[4] = NaN;
  assert.throws(function () { IO.finishPart(part(m)); }, /part "x" mesh 0: v\[4\] is not a finite number/);
  m = good(); m.v[0] = Infinity;
  assert.throws(function () { IO.finishPart(part(m)); }, /not a finite number/);
  m = good(); m.v.push(1);
  assert.throws(function () { IO.finishPart(part(m)); }, /multiple of 3/);
  m = good(); m.f[2] = 3;
  assert.throws(function () { IO.finishPart(part(m)); }, /f\[2\] = 3 is not a valid vertex index \(mesh has 3 vertices\)/);
  m = good(); m.f[0] = -1;
  assert.throws(function () { IO.finishPart(part(m)); }, /not a valid vertex index/);
  m = good(); m.f[1] = 0.5;
  assert.throws(function () { IO.finishPart(part(m)); }, /not a valid vertex index/);
  m = good(); m.f.pop();
  assert.throws(function () { IO.finishPart(part(m)); }, /f must be an array/);
  assert.throws(function () { IO.finishPart(part({ color: '#ff0000', v: [], f: [] })); }, /has no vertices/);
});

test('round trip: binary and ASCII STL of the same box agree', function () {
  var a = IO.parseSTL(Buffer.from(asciiSTL(boxTris([5, -3, 2]))));
  var b = IO.parseSTL(binarySTL(boxTris([5, -3, 2])));
  assert.deepStrictEqual(a.dims_mm, b.dims_mm);
  assert.deepStrictEqual(a.dims_mm, [10, 20, 30]);
  assert.strictEqual(tris(a), tris(b));
  assert.strictEqual(verts(a), verts(b));
  assert.deepStrictEqual(a.meshes[0].f, b.meshes[0].f);
});

// ---------------------------------------------------------------- export (step 5)

// Box as one indexed mesh: 8 corners, 12 outward triangles.
function boxMesh(color) {
  var f = [];
  QUADS.forEach(function (q) { f.push(q[0], q[1], q[2], q[0], q[2], q[3]); });
  return { color: color || '#ff0000', v: [].concat.apply([], CORNERS), f: f };
}
function translation(x, y, z) { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]; }
var ROT_Z90 = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 50, 0, 0, 1]; // column-major: x' = -y + 50, y' = x
var MIRROR_X = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function triNormal(v, f, t) {
  var a = 3 * f[t], b = 3 * f[t + 1], c = 3 * f[t + 2];
  var u = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]], w = [v[c] - v[a], v[c + 1] - v[a + 1], v[c + 2] - v[a + 2]];
  var n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  var l = Math.hypot(n[0], n[1], n[2]);
  return [n[0] / l, n[1] / l, n[2] / l];
}
function vert(m, i) { return [m.v[3 * i], m.v[3 * i + 1], m.v[3 * i + 2]]; }
function near(a, b, eps) { a.forEach(function (x, i) { assert.ok(Math.abs(x - b[i]) <= (eps || 1e-9), a + ' vs ' + b); }); }
// every triangle normal points away from the mesh centre (box is convex)
function checkOutward(m) {
  var c = [0, 0, 0], nv = m.v.length / 3;
  for (var i = 0; i < nv; i++) for (var k = 0; k < 3; k++) c[k] += m.v[3 * i + k] / nv;
  for (var t = 0; t < m.f.length; t += 3) {
    var n = triNormal(m.v, m.f, t), p = vert(m, m.f[t]);
    var d = n[0] * (p[0] - c[0]) + n[1] * (p[1] - c[1]) + n[2] * (p[2] - c[2]);
    assert.ok(d > 0, 'triangle ' + t / 3 + ' points inward');
  }
}
function bbox(meshesList) {
  var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  meshesList.forEach(function (m) { for (var i = 0; i < m.v.length; i++) { lo[i % 3] = Math.min(lo[i % 3], m.v[i]); hi[i % 3] = Math.max(hi[i % 3], m.v[i]); } });
  return lo.concat(hi);
}
function bakedMeshes(b) { return [].concat.apply([], b.items.map(function (it) { return it.meshes; })); }
function sampleRecords() {
  return [
    { name: 'Beam 5', uid: 1, meshes: [boxMesh('#ff0000')], matrix: translation(100, 0, 0) },
    { name: 'Gear z/8', uid: 2, meshes: [boxMesh('#00FF00'), boxMesh('#ff0000')], matrix: ROT_Z90 }
  ];
}

test('bakeAssembly: translated cube, inputs not mutated', function () {
  var rec = { name: 'b', uid: 7, meshes: [boxMesh()], matrix: translation(100, -5, 2) };
  var copy = JSON.parse(JSON.stringify(rec));
  var b = IO.bakeAssembly([rec]);
  assert.deepStrictEqual(rec, copy, 'input mutated');
  assert.deepStrictEqual(b.warnings, []);
  assert.strictEqual(b.items.length, 1);
  assert.strictEqual(b.items[0].uid, 7);
  var m = b.items[0].meshes[0];
  assert.deepStrictEqual(m.f, rec.meshes[0].f);
  near(vert(m, 0), [100, -5, 2]);
  near(vert(m, 6), [110, 15, 32]);
  checkOutward(m);
});

test('bakeAssembly: rotated 90 deg about Z keeps vertices and winding right', function () {
  var src = boxMesh(), b = IO.bakeAssembly([{ name: 'r', uid: 1, meshes: [src], matrix: ROT_Z90 }]);
  var m = b.items[0].meshes[0];
  assert.deepStrictEqual(b.warnings, []);
  near(vert(m, 1), [50, 10, 0]);  // (10,0,0)
  near(vert(m, 3), [30, 0, 0]);   // (0,20,0)
  near(vert(m, 6), [30, 10, 30]); // (10,20,30)
  for (var t = 0; t < src.f.length; t += 3) {
    var n0 = triNormal(src.v, src.f, t);
    near(triNormal(m.v, m.f, t), [-n0[1], n0[0], n0[2]], 1e-12);
  }
  checkOutward(m);
});

test('bakeAssembly: mirrored matrix flips winding and warns', function () {
  var src = boxMesh(), b = IO.bakeAssembly([{ name: 'm', uid: 3, meshes: [src], matrix: MIRROR_X }]);
  var m = b.items[0].meshes[0];
  assert.ok(b.warnings.length === 1 && /m #3 is mirrored/.test(b.warnings[0]), b.warnings.join('|'));
  near(vert(m, 1), [-10, 0, 0]);
  assert.deepStrictEqual(m.f.slice(0, 3), [src.f[0], src.f[2], src.f[1]]);
  checkOutward(m);
});

test('bakeAssembly: bad matrix throws', function () {
  function rec(mx) { return [{ name: 'x', uid: 1, meshes: [boxMesh()], matrix: mx }]; }
  var nan = translation(0, 0, 0); nan[5] = NaN;
  assert.throws(function () { IO.bakeAssembly(rec(nan)); }, /record 0 \("x"\): matrix\[5\] is not a finite number/);
  var inf = translation(0, 0, 0); inf[12] = Infinity;
  assert.throws(function () { IO.bakeAssembly(rec(inf)); }, /matrix\[12\] is not a finite/);
  assert.throws(function () { IO.bakeAssembly(rec([1, 0, 0])); }, /matrix must have 16 numbers/);
  assert.throws(function () { IO.bakeAssembly(rec(undefined)); }, /matrix must have 16 numbers/);
  assert.throws(function () { IO.bakeAssembly('nope'); }, /expected an array/);
});

test('toSTLBinary: size, header, count, round trip through parseSTL', function () {
  var b = IO.bakeAssembly(sampleRecords()), n = IO.countTris(b);
  assert.strictEqual(n, 36);
  var u8 = IO.toSTLBinary(b);
  assert.ok(u8 instanceof Uint8Array);
  assert.strictEqual(u8.length, 84 + 50 * n);
  var head = Buffer.from(u8.subarray(0, 80)).toString('latin1');
  assert.ok(!/^\s*solid/i.test(head), head);
  assert.ok(/^EVE3 assembly export/.test(head));
  var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  assert.strictEqual(dv.getUint32(80, true), n);
  // first triangle's stored normal matches the computed (outward, -Z) one
  near([dv.getFloat32(84, true), dv.getFloat32(88, true), dv.getFloat32(92, true)], [0, 0, -1], 1e-6);
  assert.strictEqual(dv.getUint16(84 + 48, true), 0);
  var r = IO.parseSTL(u8);
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(tris(r), n);
  near(bbox(r.meshes), bbox(bakedMeshes(b)), 1e-4);
  near(bbox(r.meshes), [30, 0, 0, 110, 20, 30], 1e-4);
});

test('toSTLBinary: empty assembly throws', function () {
  assert.throws(function () { IO.toSTLBinary(IO.bakeAssembly([])); }, /STL export: no triangles/);
  assert.throws(function () { IO.toSTLBinary(IO.bakeAssembly([{ name: 'e', uid: 1, meshes: [], matrix: translation(0, 0, 0) }])); }, /no triangles/);
});

test('toOBJ + toMTL: structure, 1-based global indices, round trip through parseOBJ', function () {
  var b = IO.bakeAssembly(sampleRecords());
  b.items[0].meshes[0].v[0] = 1 / 3; b.items[0].meshes[0].v[1] = 1e-9; // number formatting
  var obj = IO.toOBJ(b, { mtlName: 'eve3_assembly.mtl' }), mtl = IO.toMTL(b);
  var lines = obj.split('\n');
  assert.ok(/^#/.test(lines[0]));
  assert.strictEqual(lines[1], 'mtllib eve3_assembly.mtl');
  assert.ok(obj.indexOf('\r') < 0);
  assert.deepStrictEqual(lines.filter(function (l) { return /^o /.test(l); }), ['o Beam_5_1', 'o Gear_z_8_2']);
  assert.deepStrictEqual(lines.filter(function (l) { return /^usemtl /.test(l); }), ['usemtl c_ff0000', 'usemtl c_00ff00', 'usemtl c_ff0000']);
  assert.strictEqual(lines.filter(function (l) { return /^v /.test(l); })[0], 'v 0.333333 0 0');
  assert.ok(!/e[-+]?\d/i.test(lines.filter(function (l) { return /^v /.test(l); }).join('\n')), 'exponent in v line');
  var nv = lines.filter(function (l) { return /^v /.test(l); }).length, fl = lines.filter(function (l) { return /^f /.test(l); });
  assert.strictEqual(nv, 24);
  assert.strictEqual(fl.length, 36);
  var maxIdx = 0;
  fl.forEach(function (l) {
    l.split(' ').slice(1).forEach(function (s) { var i = Number(s); assert.ok(Number.isInteger(i) && i >= 1 && i <= nv, l); maxIdx = Math.max(maxIdx, i); });
  });
  assert.strictEqual(maxIdx, nv, 'global numbering reaches the last vertex');
  // MTL: one newmtl per distinct colour, first-use order
  var mt = mtl.split('\n');
  assert.deepStrictEqual(mt.filter(function (l) { return /^newmtl /.test(l); }), ['newmtl c_ff0000', 'newmtl c_00ff00']);
  assert.ok(mt.indexOf('Kd 1.0000 0.0000 0.0000') >= 0 && mt.indexOf('Kd 0.0000 1.0000 0.0000') >= 0, mtl);
  ['Ka 0 0 0', 'Ks 0 0 0', 'd 1'].forEach(function (l) { assert.strictEqual(mt.filter(function (x) { return x === l; }).length, 2, l); });
  b.items[0].meshes[0].v[0] = 0; b.items[0].meshes[0].v[1] = 0;
  var r = IO.parseOBJ(IO.toOBJ(b, { mtlName: 'eve3_assembly.mtl' }), IO.toMTL(b));
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(tris(r), 36);
  near(bbox(r.meshes), bbox(bakedMeshes(b)), 1e-6);
  assert.deepStrictEqual(r.meshes.map(function (m) { return m.color; }).sort(), ['#00ff00', '#ff0000']);
  var red = r.meshes.filter(function (m) { return m.color === '#ff0000'; })[0];
  assert.strictEqual(red.f.length / 3, 24);
});

test('toMTL: grey colour survives round trip', function () {
  var b = IO.bakeAssembly([{ name: 'g', uid: 1, meshes: [boxMesh('#969696'), boxMesh('#1a2B3c')], matrix: translation(0, 0, 0) }]);
  var r = IO.parseOBJ(IO.toOBJ(b), IO.toMTL(b));
  assert.deepStrictEqual(r.meshes.map(function (m) { return m.color; }), ['#969696', '#1a2b3c']);
  assert.ok(IO.toOBJ(b).split('\n')[1] === 'mtllib eve3_assembly.mtl');
});

// ---------------------------------------------------------------- assembly JSON (step 6)

function userBox(id, color) { return IO.finishPart({ id: id, name: 'Box ' + id, category: 'Imported', meshes: [boxMesh(color)] }); }
var KNOWN = ['beam5', 'gear8'];
// valid file text; fields of `over` replace the defaults
function asmText(over) {
  var d = { format: 'eve3-assembly', version: 1, units: 'mm', instances: [{ part: 'beam5', matrix: translation(1, 2, 3) }], userParts: [] };
  Object.keys(over || {}).forEach(function (k) { d[k] = over[k]; });
  return JSON.stringify(d);
}
function rawPart(id, mesh) { return { id: id, name: id, category: 'Imported', meshes: [mesh] }; }
function tri(color, f) { return { color: color, v: [0, 0, 0, 1, 0, 0, 0, 1, 0], f: f || [0, 1, 2] }; }

test('assembly JSON: round trip keeps instances, matrices and user parts; dims recomputed', function () {
  var ub = userBox('user_box', '#00ff00'), spare = userBox('user_spare', '#0000ff');
  var recs = [{ part: 'beam5', matrix: translation(10, -2.5, 1 / 3) }, { part: 'user_box', matrix: ROT_Z90 }];
  var s = IO.serializeAssembly(recs, [ub, spare]);
  assert.strictEqual(typeof s, 'string');
  assert.ok(s.indexOf('\n') < 0, 'compact JSON');
  var raw = JSON.parse(s);
  assert.strictEqual(raw.format, 'eve3-assembly');
  assert.strictEqual(raw.version, 1);
  assert.strictEqual(raw.units, 'mm');
  assert.deepStrictEqual(Object.keys(raw.instances[0]).sort(), ['matrix', 'part']);
  assert.deepStrictEqual(Object.keys(raw.userParts[0]).sort(), ['category', 'id', 'meshes', 'name']);
  assert.deepStrictEqual(Object.keys(raw.userParts[0].meshes[0]).sort(), ['color', 'f', 'v']);
  // tampered stored fields are ignored and recomputed
  raw.userParts[0].dims_mm = [1, 1, 1]; raw.userParts[0].approx = true; raw.userParts[0].user = false;
  var r = IO.parseAssemblyJSON(JSON.stringify(raw), { knownIds: KNOWN });
  assert.deepStrictEqual(r.instances, recs);
  assert.deepStrictEqual(r.skipped, []);
  assert.deepStrictEqual(r.warnings, []);
  assert.strictEqual(r.userParts.length, 2);
  r.userParts.forEach(function (p, i) {
    var src = [ub, spare][i];
    assert.strictEqual(p.id, src.id);
    assert.strictEqual(p.name, src.name);
    assert.strictEqual(p.category, 'Imported');
    assert.deepStrictEqual(p.dims_mm, [10, 20, 30]);
    assert.strictEqual(p.user, true);
    assert.strictEqual(p.approx, false);
    assert.ok(IO.meshesEqual(p.meshes, src.meshes), 'meshes survive exactly');
  });
});

test('assembly JSON: unused user part survives a round trip with zero instances', function () {
  var r = IO.parseAssemblyJSON(IO.serializeAssembly([], [userBox('user_spare')]));
  assert.deepStrictEqual(r.instances, []);
  assert.strictEqual(r.userParts.length, 1);
  assert.strictEqual(r.userParts[0].id, 'user_spare');
  assert.deepStrictEqual(r.userParts[0].dims_mm, [10, 20, 30]);
  var e = IO.parseAssemblyJSON(asmText({ instances: [] }));
  assert.deepStrictEqual([e.instances, e.userParts, e.skipped], [[], [], []]);
  assert.deepStrictEqual(IO.parseAssemblyJSON(asmText({ instances: [], userParts: undefined })).userParts, []);
});

test('assembly JSON: serialize rejects bad matrices and ids', function () {
  var nan = translation(0, 0, 0); nan[3] = NaN;
  assert.throws(function () { IO.serializeAssembly([{ part: 'a', matrix: nan }], []); }, /serializeAssembly: instance 0: matrix\[3\] is not a finite number/);
  assert.throws(function () { IO.serializeAssembly([{ part: 'a', matrix: [1, 0, 0] }], []); }, /matrix must be an array of 16 numbers/);
  assert.throws(function () { IO.serializeAssembly([{ part: 5, matrix: translation(0, 0, 0) }], []); }, /part id must be a non-empty string/);
  assert.throws(function () { IO.serializeAssembly('x', []); }, /expected an array/);
});

test('assembly JSON: wrong format, wrong version, not JSON, too large', function () {
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ format: 'other' })); }, /format is "other", expected "eve3-assembly"/);
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ version: 2 })); }, /unsupported version 2/);
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ version: '1' })); }, /unsupported version "1"/);
  assert.throws(function () { IO.parseAssemblyJSON('{"format":'); }, /Assembly JSON: not valid JSON/);
  assert.throws(function () { IO.parseAssemblyJSON('[1,2]'); }, /top level must be an object/);
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ instances: {} })); }, /instances must be an array/);
  assert.throws(function () { IO.parseAssemblyJSON(asmText({}), { maxBytes: 10 }); }, /file too large/);
  IO.parseAssemblyJSON(asmText({}), { maxBytes: asmText({}).length });
});

test('assembly JSON: NaN, zero and short matrices name the instance', function () {
  var ok = { part: 'beam5', matrix: translation(0, 0, 0) };
  var nan = translation(0, 0, 0); nan[5] = null; // JSON.stringify(NaN) -> null
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ instances: [ok, { part: 'beam5', matrix: nan }] }), { knownIds: KNOWN }); }, /instance 1: matrix\[5\] is not a finite number/);
  var str = translation(0, 0, 0); str[0] = 'NaN';
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ instances: [{ part: 'beam5', matrix: str }] })); }, /instance 0: matrix\[0\] is not a finite/);
  var zero = []; for (var i = 0; i < 16; i++) zero.push(0);
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ instances: [ok, { part: 'beam5', matrix: zero }] }), { knownIds: KNOWN }); }, /instance 1: matrix is not invertible/);
  var flat = translation(0, 0, 0); flat[10] = 0; // collapses Z
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ instances: [{ part: 'beam5', matrix: flat }] })); }, /not invertible/);
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ instances: [{ part: 'beam5', matrix: translation(0, 0, 0).slice(1) }] })); }, /instance 0: matrix must be an array of 16 numbers/);
});

test('assembly JSON: embedded part with out-of-range face index throws; bad colour normalised', function () {
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ userParts: [rawPart('user_t', tri('#ff0000', [0, 1, 3]))] })); },
    /userParts\[0\]: finishPart: part "user_t" mesh 0: f\[2\] = 3 is not a valid vertex index/);
  var bad = tri('#ff0000'); bad.v[1] = null;
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ userParts: [rawPart('user_t', bad)] })); }, /v\[1\] is not a finite number/);
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ userParts: [rawPart('user_t', null)] })); }, /userParts\[0\]/);
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ userParts: [{ id: 'user_t', meshes: [tri('#ff0000')] }] })); }, /name must be a string/);
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ userParts: [rawPart('a', tri('#ff0000')), rawPart('a', tri('#ff0000'))] })); }, /duplicate part id "a"/);
  var p = { id: 'user_c', name: 'c', meshes: [tri('red'), tri('#12345'), tri('#AbC123'), tri(7)] };
  var r = IO.parseAssemblyJSON(asmText({ instances: [], userParts: [p] }));
  assert.deepStrictEqual(r.userParts[0].meshes.map(function (m) { return m.color; }), ['#969696', '#969696', '#AbC123', '#969696']);
  assert.strictEqual(r.userParts[0].category, 'Imported', 'missing category defaults');
  assert.strictEqual(p.meshes[0].color, 'red', 'parsed copy, not the input object');
});

test('assembly JSON: unknown part id is skipped with a warning, accepted when knownIds says yes', function () {
  var t = asmText({ instances: [{ part: 'beam5', matrix: translation(0, 0, 0) }, { part: 'nope', matrix: translation(5, 0, 0) }, { part: 'toString', matrix: translation(6, 0, 0) }] });
  var r = IO.parseAssemblyJSON(t, { knownIds: KNOWN });
  assert.deepStrictEqual(r.instances.map(function (i) { return i.part; }), ['beam5']);
  assert.deepStrictEqual(r.skipped, [{ index: 1, part: 'nope' }, { index: 2, part: 'toString' }]);
  assert.ok(r.warnings.length === 2 && /instance 1: unknown part id "nope"/.test(r.warnings[0]), r.warnings.join('|'));
  var f = IO.parseAssemblyJSON(t, { knownIds: function (id) { return id === 'nope' || id === 'beam5' ? {} : null; } });
  assert.deepStrictEqual(f.instances.map(function (i) { return i.part; }), ['beam5', 'nope']);
  assert.deepStrictEqual(f.skipped, [{ index: 2, part: 'toString' }]);
  assert.strictEqual(IO.parseAssemblyJSON(t).skipped.length, 3, 'no knownIds: only file user parts are known');
  // an instance of an embedded user part is always known
  var u = IO.parseAssemblyJSON(asmText({ instances: [{ part: 'user_t', matrix: translation(0, 0, 0) }], userParts: [rawPart('user_t', tri('#ff0000'))] }));
  assert.deepStrictEqual(u.skipped, []);
  assert.strictEqual(u.instances[0].part, 'user_t');
});

test('assembly JSON: forbidden ids are rejected', function () {
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ instances: [{ part: '__proto__', matrix: translation(0, 0, 0) }] }), { knownIds: function () { return true; } }); }, /instance 0: part id "__proto__" is not allowed/);
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ userParts: [rawPart('constructor', tri('#ff0000'))] })); }, /userParts\[0\]: part id "constructor" is not allowed/);
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ userParts: [rawPart('prototype', tri('#ff0000'))] })); }, /not allowed/);
  assert.throws(function () { IO.parseAssemblyJSON(asmText({ instances: [{ part: 3, matrix: translation(0, 0, 0) }] })); }, /part id must be a non-empty string/);
});

var TWO = [{ part: 'beam5', matrix: translation(0, 0, 0) }, { part: 'gear8', matrix: translation(5, 0, 0) }];
function dimPt(i, x) { return { inst: i, local: [x, 1.5, -2] }; }

test('assembly JSON: dimensions round trip (distance and angle)', function () {
  var dims = [{ type: 'dist', pts: [dimPt(0, 1), dimPt(1, 2)] }, { type: 'angle', pts: [dimPt(0, 3), dimPt(1, 4), dimPt(0, 5)] }];
  var s = IO.serializeAssembly(TWO, [], dims);
  assert.deepStrictEqual(JSON.parse(s).dimensions, dims);
  var r = IO.parseAssemblyJSON(s, { knownIds: KNOWN });
  assert.deepStrictEqual(r.dimensions, dims);
  assert.deepStrictEqual(r.warnings, []);
  r.dimensions[0].pts[0].local[0] = 99;
  assert.strictEqual(dims[0].pts[0].local[0], 1, 'parsed copy, not the input');
  assert.strictEqual(JSON.parse(IO.serializeAssembly(TWO, [], [])).dimensions, undefined, 'no key without dimensions');
});

test('assembly JSON: dimension line offset (off) round trips and is omitted when absent', function () {
  var dims = [{ type: 'dist', pts: [dimPt(0, 1), dimPt(1, 2)], off: [0, 3.5, -1] }, { type: 'dist', pts: [dimPt(0, 3), dimPt(1, 4)] }];
  var s = IO.serializeAssembly(TWO, [], dims);
  assert.deepStrictEqual(JSON.parse(s).dimensions, dims);
  assert.ok(!('off' in JSON.parse(s).dimensions[1]), 'no off key when absent');
  var r = IO.parseAssemblyJSON(s, { knownIds: KNOWN });
  assert.deepStrictEqual(r.dimensions, dims);
  assert.ok(!('off' in r.dimensions[1]), 'no off key when absent');
  r.dimensions[0].off[0] = 99;
  assert.strictEqual(dims[0].off[0], 0, 'parsed copy, not the input');
});

test('assembly JSON: angle2 (4 points + off) round trips; with 3 points it is dropped with a warning', function () {
  var a2 = { type: 'angle2', pts: [dimPt(0, 1), dimPt(1, 2), dimPt(0, 3), dimPt(1, 4)], off: [1, -2, 0.5] };
  var s = IO.serializeAssembly(TWO, [], [a2]);
  assert.deepStrictEqual(JSON.parse(s).dimensions, [a2]);
  var r = IO.parseAssemblyJSON(s, { knownIds: KNOWN });
  assert.deepStrictEqual(r.dimensions, [a2]);
  assert.deepStrictEqual(r.warnings, []);
  var bad = { type: 'angle2', pts: [dimPt(0, 1), dimPt(1, 2), dimPt(0, 3)] };
  var r2 = IO.parseAssemblyJSON(asmText({ instances: TWO, dimensions: [bad, a2] }), { knownIds: KNOWN });
  assert.deepStrictEqual(r2.dimensions, [a2]);
  assert.ok(/dimension 0: type "angle2" needs exactly 4 points, dropped/.test(r2.warnings[0]), r2.warnings.join('|'));
  assert.throws(function () { IO.serializeAssembly(TWO, [], [bad]); }, /needs exactly 4 points/);
});

test('assembly JSON: a bad off drops the dimension with a warning; serialize rejects it', function () {
  var good = { type: 'dist', pts: [dimPt(0, 1), dimPt(1, 2)], off: [1, 2, 3] };
  var bad = [
    { type: 'dist', pts: [dimPt(0, 1), dimPt(1, 2)], off: [1, 2] },        // wrong length
    { type: 'dist', pts: [dimPt(0, 1), dimPt(1, 2)], off: ['NaN', 0, 0] }, // not a number
    { type: 'dist', pts: [dimPt(0, 1), dimPt(1, 2)], off: [0, null, 0] },  // NaN/Infinity survive JSON only as null
    { type: 'dist', pts: [dimPt(0, 1), dimPt(1, 2)], off: 'x' }
  ];
  var r = IO.parseAssemblyJSON(asmText({ instances: TWO, dimensions: [bad[0], good].concat(bad.slice(1)) }), { knownIds: KNOWN });
  assert.deepStrictEqual(r.dimensions, [good]);
  assert.strictEqual(r.warnings.length, bad.length);
  r.warnings.forEach(function (m) { assert.ok(/^Assembly JSON: dimension \d+: off must be 3 finite numbers, dropped$/.test(m), m); });
  assert.throws(function () { IO.serializeAssembly(TWO, [], [{ type: 'dist', pts: [dimPt(0, 1), dimPt(1, 2)], off: [NaN, 0, 0] }]); }, /dimension 0: off must be 3 finite numbers/);
});

test('assembly JSON: an old file without dimensions loads with an empty list', function () {
  var r = IO.parseAssemblyJSON(asmText({}), { knownIds: KNOWN });
  assert.deepStrictEqual(r.dimensions, []);
  assert.deepStrictEqual(r.warnings, []);
  assert.deepStrictEqual(IO.parseAssemblyJSON(asmText({ dimensions: null }), { knownIds: KNOWN }).dimensions, []);
  var w = IO.parseAssemblyJSON(asmText({ dimensions: 'x' }), { knownIds: KNOWN });
  assert.deepStrictEqual(w.dimensions, []);
  assert.ok(/dimensions must be an array/.test(w.warnings[0]), w.warnings.join('|'));
});

test('assembly JSON: bad dimensions are dropped with a warning, good ones stay', function () {
  var good = { type: 'dist', pts: [dimPt(0, 1), dimPt(1, 2)] };
  var nanLocal = { type: 'dist', pts: [dimPt(0, 1), { inst: 1, local: [0, null, 0] }] };
  var bad = [
    { type: 'dist', pts: [dimPt(0, 1), dimPt(2, 2)] },            // index out of range
    { type: 'dist', pts: [dimPt(0, 1), dimPt(-1, 2)] },           // negative index
    { type: 'dist', pts: [dimPt(0, 1), dimPt(0.5, 2)] },          // fractional index
    { type: 'dist', pts: [dimPt(0, 1), dimPt(1, 2), dimPt(1, 3)] }, // 3 points for a distance
    { type: 'angle', pts: [dimPt(0, 1), dimPt(1, 2)] },           // 2 points for an angle
    { type: 'area', pts: [dimPt(0, 1), dimPt(1, 2)] },            // unknown type
    nanLocal, null, 'x', { type: 'dist' }
  ];
  var r = IO.parseAssemblyJSON(asmText({ instances: TWO, dimensions: [bad[0]].concat([good], bad.slice(1)) }), { knownIds: KNOWN });
  assert.deepStrictEqual(r.dimensions, [good]);
  assert.strictEqual(r.warnings.length, bad.length);
  r.warnings.forEach(function (m) { assert.ok(/^Assembly JSON: dimension \d+: .*, dropped$/.test(m), m); });
  assert.ok(/dimension 0: point 1: inst is not a valid instance index/.test(r.warnings[0]), r.warnings[0]);
  assert.ok(/dimension 4: type "dist" needs exactly 2 points/.test(r.warnings[3]), r.warnings[3]);
  assert.ok(/dimension 5: type "angle" needs exactly 3 points/.test(r.warnings[4]), r.warnings[4]);
});

test('assembly JSON: dimension indexes follow the instances that were kept (skipped instances shift them)', function () {
  var insts = [{ part: 'nope', matrix: translation(0, 0, 0) }, { part: 'beam5', matrix: translation(1, 0, 0) }, { part: 'gear8', matrix: translation(2, 0, 0) }];
  var r = IO.parseAssemblyJSON(asmText({ instances: insts, dimensions: [
    { type: 'dist', pts: [dimPt(1, 1), dimPt(2, 2)] },
    { type: 'dist', pts: [dimPt(0, 1), dimPt(2, 2)] }] }), { knownIds: KNOWN });
  assert.deepStrictEqual(r.dimensions, [{ type: 'dist', pts: [dimPt(0, 1), dimPt(1, 2)] }]);
  assert.ok(/dimension 1: refers to a skipped instance, dropped/.test(r.warnings[1]), r.warnings.join('|'));
});

test('assembly JSON: serialize rejects an invalid dimension', function () {
  assert.throws(function () { IO.serializeAssembly(TWO, [], [{ type: 'dist', pts: [dimPt(0, 1), dimPt(2, 2)] }]); }, /serializeAssembly: dimension 0: point 1: inst is not a valid instance index/);
  assert.throws(function () { IO.serializeAssembly(TWO, [], [{ type: 'angle', pts: [dimPt(0, 1), dimPt(1, 2)] }]); }, /needs exactly 3 points/);
});

test('meshesEqual: exact structural comparison', function () {
  var a = [boxMesh('#ff0000'), tri('#00ff00')], b = JSON.parse(JSON.stringify(a));
  assert.strictEqual(IO.meshesEqual(a, b), true);
  b[1].color = '#00FF00';
  assert.strictEqual(IO.meshesEqual(a, b), false, 'colour case differs');
  b = JSON.parse(JSON.stringify(a)); b[0].v[5] += 1e-12;
  assert.strictEqual(IO.meshesEqual(a, b), false, 'vertex differs');
  b = JSON.parse(JSON.stringify(a)); b[0].f[0] = b[0].f[1];
  assert.strictEqual(IO.meshesEqual(a, b), false, 'face differs');
  assert.strictEqual(IO.meshesEqual(a, a.slice(0, 1)), false, 'mesh count differs');
  b = JSON.parse(JSON.stringify(a)); b[1].v.push(0, 0, 0);
  assert.strictEqual(IO.meshesEqual(a, b), false, 'vertex count differs');
  assert.strictEqual(IO.meshesEqual([], []), true);
  assert.strictEqual(IO.meshesEqual(a, null), false);
});

// ---------------------------------------------------------------- keyboard bindings

function ev(key, mods) { return Object.assign({ key: key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, mods || {}); }
function act(b, key, mods) { return IO.matchAction(b, IO.comboFromEvent(ev(key, mods))); }

test('keys: comboFromEvent builds canonical combos, bare modifiers give null', function () {
  assert.strictEqual(IO.comboFromEvent(ev('z', { ctrlKey: true })), 'Ctrl+Z');
  assert.strictEqual(IO.comboFromEvent(ev('Z', { ctrlKey: true, shiftKey: true })), 'Ctrl+Shift+Z');
  assert.strictEqual(IO.comboFromEvent(ev('z', { metaKey: true })), 'Ctrl+Z', 'Meta counts as Ctrl');
  assert.strictEqual(IO.comboFromEvent(ev('x', { shiftKey: true, altKey: true, ctrlKey: true })), 'Ctrl+Alt+Shift+X');
  assert.strictEqual(IO.comboFromEvent(ev(' ')), 'Space');
  assert.strictEqual(IO.comboFromEvent(ev('Delete')), 'Delete');
  ['Control', 'Shift', 'Alt', 'Meta', 'Dead', '', undefined].forEach(function (k) {
    assert.strictEqual(IO.comboFromEvent(ev(k)), null, String(k));
  });
  assert.strictEqual(IO.comboFromEvent(null), null);
});

test('keys: normalizeCombo canonicalises and rejects junk', function () {
  assert.strictEqual(IO.normalizeCombo('Shift+Ctrl+z'), 'Ctrl+Shift+Z');
  assert.strictEqual(IO.normalizeCombo('Alt+Ctrl+Shift+F5'), 'Ctrl+Alt+Shift+F5');
  assert.strictEqual(IO.normalizeCombo('Ctrl++'), 'Ctrl++');
  assert.strictEqual(IO.normalizeCombo('Delete'), 'Delete');
  ['', 'Ctrl+', 'Ctrl+Shift', 'Shift', 'ctrl+z', 'Ctrl+ Z', ' ', 'Ctrl+Foo-Bar', 'Ctrl+1x!', 5, null, {}].forEach(function (s) {
    assert.strictEqual(IO.normalizeCombo(s), null, JSON.stringify(s));
  });
});

test('keys: defaults are valid, canonical and free of duplicates', function () {
  var d = IO.defaultBindings(), seen = {};
  assert.strictEqual(Object.keys(d).length, IO.KEY_ACTIONS.length);
  IO.KEY_ACTIONS.forEach(function (a) {
    d[a.id].forEach(function (c) {
      assert.strictEqual(IO.normalizeCombo(c), c, c);
      assert.ok(!seen[c], 'duplicate default ' + c);
      assert.ok(IO.FIXED_KEYS.indexOf(c) < 0, c);
      seen[c] = a.id;
    });
  });
  assert.deepStrictEqual(IO.mergeBindings(null), d);
  assert.deepStrictEqual(IO.mergeBindings(undefined), d);
});

test('keys: default table reproduces the old hard-coded keys', function () {
  var b = IO.defaultBindings();
  assert.strictEqual(act(b, 'w'), 'gizmoMove');
  assert.strictEqual(act(b, 'W'), 'gizmoMove', 'Caps Lock');
  assert.strictEqual(act(b, 'W', { shiftKey: true }), 'gizmoMove', 'old code ignored Shift');
  assert.strictEqual(act(b, 'e'), 'gizmoRotate');
  assert.strictEqual(act(b, 'S', { shiftKey: true }), 'snapVertex');
  assert.strictEqual(act(b, 'z', { ctrlKey: true }), 'undo');
  assert.strictEqual(act(b, 'z', { metaKey: true }), 'undo');
  assert.strictEqual(act(b, 'Z', { ctrlKey: true, shiftKey: true }), 'redo');
  assert.strictEqual(act(b, 'y', { ctrlKey: true }), 'redo');
  assert.strictEqual(act(b, 'Y', { ctrlKey: true, shiftKey: true }), 'redo');
  assert.strictEqual(act(b, 'Delete'), 'deleteSel');
  assert.strictEqual(act(b, 'Escape'), 'deselect');
  assert.strictEqual(act(b, 'w', { ctrlKey: true }), null, 'Ctrl+W is not the gizmo');
  assert.strictEqual(act(b, 's', { altKey: true }), null);
  assert.strictEqual(act(b, 'ArrowDown'), null, 'list stepping stays hard-wired');
  assert.strictEqual(act(b, 'Backspace'), null);
});

test('keys: findConflict names the other action and refuses fixed keys', function () {
  var b = IO.defaultBindings();
  assert.strictEqual(IO.findConflict(b, 'frameAll', 'Ctrl+Z'), 'undo');
  assert.strictEqual(IO.findConflict(b, 'undo', 'Ctrl+Z'), null, 'own binding is not a conflict');
  assert.strictEqual(IO.findConflict(b, 'frameAll', 'Ctrl+Shift+Z'), 'redo');
  assert.strictEqual(IO.findConflict(b, 'frameAll', 'J'), null);
  assert.strictEqual(IO.findConflict(b, 'frameAll', 'ArrowUp'), '@fixed');
  assert.strictEqual(IO.findConflict(b, 'frameAll', 'Backspace'), '@fixed');
});

test('keys: mergeBindings ignores corrupt, unknown, duplicate and fixed entries', function () {
  var d = IO.defaultBindings();
  [42, 'x', [], true, { undo: 'Ctrl+Q' }, { nope: ['A'] }, { undo: [5, null, {}, 'junk+'] }].forEach(function (s, i) {
    var m = IO.mergeBindings(s);
    assert.deepStrictEqual(Object.keys(m).sort(), Object.keys(d).sort(), 'case ' + i + ' keeps all actions');
    if (i < 6) assert.deepStrictEqual(m, d, 'case ' + i + ' -> defaults');
  });
  var m = IO.mergeBindings({ undo: ['ctrl+z', 'Shift+Ctrl+Q', 'Shift+Ctrl+Q', 'Backspace'], wireframe: [] });
  assert.deepStrictEqual(m.undo, ['Ctrl+Shift+Q'], 'lower-case ctrl+z is invalid, duplicate and fixed key dropped');
  assert.deepStrictEqual(m.wireframe, [], 'empty list = cleared');
  assert.deepStrictEqual(m.redo, d.redo, 'untouched actions keep defaults');
  // saved combos that duplicate each other: the earlier action in table order wins
  m = IO.mergeBindings({ gizmoMove: ['J'], redo: ['J'] });
  assert.deepStrictEqual(m.gizmoMove, ['J']);
  assert.deepStrictEqual(m.redo, ['Ctrl+Y', 'Ctrl+Shift+Z'], 'duplicate dropped, list emptied -> default');
  // a saved combo that is the default of an action missing from saved loses; its own list falls back to the default
  m = IO.mergeBindings({ gizmoRotate: ['W'] });
  assert.deepStrictEqual(m.gizmoMove, ['W']);
  assert.deepStrictEqual(m.gizmoRotate, ['E']);
  // ... but when both are saved the user's choice stands
  m = IO.mergeBindings({ gizmoRotate: ['W'], gizmoMove: [] });
  assert.deepStrictEqual(m.gizmoRotate, ['W']);
  assert.deepStrictEqual(m.gizmoMove, []);
});

test('keys: Snap 15/1mm defaults; stale saved auto-rotate = A (old default) is dropped cleanly', function () {
  var d = IO.defaultBindings();
  assert.deepStrictEqual([d.snap15, d.snap1mm, d.autoRotate], [['A'], ['Z'], ['T']]);
  assert.strictEqual(act(d, 'a'), 'snap15');
  assert.strictEqual(act(d, 'z'), 'snap1mm');
  assert.strictEqual(act(d, 't'), 'autoRotate');
  assert.strictEqual(act(d, 'z', { ctrlKey: true }), 'undo', 'Ctrl+Z is still undo');
  var m = IO.mergeBindings(JSON.parse('{"autoRotate":["A"]}')); // what an older version saved
  assert.deepStrictEqual(m.snap15, ['A'], 'the new default owner keeps A');
  assert.deepStrictEqual(m.autoRotate, ['T'], 'stale override dropped, default restored');
  assert.deepStrictEqual(m, d);
  // stale override next to other valid overrides
  m = IO.mergeBindings({ autoRotate: ['A'], frameAll: ['J'] });
  assert.deepStrictEqual([m.snap15, m.autoRotate, m.frameAll], [['A'], ['T'], ['J']]);
  // the user moved Snap 15 away: A is theirs to give to auto-rotate
  m = IO.mergeBindings({ autoRotate: ['A'], snap15: ['J'] });
  assert.deepStrictEqual([m.snap15, m.autoRotate], [['J'], ['A']]);
});

test('keys: merge(overrides(merge(x))) is stable', function () {
  var x = { gizmoMove: ['J'], redo: ['Ctrl+Shift+Z'], deselect: [], frameAll: ['Ctrl+Alt+F'] };
  var a = IO.mergeBindings(x), o = IO.bindingOverrides(a), b = IO.mergeBindings(JSON.parse(JSON.stringify(o)));
  assert.deepStrictEqual(b, a);
  assert.deepStrictEqual(Object.keys(o).sort(), ['deselect', 'frameAll', 'gizmoMove', 'redo']);
  assert.deepStrictEqual(IO.bindingOverrides(IO.defaultBindings()), {});
  assert.strictEqual(act(a, 'j'), 'gizmoMove');
  assert.strictEqual(act(a, 'w'), null);
  assert.strictEqual(act(a, 'Escape'), null);
  assert.strictEqual(act(a, 'f', { ctrlKey: true, altKey: true }), 'frameAll');
});

test('keys: Space maps to toggleMax (maximize / restore view)', function () {
  var d = IO.defaultBindings();
  assert.deepStrictEqual(d.toggleMax, ['Space']);
  assert.strictEqual(act(d, ' '), 'toggleMax');
  assert.strictEqual(act(d, ' ', { shiftKey: true }), null, 'Shift+Space is not bound');
  assert.deepStrictEqual(IO.mergeBindings({ toggleMax: ['Space'] }).toggleMax, ['Space'], 'saved Space survives normalizing');
  assert.strictEqual(IO.findConflict(d, 'frameAll', 'Space'), 'toggleMax');
});

test('keys: F1 maps to help', function () {
  var d = IO.defaultBindings();
  assert.deepStrictEqual(d.help, ['F1']);
  assert.strictEqual(act(d, 'F1'), 'help');
  assert.strictEqual(act(d, 'F1', { ctrlKey: true }), null, 'Ctrl+F1 is not bound');
  assert.deepStrictEqual(IO.mergeBindings({ help: ['F1'] }).help, ['F1'], 'saved F1 survives normalizing');
  assert.strictEqual(IO.findConflict(d, 'frameAll', 'F1'), 'help');
  var m = IO.mergeBindings({ help: ['H'] });
  assert.strictEqual(IO.matchAction(m, 'H'), 'help');
  assert.strictEqual(IO.matchAction(m, 'F1'), null, 'rebinding frees F1');
});

test('keys: Q switches mode, 4 toggles four view, Alt+Enter toggles full screen (free defaults, conflicts handled)', function () {
  var d = IO.defaultBindings();
  assert.deepStrictEqual([d.toggleMode, d.fourView, d.fullscreen], [['Q'], ['4'], ['Alt+Enter']]);
  assert.strictEqual(act(d, 'q'), 'toggleMode');
  assert.strictEqual(act(d, 'Q'), 'toggleMode', 'Caps Lock');
  assert.strictEqual(act(d, '4'), 'fourView');
  assert.strictEqual(act(d, 'Enter', { altKey: true }), 'fullscreen');
  assert.strictEqual(act(d, 'Enter', { ctrlKey: true }), 'addToAssembly', 'Ctrl+Enter is untouched');
  assert.strictEqual(IO.findConflict(d, 'frameAll', 'Q'), 'toggleMode');
  assert.strictEqual(IO.findConflict(d, 'frameAll', '4'), 'fourView');
  assert.strictEqual(IO.findConflict(d, 'toggleMode', 'Q'), null, 'its own key is no conflict');
  // a saved override that takes a default of an action missing from the save loses; the owner keeps its key
  var m = IO.mergeBindings({ frameAll: ['Q'] });
  assert.deepStrictEqual([m.toggleMode, m.frameAll], [['Q'], ['F']]);
  // both saved: the user's choice stands, and a cleared mode key frees Q
  m = IO.mergeBindings({ toggleMode: [], frameAll: ['Q'] });
  assert.deepStrictEqual([m.toggleMode, m.frameAll], [[], ['Q']]);
  assert.strictEqual(IO.matchAction(m, 'Q'), 'frameAll');
  // every default is still unique across the whole table
  var all = {};
  IO.KEY_ACTIONS.forEach(function (a) { a.keys.forEach(function (c) { assert.ok(!all[c], 'duplicate default ' + c); all[c] = 1; }); });
});

// ---------------------------------------------------------------- user categories

test('categories: checkCategoryName trims, rejects empty/long/duplicate (case-insensitive)', function () {
  var ex = ['Beams', 'Axles', 'Mine'];
  assert.deepStrictEqual(IO.checkCategoryName('  My   Box ', ex), { name: 'My Box' });
  assert.ok(IO.checkCategoryName('', ex).error);
  assert.ok(IO.checkCategoryName('   ', ex).error);
  assert.ok(IO.checkCategoryName(5, ex).error);
  assert.ok(IO.checkCategoryName(null, ex).error);
  assert.ok(IO.checkCategoryName(new Array(IO.CAT_MAX + 2).join('x'), ex).error, 'too long');
  assert.deepStrictEqual(IO.checkCategoryName(new Array(IO.CAT_MAX + 1).join('x'), ex).name.length, IO.CAT_MAX, 'exactly the max is fine');
  assert.match(IO.checkCategoryName('beams', ex).error, /"Beams" already exists/);
  assert.match(IO.checkCategoryName(' AXLES ', ex).error, /already exists/);
  assert.deepStrictEqual(IO.checkCategoryName('mine', ex, 'Mine'), { name: 'mine' }, 'rename may change only the case of itself');
  assert.ok(IO.checkCategoryName('beams', ex, 'Mine').error, 'but not take another name');
  assert.deepStrictEqual(IO.checkCategoryName('x'), { name: 'x' }, 'no list given');
});

test('categories: mergeCategories survives corrupt data and drops invalid entries', function () {
  var base = ['Beams', 'Axles', 'Imported'];
  [null, undefined, 3, 'x', [], true].forEach(function (s) {
    var m = IO.mergeCategories(s, base);
    assert.deepStrictEqual(m.custom, []);
    assert.deepStrictEqual(Object.keys(m.over), []);
  });
  var m = IO.mergeCategories({
    custom: ['Mine', ' mine ', 'beams', '', 7, 'Second  one', null],
    over: { beam_3m: 'mine', axle_3m: 'AXLES', user_x: 'Imported', ghost: 'Nowhere', '': 'Mine', __proto__: 'x', constructor: 'Mine', bad: 5, beam_5m: 'second one' }
  }, base);
  assert.deepStrictEqual(m.custom, ['Mine', 'Second one'], 'duplicate/builtin-clashing/invalid names dropped');
  assert.deepStrictEqual(Object.assign({}, m.over), { beam_3m: 'Mine', axle_3m: 'Axles', user_x: 'Imported', beam_5m: 'Second one' },
    'canonical spelling, unknown categories / bad ids / non-strings dropped');
  m = IO.mergeCategories({ custom: 'nope', over: [1, 2] }, base);
  assert.deepStrictEqual([m.custom, Object.keys(m.over)], [[], []]);
  m = IO.mergeCategories({ custom: ['A'] }, null);
  assert.deepStrictEqual(m.custom, ['A'], 'no base list');
  var again = IO.mergeCategories(JSON.parse(JSON.stringify({ custom: m.custom, over: m.over })), []);
  assert.deepStrictEqual(again.custom, ['A'], 'round trip through JSON');
});

// ---------------------------------------------------------------- runner

var failed = 0;
tests.forEach(function (t) {
  try {
    t[1]();
    console.log('ok   ' + t[0]);
  } catch (e) {
    failed++;
    console.log('FAIL ' + t[0] + ': ' + e.message);
  }
});
if (failed) {
  console.log(failed + ' of ' + tests.length + ' tests FAILED');
  process.exit(1);
}
console.log('ALL TESTS PASSED (' + tests.length + ' tests)');
