/* EVE3 io.js - pure geometry I/O helpers (no DOM, no THREE).
   Plain script: exported as window.EVEIO in the browser and as module.exports under node. */
(function (factory) {
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.EVEIO = api;
})(function () {
  'use strict';

  var DEFAULT_COLOR = '#969696';
  var LIMITS = { maxBytes: 50 * 1024 * 1024, maxTriangles: 500000 };
  var WELD = 1e4; // vertices closer than 1e-4 units (per coordinate grid cell) are merged

  function checkSize(prefix, n) {
    if (n > LIMITS.maxBytes) {
      throw new Error(prefix + ': file too large (' + n + ' bytes, limit ' + LIMITS.maxBytes + ')');
    }
  }

  function checkTris(prefix, n, opts) {
    var max = opts && opts.maxTriangles != null ? opts.maxTriangles : LIMITS.maxTriangles;
    if (n > max) throw new Error(prefix + ': too many triangles (' + n + ', limit ' + max + ')');
  }

  // Bounding-box size over all mesh vertices; null when there are no vertices.
  function bboxSize(meshes) {
    var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (var m = 0; m < meshes.length; m++) {
      var v = meshes[m].v;
      for (var i = 0; i < v.length; i++) {
        var a = i % 3;
        if (v[i] < lo[a]) lo[a] = v[i];
        if (v[i] > hi[a]) hi[a] = v[i];
      }
    }
    if (lo[0] === Infinity) return null;
    return [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  }

  // groups: [{color, c:[9 coordinates per triangle]}] -> welded, indexed meshes (one per group).
  function build(prefix, groups, warnings) {
    var meshes = [], dropped = 0;
    groups.forEach(function (g) {
      var c = g.c, map = new Map(), v = [], f = [];
      function key(o) {
        return Math.round(c[o] * WELD) + ',' + Math.round(c[o + 1] * WELD) + ',' + Math.round(c[o + 2] * WELD);
      }
      function index(k, o) {
        var i = map.get(k);
        if (i === undefined) {
          i = v.length / 3;
          map.set(k, i);
          v.push(c[o], c[o + 1], c[o + 2]);
        }
        return i;
      }
      for (var t = 0; t < c.length; t += 9) {
        var k0 = key(t), k1 = key(t + 3), k2 = key(t + 6);
        if (k0 === k1 || k1 === k2 || k0 === k2) { dropped++; continue; }
        f.push(index(k0, t), index(k1, t + 3), index(k2, t + 6));
      }
      if (f.length) meshes.push({ color: g.color, v: v, f: f });
    });
    if (dropped) warnings.push(prefix + ': dropped ' + dropped + ' degenerate triangle(s)');
    if (!meshes.length) throw new Error(prefix + ': no triangles');
    return { meshes: meshes, dims_mm: bboxSize(meshes), warnings: warnings };
  }

  // ---------------------------------------------------------------- STL

  function toBytes(input) {
    if (input instanceof ArrayBuffer || Object.prototype.toString.call(input) === '[object ArrayBuffer]') {
      return new Uint8Array(input);
    }
    if (input && ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    throw new Error('STL: expected an ArrayBuffer, Uint8Array or Buffer');
  }

  // Bytes -> string, one char per byte (ASCII STL is plain ASCII).
  function bytesToText(u8, start) {
    var parts = [];
    for (var i = start; i < u8.length; i += 0x8000) {
      parts.push(String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 0x8000, u8.length))));
    }
    return parts.join('');
  }

  function startsWithSolid(u8, start) {
    var i = start;
    while (i < u8.length && (u8[i] === 32 || (u8[i] >= 9 && u8[i] <= 13))) i++;
    if (u8.length - i < 5) return false;
    return bytesToText(u8.subarray(i, i + 5), 0).toLowerCase() === 'solid';
  }

  function asciiCoords(text) {
    var re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi, c = [], m;
    while ((m = re.exec(text)) !== null) {
      for (var k = 1; k <= 3; k++) {
        var x = Number(m[k]);
        if (!isFinite(x)) throw new Error("STL: ASCII vertex coordinate '" + m[k] + "' is not a finite number");
        c.push(x);
      }
    }
    if (c.length % 9) {
      throw new Error('STL: ASCII file has ' + (c.length / 3) + ' vertices, not a multiple of 3 (incomplete facet)');
    }
    return c;
  }

  function binaryCoords(dv, n, opts) {
    checkTris('STL', n, opts);
    var c = new Array(n * 9);
    for (var t = 0; t < n; t++) {
      var o = 84 + 50 * t + 12; // skip the 12-byte facet normal
      for (var k = 0; k < 9; k++) {
        var x = dv.getFloat32(o + 4 * k, true);
        if (!isFinite(x)) throw new Error('STL: binary triangle ' + t + ' has a non-finite coordinate');
        c[t * 9 + k] = x;
      }
    }
    return c;
  }

  function parseSTL(input, opts) {
    var u8 = toBytes(input), len = u8.length, warnings = [];
    if (len === 0) throw new Error('STL: file is empty');
    checkSize('STL', len);
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var n = len >= 84 ? dv.getUint32(80, true) : -1;
    var expected = 84 + 50 * n;

    function binary() {
      if (expected < len) warnings.push('STL: ' + (len - expected) + ' trailing bytes after ' + n + ' triangles ignored');
      return build('STL', [{ color: DEFAULT_COLOR, c: binaryCoords(dv, n, opts) }], warnings);
    }
    function notBinaryReason() {
      if (n < 0) return 'file is too short (' + len + ' bytes) to be a binary STL';
      return 'binary header says ' + n + ' triangles (' + expected + ' bytes) but the file has ' + len +
        ' bytes, so the file is truncated or corrupt';
    }

    if (n >= 0 && expected === len) return binary();

    var bom = len >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF ? 3 : 0;
    var text = startsWithSolid(u8, bom) ? bytesToText(u8, bom) : null;
    if (text !== null && /facet/i.test(text)) {
      var c = null, err = null;
      try { c = asciiCoords(text); } catch (e) { err = e; }
      if (c && c.length) {
        checkTris('STL', c.length / 9, opts);
        return build('STL', [{ color: DEFAULT_COLOR, c: c }], warnings);
      }
      if (n >= 0 && expected < len) {
        warnings.push('STL: starts with "solid" but is not a valid ASCII STL (' +
          (err ? err.message : 'no vertex lines') + '); read as binary');
        return binary();
      }
      throw new Error((err ? err.message : 'STL: starts with "solid" but contains no "vertex x y z" lines') +
        '; it is not a binary STL either: ' + notBinaryReason());
    }
    if (n >= 0 && expected < len) return binary();
    throw new Error('STL: not a valid STL file: not ASCII (no "solid" ... "facet") and ' + notBinaryReason());
  }

  // ---------------------------------------------------------------- OBJ / MTL

  function stripBom(s) { return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s; }

  function hex2(x) {
    var s = Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16);
    return s.length < 2 ? '0' + s : s;
  }

  function eachLine(text, fn) {
    var lines = text.split(/\r\n|\n|\r/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], hash = line.indexOf('#');
      if (hash >= 0) line = line.slice(0, hash);
      line = line.trim();
      if (line) {
        var tok = line.split(/\s+/);
        fn(tok, tok[0].toLowerCase(), line.slice(tok[0].length).trim(), i + 1);
      }
    }
  }

  function parseMTL(text, warnings) {
    var mats = Object.create(null), cur = null;
    eachLine(text, function (tok, kw, rest, lineNo) {
      if (kw === 'newmtl') {
        cur = rest;
        mats[cur] = DEFAULT_COLOR;
      } else if (kw === 'kd' && cur !== null) {
        var r = Number(tok[1]), g = tok.length > 2 ? Number(tok[2]) : r, b = tok.length > 3 ? Number(tok[3]) : r;
        if (isFinite(r) && isFinite(g) && isFinite(b)) mats[cur] = '#' + hex2(r) + hex2(g) + hex2(b);
        else warnings.push('MTL line ' + lineNo + ': invalid Kd for material "' + cur + '", using ' + DEFAULT_COLOR);
      }
    });
    return mats;
  }

  function parseOBJ(text, mtlText, opts) {
    if (typeof text !== 'string') throw new Error('OBJ: expected the file content as text');
    checkSize('OBJ', text.length);
    var warnings = [], mats = null;
    if (mtlText != null) {
      checkSize('MTL', mtlText.length);
      mats = parseMTL(stripBom(String(mtlText)), warnings);
    }
    var verts = [], groups = [], byColor = Object.create(null), warned = Object.create(null), tris = 0;
    function group(color) {
      if (!byColor[color]) { byColor[color] = { color: color, c: [] }; groups.push(byColor[color]); }
      return byColor[color];
    }
    var cur = group(DEFAULT_COLOR);

    eachLine(stripBom(text), function (tok, kw, rest, lineNo) {
      var where = 'OBJ line ' + lineNo;
      if (kw === 'v') {
        if (tok.length < 4) throw new Error(where + ': vertex needs 3 coordinates');
        for (var k = 1; k <= 3; k++) {
          var x = Number(tok[k]);
          if (!isFinite(x)) throw new Error(where + ": vertex coordinate '" + tok[k] + "' is not a finite number");
          verts.push(x);
        }
      } else if (kw === 'f') {
        if (tok.length < 4) throw new Error(where + ': face has ' + (tok.length - 1) + ' vertices (need at least 3)');
        var nv = verts.length / 3, ids = [];
        for (var j = 1; j < tok.length; j++) {
          var s = tok[j].split('/')[0];
          if (!/^[-+]?\d+$/.test(s)) throw new Error(where + ": invalid face vertex '" + tok[j] + "'");
          var idx = parseInt(s, 10), i = idx > 0 ? idx - 1 : nv + idx;
          if (idx === 0 || i < 0 || i >= nv) {
            throw new Error(where + ': face references vertex ' + idx + ' but only ' + nv + ' vertices exist');
          }
          ids.push(i);
        }
        tris += ids.length - 2;
        checkTris('OBJ', tris, opts);
        for (var t = 1; t < ids.length - 1; t++) {
          var tri = [ids[0], ids[t], ids[t + 1]];
          for (var q = 0; q < 3; q++) cur.c.push(verts[3 * tri[q]], verts[3 * tri[q] + 1], verts[3 * tri[q] + 2]);
        }
      } else if (kw === 'usemtl') {
        var color = mats && mats[rest];
        if (!color) {
          color = DEFAULT_COLOR;
          if (!warned[rest]) {
            warned[rest] = 1;
            warnings.push('OBJ: material "' + rest + '" ' + (mats ? 'not found in MTL' : 'used but no MTL given') +
              ', using ' + DEFAULT_COLOR);
          }
        }
        cur = group(color);
      }
      // vt, vn, o, g, s, mtllib and anything else: ignored
    });
    return build('OBJ', groups, warnings);
  }

  // ---------------------------------------------------------------- part finishing

  function finishPart(p) {
    if (!p || typeof p !== 'object') throw new Error('finishPart: expected a part object');
    var where = 'finishPart: part ' + (p.id != null ? '"' + p.id + '"' : '(no id)');
    if (!Array.isArray(p.meshes) || !p.meshes.length) throw new Error(where + ': meshes must be a non-empty array');
    p.meshes.forEach(function (m, mi) {
      var w = where + ' mesh ' + mi;
      if (!m || !Array.isArray(m.v) || m.v.length % 3) throw new Error(w + ': v must be an array whose length is a multiple of 3');
      for (var i = 0; i < m.v.length; i++) {
        if (typeof m.v[i] !== 'number' || !isFinite(m.v[i])) throw new Error(w + ': v[' + i + '] is not a finite number');
      }
      if (!Array.isArray(m.f) || m.f.length % 3) throw new Error(w + ': f must be an array whose length is a multiple of 3');
      var nv = m.v.length / 3;
      for (var j = 0; j < m.f.length; j++) {
        if (!Number.isInteger(m.f[j]) || m.f[j] < 0 || m.f[j] >= nv) {
          throw new Error(w + ': f[' + j + '] = ' + m.f[j] + ' is not a valid vertex index (mesh has ' + nv + ' vertices)');
        }
      }
      if (typeof m.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(m.color)) m.color = DEFAULT_COLOR;
    });
    var dims = bboxSize(p.meshes);
    if (!dims) throw new Error(where + ': has no vertices');
    p.dims_mm = dims;
    p.approx = false;
    p.user = true;
    return p;
  }

  // ---------------------------------------------------------------- export

  // records: [{name, uid, meshes:[{color,v,f}], matrix:[16, column-major like a three.js Matrix4's elements]}]
  // -> {items:[{name, uid, meshes:[{color, v:world xyz, f}]}], warnings}. Inputs are not mutated.
  function bakeAssembly(records) {
    if (!Array.isArray(records)) throw new Error('bakeAssembly: expected an array of records');
    var warnings = [];
    var items = records.map(function (r, ri) {
      var where = 'bakeAssembly: record ' + ri + (r && r.name != null ? ' ("' + r.name + '")' : '');
      var m = r && r.matrix;
      if (!m || m.length !== 16) throw new Error(where + ': matrix must have 16 numbers');
      for (var k = 0; k < 16; k++) {
        if (typeof m[k] !== 'number' || !isFinite(m[k])) throw new Error(where + ': matrix[' + k + '] is not a finite number');
      }
      if (!Array.isArray(r.meshes)) throw new Error(where + ': meshes must be an array');
      var det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
      var mirror = det < 0;
      if (mirror) warnings.push('Export: ' + (r.name || 'part') + ' #' + r.uid + ' is mirrored; face winding flipped');
      return {
        name: r.name, uid: r.uid,
        meshes: r.meshes.map(function (me) {
          var v = me.v, out = new Array(v.length), f = me.f.slice();
          for (var i = 0; i < v.length; i += 3) {
            var x = v[i], y = v[i + 1], z = v[i + 2];
            out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
            out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
            out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          }
          if (mirror) for (var t = 0; t < f.length; t += 3) { var s = f[t + 1]; f[t + 1] = f[t + 2]; f[t + 2] = s; }
          return { color: me.color, v: out, f: f };
        })
      };
    });
    return { items: items, warnings: warnings };
  }

  function eachMesh(baked, fn) {
    baked.items.forEach(function (it) { it.meshes.forEach(function (m) { fn(m, it); }); });
  }

  function countTris(baked) { var n = 0; eachMesh(baked, function (m) { n += m.f.length / 3; }); return n; }

  function toSTLBinary(baked) {
    var n = countTris(baked);
    if (!n) throw new Error('STL export: no triangles to export');
    var u8 = new Uint8Array(84 + 50 * n), dv = new DataView(u8.buffer);
    var head = 'EVE3 assembly export, mm';
    for (var h = 0; h < 80; h++) u8[h] = h < head.length ? head.charCodeAt(h) : 32;
    dv.setUint32(80, n, true);
    var o = 84;
    eachMesh(baked, function (m) {
      var v = m.v, f = m.f;
      for (var t = 0; t < f.length; t += 3) {
        var a = 3 * f[t], b = 3 * f[t + 1], c = 3 * f[t + 2];
        var ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
        var wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
        var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 0) { nx /= len; ny /= len; nz /= len; } else nx = ny = nz = 0;
        var vals = [nx, ny, nz, v[a], v[a + 1], v[a + 2], v[b], v[b + 1], v[b + 2], v[c], v[c + 1], v[c + 2]];
        for (var k = 0; k < 12; k++) dv.setFloat32(o + 4 * k, vals[k], true);
        dv.setUint16(o + 48, 0, true);
        o += 50;
      }
    });
    return u8;
  }

  function colorHex(c) {
    return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.slice(1).toLowerCase() : DEFAULT_COLOR.slice(1);
  }

  // up to 6 decimals, trailing zeros trimmed, never an exponent
  function num(x) {
    var s = x.toFixed(6).replace(/\.?0+$/, '');
    return s === '-0' ? '0' : s;
  }

  function toOBJ(baked, opts) {
    var mtlName = (opts && opts.mtlName) || 'eve3_assembly.mtl';
    var out = ['# EVE3 assembly export, units mm', 'mtllib ' + mtlName], base = 1;
    baked.items.forEach(function (it) {
      out.push('o ' + String(it.name == null ? 'part' : it.name).replace(/[^A-Za-z0-9_.-]+/g, '_') + '_' + it.uid);
      it.meshes.forEach(function (m) {
        out.push('usemtl c_' + colorHex(m.color));
        for (var i = 0; i < m.v.length; i += 3) out.push('v ' + num(m.v[i]) + ' ' + num(m.v[i + 1]) + ' ' + num(m.v[i + 2]));
        for (var t = 0; t < m.f.length; t += 3) out.push('f ' + (m.f[t] + base) + ' ' + (m.f[t + 1] + base) + ' ' + (m.f[t + 2] + base));
        base += m.v.length / 3;
      });
    });
    return out.join('\n') + '\n';
  }

  function toMTL(baked) {
    var seen = Object.create(null), out = ['# EVE3 assembly export'];
    eachMesh(baked, function (m) {
      var hx = colorHex(m.color);
      if (seen[hx]) return;
      seen[hx] = 1;
      var rgb = [0, 2, 4].map(function (i) { return (parseInt(hx.substr(i, 2), 16) / 255).toFixed(4); });
      out.push('newmtl c_' + hx, 'Kd ' + rgb.join(' '), 'Ka 0 0 0', 'Ks 0 0 0', 'd 1');
    });
    return out.join('\n') + '\n';
  }

  // ---------------------------------------------------------------- assembly JSON (step 6)

  var BAD_IDS = ['__proto__', 'constructor', 'prototype'];

  function checkId(id, where) {
    if (typeof id !== 'string' || !id) throw new Error(where + ': part id must be a non-empty string');
    if (BAD_IDS.indexOf(id) >= 0) throw new Error(where + ': part id "' + id + '" is not allowed');
  }

  // 16 finite numbers (column-major); invertible = upper-left 3x3 determinant |det| >= 1e-9
  function checkMatrix(m, where, invertible) {
    if (!Array.isArray(m) || m.length !== 16) throw new Error(where + ': matrix must be an array of 16 numbers');
    for (var k = 0; k < 16; k++) {
      if (typeof m[k] !== 'number' || !isFinite(m[k])) throw new Error(where + ': matrix[' + k + '] is not a finite number');
    }
    if (invertible) {
      var det = m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
      if (!(Math.abs(det) >= 1e-9)) throw new Error(where + ': matrix is not invertible (det ' + det + ')');
    }
  }

  // records: [{part: id, matrix:[16]}], userParts: [{id, name, category, meshes}] -> compact JSON string
  function serializeAssembly(records, userParts) {
    if (!Array.isArray(records)) throw new Error('serializeAssembly: expected an array of records');
    var inst = records.map(function (r, i) {
      var w = 'serializeAssembly: instance ' + i;
      if (!r || typeof r !== 'object') throw new Error(w + ': must be an object');
      checkId(r.part, w);
      checkMatrix(r.matrix, w, false);
      return { part: r.part, matrix: r.matrix.slice() };
    });
    var ups = (userParts || []).map(function (p, i) {
      var w = 'serializeAssembly: user part ' + i;
      if (!p || typeof p !== 'object') throw new Error(w + ': must be an object');
      checkId(p.id, w);
      if (!Array.isArray(p.meshes)) throw new Error(w + ' ("' + p.id + '"): meshes must be an array');
      return {
        id: p.id, name: p.name, category: p.category,
        meshes: p.meshes.map(function (m) { return { color: m.color, v: m.v, f: m.f }; })
      };
    });
    return JSON.stringify({ format: 'eve3-assembly', version: 1, units: 'mm', instances: inst, userParts: ups });
  }

  // opts: {knownIds: function(id) -> bool | array of ids, maxBytes}. Unknown instance part ids are skipped, not thrown.
  function parseAssemblyJSON(text, opts) {
    opts = opts || {};
    var maxBytes = opts.maxBytes != null ? opts.maxBytes : LIMITS.maxBytes;
    if (typeof text !== 'string') throw new Error('Assembly JSON: expected the file content as text');
    if (text.length > maxBytes) throw new Error('Assembly JSON: file too large (' + text.length + ' characters, limit ' + maxBytes + ')');
    var d;
    try { d = JSON.parse(stripBom(text)); } catch (e) { throw new Error('Assembly JSON: not valid JSON (' + e.message + ')'); }
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Assembly JSON: top level must be an object');
    if (d.format !== 'eve3-assembly') throw new Error('Assembly JSON: format is ' + JSON.stringify(d.format) + ', expected "eve3-assembly"');
    if (d.version !== 1) throw new Error('Assembly JSON: unsupported version ' + JSON.stringify(d.version) + ' (only version 1 is supported)');
    if (!Array.isArray(d.instances)) throw new Error('Assembly JSON: instances must be an array');
    if (d.userParts != null && !Array.isArray(d.userParts)) throw new Error('Assembly JSON: userParts must be an array');
    var known = opts.knownIds;
    var knows = typeof known === 'function' ? function (id) { return !!known(id); }
      : Array.isArray(known) ? function (id) { return known.indexOf(id) >= 0; } : function () { return false; };
    var own = Object.create(null), skipped = [], warnings = [];
    var parts = (d.userParts || []).map(function (p, i) {
      var w = 'Assembly JSON: userParts[' + i + ']';
      if (!p || typeof p !== 'object') throw new Error(w + ': must be an object');
      checkId(p.id, w);
      if (typeof p.name !== 'string') throw new Error(w + ' ("' + p.id + '"): name must be a string');
      if (own[p.id]) throw new Error(w + ': duplicate part id "' + p.id + '"');
      own[p.id] = true;
      var meshes = Array.isArray(p.meshes) ? p.meshes.map(function (m) {
        return m && typeof m === 'object' ? { color: m.color, v: m.v, f: m.f } : m;
      }) : p.meshes;
      try {
        return finishPart({ id: p.id, name: p.name, category: typeof p.category === 'string' && p.category ? p.category : 'Imported', meshes: meshes });
      } catch (e) { throw new Error(w + ': ' + e.message); }
    });
    var inst = [];
    d.instances.forEach(function (r, i) {
      var w = 'Assembly JSON: instance ' + i;
      if (!r || typeof r !== 'object') throw new Error(w + ': must be an object');
      checkId(r.part, w);
      checkMatrix(r.matrix, w, true);
      if (own[r.part] || knows(r.part)) inst.push({ part: r.part, matrix: r.matrix.slice() });
      else {
        skipped.push({ index: i, part: r.part });
        warnings.push(w + ': unknown part id "' + r.part + '", skipped');
      }
    });
    return { instances: inst, userParts: parts, skipped: skipped, warnings: warnings };
  }

  function arraysEqual(p, q) {
    if (!Array.isArray(p) || !Array.isArray(q) || p.length !== q.length) return false;
    for (var k = 0; k < p.length; k++) if (p[k] !== q[k]) return false;
    return true;
  }

  // exact structural comparison of two meshes arrays (colour strings, v and f element-wise)
  function meshesEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) {
      var x = a[i], y = b[i];
      if (!x || !y || x.color !== y.color || !arraysEqual(x.v, y.v) || !arraysEqual(x.f, y.f)) return false;
    }
    return true;
  }

  return {
    LIMITS: LIMITS,
    DEFAULT_COLOR: DEFAULT_COLOR,
    parseSTL: parseSTL,
    parseOBJ: parseOBJ,
    finishPart: finishPart,
    bakeAssembly: bakeAssembly,
    countTris: countTris,
    toSTLBinary: toSTLBinary,
    toOBJ: toOBJ,
    toMTL: toMTL,
    serializeAssembly: serializeAssembly,
    parseAssemblyJSON: parseAssemblyJSON,
    meshesEqual: meshesEqual
  };
});
