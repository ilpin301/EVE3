/* EVE3 snap.js - pure-math smart-snap framework (no DOM, no THREE).
   Pairs features (hole / shaft axes) of a moving set of instances with features of static instances
   and computes the rigid world-space correction M for the moving set (new_world = M * old_world).
   Matrices: 16-element arrays, column-major (like THREE.Matrix4.elements). Vectors [x,y,z]. mm, degrees.
   Plain script: exported as window.EVESNAP in the browser and as module.exports under node. */
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.EVESNAP = api;
})(function () {
  'use strict';

  var DEFAULTS = { dist: 4, angle: 10, near: 60 };
  var SIZE_EPS = 0.3; // shaft.r may exceed hole.r by this much (mm)
  var DEG = Math.PI / 180;

  // ---------------------------------------------------------------- vectors / matrices

  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function norm(a) { var l = len(a); return l > 1e-12 ? scale(a, 1 / l) : [0, 0, 0]; }
  function dist(a, b) { return len(sub(a, b)); }

  function identity() { return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }

  function translation(v) { var m = identity(); m[12] = v[0]; m[13] = v[1]; m[14] = v[2]; return m; }

  // a * b, both column-major 4x4.
  function mul4(a, b) {
    var out = new Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  }

  function xfPoint(m, p) {
    return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
            m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
            m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
  }

  function xfDir(m, v) {
    return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
            m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2]];
  }

  // Rotation by deg about the unit-normalised axis through point (default origin).
  function axisAngleMatrix(axis, deg, point) {
    var a = norm(axis), x = a[0], y = a[1], z = a[2];
    var c = Math.cos(deg * DEG), s = Math.sin(deg * DEG), t = 1 - c;
    var m = [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0,
             t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0,
             t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0,
             0, 0, 0, 1];
    if (!point) return m;
    return mul4(translation(point), mul4(m, translation(scale(point, -1))));
  }

  // ---------------------------------------------------------------- features

  // Part-frame features -> world features (rigid matrix assumed, scale 1).
  function worldFeatures(features, m) {
    return (features || []).map(function (f) {
      var w = {};
      for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k)) w[k] = f[k];
      w.o = xfPoint(m, f.o);
      w.d = norm(xfDir(m, f.d));
      if (f.u) w.u = norm(xfDir(m, f.u));
      return w;
    });
  }

  function midpoint(f) { return add(f.o, scale(f.d, (f.l[0] + f.l[1]) / 2)); }

  // Perpendicular distance from point p to the line through o with unit direction d.
  function lineDist(p, o, d) { var v = sub(p, o); return len(sub(v, scale(d, dot(v, d)))); }

  // ---------------------------------------------------------------- type registry

  var types = [];

  function registerType(type) {
    if (!type || typeof type.id !== 'string' || typeof type.pair !== 'function') {
      throw new Error('EVESNAP.registerType: need {id:string, pair:function}');
    }
    unregisterType(type.id);
    types.push(type);
    return type;
  }

  function unregisterType(id) {
    for (var i = 0; i < types.length; i++) {
      if (types[i].id === id) return types.splice(i, 1)[0];
    }
    return null;
  }

  // ---------------------------------------------------------------- built-in 'axis' type

  // Profile rule: a cross axle fits a cross hole AND a round hole (it spins freely in the round one);
  // a round pin fits only a round hole - a round pin in a cross hole is NOT allowed.
  function profileFits(shaft, hole) {
    return hole.p === 'cross' ? shaft.p === 'cross' : true;
  }

  function axisPair(mf, sf, opts) {
    if (!mf.l || !sf.l || mf.k === sf.k) return null;
    var shaftMoving = mf.k === 'shaft';
    var shaft = shaftMoving ? mf : sf, hole = shaftMoving ? sf : mf;
    if (shaft.k !== 'shaft' || hole.k !== 'hole') return null;
    if (!profileFits(shaft, hole)) return null;
    if (shaft.r > hole.r + SIZE_EPS) return null;

    var cosA = dot(mf.d, sf.d), sign = cosA < 0 ? -1 : 1;
    var ang = Math.acos(Math.min(1, Math.abs(cosA))) / DEG; // line angle, sign ignored
    if (ang > opts.angle) return null;
    var perp = lineDist(midpoint(shaft), hole.o, hole.d);
    if (perp > opts.dist) return null;

    // (1) smallest rotation taking the moving axis onto +-static axis, about the moving segment midpoint
    var pivot = midpoint(mf), target = scale(sf.d, sign);
    var ax = cross(mf.d, target);
    var M = len(ax) > 1e-12 ? axisAngleMatrix(ax, ang, pivot) : identity();

    // (2) translate perpendicular to the axis so the lines are collinear (pivot stays on the moving axis)
    var rel = sub(pivot, sf.o);
    M = mul4(translation(sub(scale(sf.d, dot(rel, sf.d)), rel)), M);

    // (3) depth stop along the axis, in static-axis coordinates (static segment = sf.l)
    var mo = xfPoint(M, mf.o), md = xfDir(M, mf.d);
    var a0 = dot(sub(add(mo, scale(md, mf.l[0])), sf.o), sf.d);
    var a1 = dot(sub(add(mo, scale(md, mf.l[1])), sf.o), sf.d);
    var mLo = Math.min(a0, a1), mHi = Math.max(a0, a1);
    var sLo = Math.min(sf.l[0], sf.l[1]), sHi = Math.max(sf.l[0], sf.l[1]);
    // shifts of the moving interval: lo->lo, hi->hi, mid->mid (same for shaft or hole moving)
    var shifts = [sLo - mLo, sHi - mHi, (sLo + sHi - mLo - mHi) / 2];
    var shift = shifts[0];
    for (var i = 1; i < shifts.length; i++) if (Math.abs(shifts[i]) < Math.abs(shift)) shift = shifts[i];
    var applied = Math.abs(shift) <= opts.dist ? shift : 0; // farther: free slide along the axis
    if (applied) M = mul4(translation(scale(sf.d, applied)), M);

    // (4) cross<->cross: spin about the common axis so u lands on a multiple of 90 deg
    var spin = 0;
    if (mf.p === 'cross' && sf.p === 'cross' && mf.u && sf.u) {
      var mu = xfDir(M, mf.u);
      var up = norm(sub(mu, scale(sf.d, dot(mu, sf.d))));
      var su = norm(sub(sf.u, scale(sf.d, dot(sf.u, sf.d))));
      var phi = Math.atan2(dot(cross(up, su), sf.d), dot(up, su)) / DEG;
      spin = phi - 90 * Math.round(phi / 90);
      if (Math.abs(spin) > 1e-9) M = mul4(axisAngleMatrix(sf.d, spin, sf.o), M);
    }

    return {
      score: perp + 0.5 * Math.abs(applied) + 0.2 * ang,
      M: M,
      kind: 'axis',
      info: { perp: perp, angle: ang, shift: applied, freeSlide: applied === 0 && shift !== 0, spin: spin }
    };
  }

  registerType({ id: 'axis', pair: axisPair });

  // ---------------------------------------------------------------- search

  function findBest(moving, statics, opts) {
    var o = {};
    for (var k in DEFAULTS) o[k] = DEFAULTS[k];
    if (opts) for (k in opts) if (opts[k] != null) o[k] = opts[k];

    var movingIds = {}, mfs = [];
    (moving || []).forEach(function (inst) {
      movingIds[inst.id] = true;
      (inst.features || []).forEach(function (f) { mfs.push({ id: inst.id, f: f }); });
    });

    var best = null;
    (statics || []).forEach(function (inst) {
      if (movingIds[inst.id]) return; // never pair features of the same instance
      var sfs = inst.features || [];
      var near = sfs.some(function (sf) {
        return mfs.some(function (m) { return dist(sf.o, m.f.o) <= o.near; });
      });
      if (!near) return;
      mfs.forEach(function (m) {
        if (m.id === inst.id) return;
        sfs.forEach(function (sf) {
          types.forEach(function (type) {
            var c = type.pair(m.f, sf, o);
            if (!c || !(c.score < (best ? best.score : Infinity))) return;
            var info = {};
            for (var key in c.info || {}) info[key] = c.info[key];
            info.type = type.id;
            info.movingId = m.id;
            info.staticId = inst.id;
            info.mf = m.f;
            info.sf = sf;
            best = { score: c.score, M: c.M, kind: c.kind, info: info };
          });
        });
      });
    });
    return best;
  }

  function applyToMatrix(M, m) { return mul4(M, m); }

  return {
    DEFAULTS: DEFAULTS,
    types: types,
    registerType: registerType,
    unregisterType: unregisterType,
    worldFeatures: worldFeatures,
    findBest: findBest,
    applyToMatrix: applyToMatrix,
    mul4: mul4,
    identity: identity,
    translation: translation,
    axisAngleMatrix: axisAngleMatrix
  };
});
