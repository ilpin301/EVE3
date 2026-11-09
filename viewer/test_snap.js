// Unit tests for viewer/snap.js. Run: node viewer/test_snap.js  (or: node test_snap.js inside viewer/)
'use strict';
var assert = require('assert');
var path = require('path');
var S = require(path.join(__dirname, 'snap.js'));

// ---------------------------------------------------------------- test data (part frame)

function hole(x) { return { k: 'hole', p: 'round', o: [x, 0, 0], d: [0, 0, 1], u: [1, 0, 0], r: 2.4, l: [-3.9, 3.9], n: 'h' + x }; }
var BEAM = [hole(0), hole(8), hole(16)];
var PEG = [{ k: 'shaft', p: 'round', o: [0, 0, 0], d: [1, 0, 0], u: [0, 1, 0], r: 2.35, l: [0, 16], n: 'pin' }];
var AXLE = [{ k: 'shaft', p: 'cross', o: [0, 0, 0], d: [0, 0, 1], u: [1, 0, 0], r: 2.4, l: [-8, 8], n: 'axle' }];
var GEAR = [{ k: 'hole', p: 'cross', o: [0, 0, 0], d: [0, 0, 1], u: [1, 0, 0], r: 2.4, l: [-2, 2], n: 'gearhole' }];

var I = S.identity();
var ROT_Y = S.axisAngleMatrix([0, 1, 0], -90); // part X -> world +Z

function place(t, rot) { return S.mul4(S.translation(t), rot || I); }
function inst(id, feats, m) { return { id: id, features: S.worldFeatures(feats, m) }; }
function beamStatic() { return inst('beam', BEAM, I); }

// Peg standing along world Z with its shaft from z0 to z0+16, at (x, y).
function pegZ(x, y, z0) { return place([x, y, z0], ROT_Y); }

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function len(a) { return Math.sqrt(dot(a, a)); }
function lineDist(p, o, d) { var v = sub(p, o); return len(sub(v, [d[0] * dot(v, d), d[1] * dot(v, d), d[2] * dot(v, d)])); }

// The moving feature after applying c.M to its placement.
function after(c, feat, placement) { return S.worldFeatures([feat], S.applyToMatrix(c.M, placement))[0]; }

function assertAligned(w, sf) {
  assert.ok(lineDist(w.o, sf.o, sf.d) < 1e-6, 'not collinear: ' + lineDist(w.o, sf.o, sf.d));
  assert.ok(len(cross(w.d, sf.d)) < 1e-6, 'not parallel: ' + len(cross(w.d, sf.d)));
}

function assertMatrix(a, b, msg) {
  for (var i = 0; i < 16; i++) assert.ok(Math.abs(a[i] - b[i]) < 1e-9, (msg || 'matrix') + ' differs at ' + i + ': ' + a[i] + ' vs ' + b[i]);
}

// ---------------------------------------------------------------- tests

var tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('defaults and built-in axis type', function () {
  assert.deepStrictEqual(S.DEFAULTS, { dist: 4, angle: 10, near: 60 });
  assert.deepStrictEqual(S.types.map(function (t) { return t.id; }), ['axis']);
});

