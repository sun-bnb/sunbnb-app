/**
 * The `geo` helper library as plain JavaScript SOURCE, evaluated INSIDE the QuickJS sandbox (track 030 G4).
 *
 * Kept as a string on purpose: serialising a compiled TS function with `.toString()` would pick up
 * bundler-injected helpers (`__name`, ...) that do not exist in the sandbox. No host functions are
 * exposed — every helper is pure maths over the script's own numbers, so there is nothing to validate
 * at a boundary. Semantics mirror `lib/assistant/geo/{frame,shapes}.ts` (the run tests compare them):
 * local frame x = metres east, y = metres north; bearings are compass degrees clockwise from north.
 *
 * `F` (the frame constants) is `{ mode: 'geo', origin: { lat, lng }, perLng, mPerDeg }` or `{ mode: 'schematic' }`.
 */
export const GEO_LIB_SOURCE = String.raw`
function __makeGeo(F) {
  'use strict';
  var num = function (v, n) { if (typeof v !== 'number' || !isFinite(v)) throw new TypeError(n + ' must be a finite number'); return v; };
  var pt = function (p, n) {
    if (Array.isArray(p) && p.length === 2) return { x: num(p[0], n + '[0]'), y: num(p[1], n + '[1]') };
    if (!p || typeof p !== 'object') throw new TypeError(n + ' must be a point { x, y }');
    return { x: num(p.x, n + '.x'), y: num(p.y, n + '.y') };
  };
  var pts = function (a, n, min) {
    if (!Array.isArray(a) || a.length < (min || 1)) throw new TypeError(n + ' must be an array of at least ' + (min || 1) + ' points');
    return a.map(function (p, i) { return pt(p, n + '[' + i + ']'); });
  };
  var sub = function (a, b) { return { x: a.x - b.x, y: a.y - b.y }; };
  var dot = function (a, b) { return a.x * b.x + a.y * b.y; };
  var cross = function (a, b) { return a.x * b.y - a.y * b.x; };
  var hyp = function (a) { return Math.hypot(a.x, a.y); };
  var norm360 = function (d) { return ((d % 360) + 360) % 360; };

  function closestOnSegment(p, a, b) {
    var ab = sub(b, a), len2 = dot(ab, ab);
    var t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
    return { x: a.x + ab.x * t, y: a.y + ab.y * t };
  }
  function segmentsCross(a, b, c, d) {
    var d1 = cross(sub(b, a), sub(c, a)), d2 = cross(sub(b, a), sub(d, a));
    var d3 = cross(sub(d, c), sub(a, c)), d4 = cross(sub(d, c), sub(b, c));
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }
  function centroidOf(P) {
    var a = 0, cx = 0, cy = 0;
    for (var i = 0; i < P.length; i++) {
      var p = P[i], q = P[(i + 1) % P.length], w = p.x * q.y - q.x * p.y;
      a += w; cx += (p.x + q.x) * w; cy += (p.y + q.y) * w;
    }
    if (Math.abs(a) < 1e-9) {
      return { x: P.reduce(function (s, p) { return s + p.x; }, 0) / P.length, y: P.reduce(function (s, p) { return s + p.y; }, 0) / P.length };
    }
    return { x: cx / (3 * a), y: cy / (3 * a) };
  }
  function boundaryDistance(A, B) {
    var best = Infinity;
    for (var i = 0; i < A.length; i++) {
      var p1 = A[i], p2 = A[(i + 1) % A.length];
      for (var j = 0; j < B.length; j++) {
        var q1 = B[j], q2 = B[(j + 1) % B.length];
        if (segmentsCross(p1, p2, q1, q2)) return 0;
        best = Math.min(best,
          hyp(sub(p1, closestOnSegment(p1, q1, q2))), hyp(sub(p2, closestOnSegment(p2, q1, q2))),
          hyp(sub(closestOnSegment(q1, p1, p2), q1)), hyp(sub(closestOnSegment(q2, p1, p2), q2)));
      }
    }
    return best;
  }
  function nearestOn(p, P, closed) {
    if (P.length === 1) return P[0];
    var best = P[0], bd = Infinity, n = closed ? P.length : P.length - 1;
    for (var i = 0; i < n; i++) {
      var q = closestOnSegment(p, P[i], P[(i + 1) % P.length]), d = hyp(sub(p, q));
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  }

  return {
    /** Straight-line distance in metres. */
    distance: function (a, b) { return hyp(sub(pt(b, 'b'), pt(a, 'a'))); },
    /** Compass bearing (degrees clockwise from north) from a to b. */
    bearing: function (a, b) { var v = sub(pt(b, 'b'), pt(a, 'a')); return norm360(Math.atan2(v.x, v.y) * 180 / Math.PI); },
    /** Unit vector { x: east, y: north } of a compass bearing. */
    unit: function (deg) { var r = num(deg, 'degrees') * Math.PI / 180; return { x: Math.sin(r), y: Math.cos(r) }; },
    /** Smallest difference between two bearings, 0..180. */
    angleBetween: function (a, b) { return Math.abs(((num(a, 'a') - num(b, 'b') + 540) % 360) - 180); },
    add: function (a, b) { a = pt(a, 'a'); b = pt(b, 'b'); return { x: a.x + b.x, y: a.y + b.y }; },
    sub: function (a, b) { return sub(pt(a, 'a'), pt(b, 'b')); },
    /** Rotate p CLOCKWISE (compass sense) by degrees around "about" (default the origin). */
    rotate: function (p, deg, about) {
      p = pt(p, 'p'); var c = about === undefined ? { x: 0, y: 0 } : pt(about, 'about');
      var r = num(deg, 'degrees') * Math.PI / 180, s = Math.sin(r), k = Math.cos(r), d = sub(p, c);
      return { x: c.x + d.x * k + d.y * s, y: c.y - d.x * s + d.y * k };
    },
    /** Area centroid of a polygon (vertex mean when degenerate). */
    centroid: function (poly) { return centroidOf(pts(poly, 'poly', 1)); },
    /** Absolute polygon area in square metres. */
    area: function (poly) {
      var P = pts(poly, 'poly', 3), a = 0;
      for (var i = 0; i < P.length; i++) a += cross(P[i], P[(i + 1) % P.length]);
      return Math.abs(a) / 2;
    },
    /** Edge-to-edge gap between two CONVEX polygons in metres; negative = overlap depth, 0 = touching. */
    polygonGap: function (a, b) {
      var A = pts(a, 'a', 3), B = pts(b, 'b', 3), best = -Infinity, polys = [A, B];
      for (var k = 0; k < 2; k++) {
        var P = polys[k];
        for (var i = 0; i < P.length; i++) {
          var e = sub(P[(i + 1) % P.length], P[i]), len = Math.hypot(e.x, e.y);
          if (len === 0) continue;
          var n = { x: e.y / len, y: -e.x / len };
          var pa = A.map(function (p) { return dot(p, n); }), pb = B.map(function (p) { return dot(p, n); });
          best = Math.max(best, Math.max(Math.min.apply(null, pa) - Math.max.apply(null, pb), Math.min.apply(null, pb) - Math.max.apply(null, pa)));
        }
      }
      if (best <= 0) return best === 0 ? 0 : best;
      return boundaryDistance(A, B);
    },
    pointInPolygon: function (p, poly) {
      p = pt(p, 'p'); var P = pts(poly, 'poly', 3), inside = false;
      for (var i = 0, j = P.length - 1; i < P.length; j = i++) {
        var a = P[i], b = P[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    },
    /** Closest point on a polyline (closed = polygon outline). */
    nearestOnPath: function (p, path, closed) { return nearestOn(pt(p, 'p'), pts(path, 'path', 1), !!closed); },
    /** Distance from p to a polyline (closed = polygon outline). */
    distanceToPath: function (p, path, closed) { p = pt(p, 'p'); return hyp(sub(p, nearestOn(p, pts(path, 'path', 1), !!closed))); },
    /** Site coordinates -> local metres: { lat, lng } on a map site, schematic { x, y } (y down) on a plan. */
    toLocal: function (p) {
      if (F.mode === 'geo') {
        if (!p || typeof p !== 'object') throw new TypeError('toLocal needs { lat, lng }');
        return { x: (num(p.lng, 'lng') - F.origin.lng) * F.perLng, y: (num(p.lat, 'lat') - F.origin.lat) * F.mPerDeg };
      }
      p = pt(p, 'p'); return { x: p.x, y: -p.y };
    },
    /** Local metres -> site coordinates ({ lat, lng } on a map site, schematic { x, y } on a plan). */
    fromLocal: function (p) {
      p = pt(p, 'p');
      if (F.mode === 'geo') return { lat: F.origin.lat + p.y / F.mPerDeg, lng: F.origin.lng + p.x / F.perLng };
      return { x: p.x, y: -p.y };
    },
    frame: F,
  };
}
`