test('worldFeatures transforms o with translation, d/u rotation only', function () {
  var w = S.worldFeatures(PEG, pegZ(5, 6, 7))[0];
  assertMatrix(w.o.concat(w.d, w.u, [0, 0, 0, 0, 0, 0, 0]), [5, 6, 7, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.strictEqual(w.r, 2.35);
  assert.deepStrictEqual(PEG[0].o, [0, 0, 0]); // input untouched
});

test('(a) peg 3 mm off a hole: snaps collinear and parallel; dist 2 -> null', function () {
  var P = pegZ(11, 0, -8);
  var c = S.findBest([inst('peg', PEG, P)], [beamStatic()], { dist: 4 });
  assert.ok(c, 'expected a candidate');
  assert.strictEqual(c.kind, 'axis');
  assert.strictEqual(c.info.sf.n, 'h8');
  assert.strictEqual(c.info.movingId, 'peg');
  assert.strictEqual(c.info.staticId, 'beam');
  assertAligned(after(c, PEG[0], P), BEAM[1]);
  assertMatrix(c.M, S.translation([-3, 0, 0]), 'M');
  assert.ok(Math.abs(c.score - 3) < 1e-9);
  assert.strictEqual(S.findBest([inst('peg', PEG, P)], [beamStatic()], { dist: 2 }), null);
});

test('(b) beam moving, peg static: mirrored correction', function () {
  var P = pegZ(11, 0, -8);
  var c = S.findBest([inst('beam', BEAM, I)], [inst('peg', PEG, P)], { dist: 4 });
  assert.ok(c);
  assert.strictEqual(c.info.mf.n, 'h8');
  assertMatrix(c.M, S.translation([3, 0, 0]), 'M');
  assertAligned(after(c, BEAM[1], I), S.worldFeatures(PEG, P)[0]);
  assert.strictEqual(S.findBest([inst('beam', BEAM, I)], [inst('peg', PEG, P)], { dist: 2 }), null);
});

test('(c) round peg in cross hole -> null; cross axle in round hole -> candidate', function () {
  var P = pegZ(0.5, 0, -8);
  assert.strictEqual(S.findBest([inst('peg', PEG, P)], [inst('gear', GEAR, I)]), null);
  var A = place([8.5, 0, 0]);
  var c = S.findBest([inst('axle', AXLE, A)], [beamStatic()]);
  assert.ok(c);
  assert.strictEqual(c.info.sf.n, 'h8');
  assert.strictEqual(c.info.spin, 0); // no spin snap against a round hole
  assertAligned(after(c, AXLE[0], A), BEAM[1]);
});

test('size and kind rules: oversize shaft, shaft-shaft and hole-hole never pair', function () {
  var fat = [{ k: 'shaft', p: 'round', o: [0, 0, 0], d: [1, 0, 0], r: 2.71, l: [0, 16] }];
  assert.strictEqual(S.findBest([inst('fat', fat, pegZ(8.5, 0, -8))], [beamStatic()]), null);
  var okFat = [{ k: 'shaft', p: 'round', o: [0, 0, 0], d: [1, 0, 0], r: 2.69, l: [0, 16] }];
  assert.ok(S.findBest([inst('fat', okFat, pegZ(8.5, 0, -8))], [beamStatic()]));
  assert.strictEqual(S.findBest([inst('peg', PEG, pegZ(0.5, 0, -8))], [inst('peg2', PEG, pegZ(0, 0, -8))]), null);
  assert.strictEqual(S.findBest([inst('b2', BEAM, place([0.5, 0, 0]))], [beamStatic()]), null);
});

test('(d) antiparallel axis is accepted', function () {
  var P = place([9, 0, 8], S.axisAngleMatrix([0, 1, 0], 90)); // part X -> world -Z
  assert.ok(Math.abs(S.worldFeatures(PEG, P)[0].d[2] + 1) < 1e-12);
  var c = S.findBest([inst('peg', PEG, P)], [beamStatic()]);
  assert.ok(c);
  var w = after(c, PEG[0], P);
  assertAligned(w, BEAM[1]);
  assert.ok(w.d[2] < 0, 'kept its direction');
});

test('(e) 20 deg tilt with tolerance 10 -> null; 8 deg -> candidate, ends parallel', function () {
  function tilted(deg) { return S.mul4(S.axisAngleMatrix([1, 0, 0], deg, [8, 0, 0]), pegZ(8, 0, -8)); }
  assert.strictEqual(S.findBest([inst('peg', PEG, tilted(20))], [beamStatic()], { angle: 10 }), null);
  var P = tilted(8);
  var c = S.findBest([inst('peg', PEG, P)], [beamStatic()], { angle: 10 });
  assert.ok(c);
  assert.ok(Math.abs(c.info.angle - 8) < 1e-9);
  assertAligned(after(c, PEG[0], P), BEAM[1]);
});

test('(f) depth stop: 1 mm past the face snaps flush; 10 mm away slides free', function () {
  var P = pegZ(8, 0, -4.9); // shaft end 1 mm below the bottom face (-3.9)
  var c = S.findBest([inst('peg', PEG, P)], [beamStatic()]);
  assert.ok(c);
  assert.ok(Math.abs(c.info.shift - 1) < 1e-9);
  assert.ok(Math.abs(after(c, PEG[0], P).o[2] + 3.9) < 1e-9, 'flush with the face');
  assert.ok(Math.abs(c.score - 0.5) < 1e-9);

  var F = pegZ(9, 0, 13.9); // shaft end 10 mm above the top face, 1 mm sideways
  var f = S.findBest([inst('peg', PEG, F)], [beamStatic()]);
  assert.ok(f);
  assert.strictEqual(f.info.shift, 0);
  var w = after(f, PEG[0], F);
  assert.ok(Math.abs(w.o[2] - 13.9) < 1e-9, 'axial position unchanged');
  assertAligned(w, BEAM[1]);
});

test('(g) cross<->cross spin snaps u to the nearest 90 deg multiple', function () {
  [[30, [1, 0, 0]], [70, [0, 1, 0]], [-50, [0, -1, 0]]].forEach(function (cs) {
    var A = place([0.5, 0, 0], S.axisAngleMatrix([0, 0, 1], cs[0]));
    var c = S.findBest([inst('axle', AXLE, A)], [inst('gear', GEAR, I)]);
    assert.ok(c, 'candidate at ' + cs[0]);
    var w = after(c, AXLE[0], A);
    assertAligned(w, GEAR[0]);
    assert.ok(len(sub(w.u, cs[1])) < 1e-9, cs[0] + ' deg -> u ' + w.u);
  });
});

test('(h) custom type via registerType wins, unregisterType restores', function () {
  var P = pegZ(11, 0, -8);
  var fixed = S.translation([1, 2, 3]);
  S.registerType({ id: 'dummy', pair: function () { return { score: 0, M: fixed, kind: 'dummy', info: { x: 1 } }; } });
  try {
    assert.deepStrictEqual(S.types.map(function (t) { return t.id; }), ['axis', 'dummy']);
    var c = S.findBest([inst('peg', PEG, P)], [beamStatic()]);
    assert.strictEqual(c.kind, 'dummy');
    assert.strictEqual(c.info.x, 1);
    assert.strictEqual(c.info.type, 'dummy');
    assert.strictEqual(c.M, fixed);
  } finally {
    assert.strictEqual(S.unregisterType('dummy').id, 'dummy');
  }
  assert.strictEqual(S.unregisterType('dummy'), null);
  assert.deepStrictEqual(S.types.map(function (t) { return t.id; }), ['axis']);
  assert.strictEqual(S.findBest([inst('peg', PEG, P)], [beamStatic()]).kind, 'axis');
  assert.throws(function () { S.registerType({ id: 'bad' }); });
});

test('(i) never pairs features of the same instance id', function () {
  var P = pegZ(8.5, 0, -8);
  var both = { id: 'x', features: S.worldFeatures(PEG, P).concat(S.worldFeatures(BEAM, I)) };
  assert.strictEqual(S.findBest([both], [both]), null);
  assert.strictEqual(S.findBest([inst('x', PEG, P)], [inst('x', BEAM, I)]), null);
  var c = S.findBest([inst('x', PEG, P)], [inst('x', BEAM, I), inst('y', BEAM, place([0, 1, 0]))]);
  assert.strictEqual(c.info.staticId, 'y');
});

test('(j) three holes in range: picks the closest', function () {
  var P = pegZ(9, 0, -8); // 9, 1 and 7 mm from the holes at x = 0, 8, 16
  var c = S.findBest([inst('peg', PEG, P)], [beamStatic()], { dist: 10 });
  assert.strictEqual(c.info.sf.n, 'h8');
  assert.ok(Math.abs(c.info.perp - 1) < 1e-9);
  var Q = pegZ(15, 0, -8);
  assert.strictEqual(S.findBest([inst('peg', PEG, Q)], [beamStatic()], { dist: 10 }).info.sf.n, 'h16');
});

test('near: static instances farther than opts.near are skipped', function () {
  var P = pegZ(8.5, 0, -8);
  assert.ok(S.findBest([inst('peg', PEG, P)], [beamStatic()], { near: 60 }));
  assert.strictEqual(S.findBest([inst('peg', PEG, P)], [beamStatic()], { near: 5 }), null);
});

test('applyToMatrix and axisAngleMatrix about a point', function () {
  var R = S.axisAngleMatrix([0, 0, 1], 90, [1, 0, 0]);
  var m = S.applyToMatrix(R, S.translation([2, 0, 0]));
  assertMatrix(m, [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1]);
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
