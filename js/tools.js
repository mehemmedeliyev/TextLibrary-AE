/* Text Library - Tools tab: Carousel (Circle / Path / Vision / Orbit, 5 styles each, like SaaSor v2.2) */
(function () {
  'use strict';

  var App = window.TLApp;
  var $ = function (id) { return document.getElementById(id); };
  var LS_KEY = 'tl.carousel.v3';

  /* ------------------------------------------------------------------ */
  /* Shapes and styles                                                   */
  /* ------------------------------------------------------------------ */

  // sliders on the Control layer, in Effect Controls order: [name, min, max, step]
  var PATH_SLIDERS = [
    ['Speed', -500, 500, 1], ['Spacing', 0, 100, 1], ['Phase Offset', -100, 100, 0.1],
    ['Global Scale', 0, 200, 0.1], ['Scale Depth', 0, 400, 0.1], ['Scale Min', -700, 200, 0.1],
    ['Depth Angle', -360, 1080, 1], ['Move Carousel', -500, 500, 0.1], ['Rotation Follow', 0, 100, 0.1]
  ];
  var VISION_SLIDERS = PATH_SLIDERS.concat([['X slider', -180, 180, 1], ['Y slider', -180, 180, 1], ['3D Y Angle', -180, 180, 1]]);
  var ORBIT_SLIDERS = [
    ['Radius', 0, 2000, 1], ['Element Count', 1, 200, 0.1], ['Offset', -200, 200, 0.1],
    ['Rotation X', -180, 180, 0.01], ['Rotation Y', -1080, 1080, 0.01], ['Rotation Z', -180, 180, 0.01],
    ['Perspective Boost', 0, 150, 0.1], ['Scale Min', -100, 100, 0.1], ['Scale Max', -100, 100, 0.1]
  ];

  // slider values measured from SaaSor v2.2 (1920x1080 comps, 12 cards); paths traced from the
  // SaaSor product previews (where the cards actually run), Vision rings scaled + moved to match them
  var PRESETS = {
    1: [
      { values: [80, 100, 0, 32, 160, -40, 0, 0, 0],
        path: { closed: true, v: [[1107, 174.8], [1426.3, 489.6], [1107, 804.4], [787.7, 489.6]],
          i: [[-176.3, 0], [0, -173.9], [176.3, 0], [0, 173.9]],
          o: [[176.3, 0], [0, 173.9], [-176.3, 0], [0, -173.9]] } },
      { values: [80, 100, 0, 24, 136, -43.2, 180, 0, 0],
        path: { closed: true, v: [[1097.9, 190.3], [1425.3, 571.3], [1108.5, 960.9], [781, 579.9]],
          i: [[-177.9, 2.4], [-2.9, -212.8], [177.9, -2.4], [2.9, 212.8]],
          o: [[177.9, -2.4], [2.9, 212.8], [-177.9, 2.4], [-2.9, -212.8]] } },
      { values: [250, 70, 0, 40, 140, 50, 0, 0, 0],
        path: { closed: true, v: [[1111.2, 217.3], [1424.7, 526.4], [1111.2, 835.5], [797.7, 526.4]],
          i: [[-173.1, 0], [0, -170.7], [173.1, 0], [0, 170.7]],
          o: [[173.1, 0], [0, 170.7], [-173.1, 0], [0, -170.7]] } },
      { values: [30, 100, 0, 45, 135, -20, 180, 0, 0],
        path: { closed: true, v: [[1120, 268.6], [1637.7, 419], [1281.1, 818.4], [763.4, 668.1]],
          i: [[-241.4, 68.8], [-44.5, -151.8], [241.4, -68.8], [44.5, 151.8]],
          o: [[241.4, -68.8], [44.5, 151.8], [-241.4, 68.8], [-44.5, -151.8]] } },
      { values: [30, 100, 0, 45.9, 330, 8.9, 446, 0, 0],
        path: { closed: true, v: [[1744.3, 158.5], [2163.8, 453.1], [1895.8, 886.8], [1476.2, 592.2]],
          i: [[-189.9, 38.4], [-41.8, -201.1], [189.9, -38.4], [41.8, 201.1]],
          o: [[189.9, -38.4], [41.8, 201.1], [-189.9, 38.4], [-41.8, -201.1]] } }
    ],
    2: [
      { values: [-100, 100, 0, 46.3, 133, -17.3, 853, -93.1, 0],
        path: { closed: false, v: [[815, 889.1], [571.5, 670.8], [683.4, 372.6], [982.7, 230.2], [1316.5, 274.2], [1496.3, 532], [1375.8, 838.2]],
          i: [[0, 0], [21.9, 86.1], [-68.5, 73.4], [-105.5, 16.4], [-85.6, -50.3], [-9.9, -94], [40.2, -102.1]],
          o: [[-81.2, -72.8], [-21.9, -86.1], [68.5, -73.4], [105.5, -16.4], [85.6, 50.3], [9.9, 94], [0, 0]] } },
      { values: [150, 100, 0, 58.9, 168, -33.7, 0, 0, 0],
        path: { closed: false, v: [[177.6, 174.5], [436, 414.1], [697.6, 693], [1058.7, 760.6], [1357, 525], [1583.1, 216.5], [1804.8, 449.6]],
          i: [[0, 0], [-86.7, -86.4], [-103.8, -57.7], [-109.9, 28], [-87.4, 90.7], [-74.6, 12.6], [-73.9, -77.7]],
          o: [[86.1, 79.9], [86.7, 86.4], [103.8, 57.7], [109.9, -28], [87.4, -90.7], [74.6, -12.6], [0, 0]] } },
      { values: [200, 100, 0, 91, 95.2, -52.6, 25, 0, 0],
        path: { closed: false, v: [[-203.8, 820.9], [264.2, 721.2], [703.4, 547.1], [1181.8, 498.4], [1627.3, 324.6], [2065.8, 130.4]],
          i: [[0, 0], [-151.2, 45.6], [-152.9, 37.1], [-154, 37.1], [-147.3, 61.3], [-146.2, 64.7]],
          o: [[156, -33.2], [151.2, -45.6], [152.9, -37.1], [154, -37.1], [147.3, -61.3], [0, 0]] } },
      { values: [100, 100, 0, 58.9, 18.6, -663, 177.7, 0, 0],
        path: { closed: false, v: [[-151.4, 799.8], [100.4, 594.6], [359.4, 400], [663.1, 344], [929, 529.2], [1228, 638.4], [1539.1, 549.1], [1823, 390.2], [2061.4, 174.3]],
          i: [[0, 0], [-85.1, 66.6], [-93.8, 41.8], [-94.9, -21.5], [-94.1, -49.1], [-101.7, -3.3], [-99.2, 41.4], [-87.1, 62.5], [-79.5, 72]],
          o: [[83.9, -68.4], [85.1, -66.6], [93.8, -41.8], [94.9, 21.5], [94.1, 49.1], [101.7, 3.3], [99.2, -41.4], [87.1, -62.5], [0, 0]] } },
      { values: [100, 100, 0, 37.2, 81.5, -5, 62, 0, 0],
        path: { closed: false, v: [[-170.3, 22.4], [188.4, 226.2], [527.1, 450.1], [934.7, 513], [1342.8, 573.3], [1695.2, 779.3], [2040.5, 1005.5]],
          i: [[0, 0], [-116.2, -71.3], [-124.4, -47.8], [-136, -20.5], [-126.7, -44.4], [-116.3, -72], [-115.1, -75.4]],
          o: [[119.6, 68], [116.2, 71.3], [124.4, 47.8], [136, 20.5], [126.7, 44.4], [116.3, 72], [0, 0]] } }
    ],
    // Vision: read from SaaSor v2.2 Style 1-5 rigs in a 1920x1080 comp; nullOff = the Vision Null's
    // position away from the comp centre (Style 1 has it moved)
    3: [
      { values: [100, 100, 0, 100, 130, -45.8, 0, 0, 0, -106, 0, -70], nullOff: [0, 111.34, -31.93],
        path: { closed: true, v: [[968.9, -488.3], [1807.4, 382.6], [968.9, 1253.4], [130.4, 382.6]], i: [[-463.1, 0], [0, -481], [463.1, 0], [0, 481]], o: [[463.1, 0], [0, 481], [-463.1, 0], [0, -481]] } },
      { values: [100, 100, 0, 100, 57, -120.8, 0, 0, 0, -90, 0, -120],
        path: { closed: true, v: [[951.6, -330.7], [1692.6, 540.2], [951.6, 1411], [210.6, 540.2]], i: [[-409.2, 0], [0, -481], [409.2, 0], [0, 481]], o: [[409.2, 0], [0, 481], [-409.2, 0], [0, -481]] } },
      { values: [100, 100, 0, 100, 56.7, -151.3, 0, 0, 0, -81.8, 24.5, -119],
        path: { closed: true, v: [[962.6, -300.7], [1937.6, 570.2], [962.6, 1441], [-12.4, 570.2]], i: [[-538.5, 0], [0, -481], [538.5, 0], [0, 481]], o: [[538.5, 0], [0, 481], [-538.5, 0], [0, -481]] } },
      { values: [100, 100, 0, 100, 56.7, -151.1, 0, 0, 0, -76.8, 0, -100],
        path: { closed: true, v: [[986.7, -680.5], [1899.5, 190.4], [986.7, 1061.2], [73.9, 190.4]], i: [[-504.1, 0], [0, -481], [504.1, 0], [0, 481]], o: [[504.1, 0], [0, 481], [-504.1, 0], [0, -481]] } },
      { values: [102, 31, 0, 112.5, 56.7, 0, 0, 0, 0, -90, 0, -50],
        path: { closed: true, v: [[957.1, 471.2], [2482, 1187.1], [957.1, 1902.9], [-567.9, 1187.1]], i: [[-842.2, 0], [0, -395.3], [842.2, 0], [0, 395.3]], o: [[842.2, 0], [0, 395.3], [-842.2, 0], [0, -395.3]] } }
    ],
    // Orbit: read from SaaSor v2.2 Style 1-5 rigs in a 1920x1080 comp - no camera layer (AE's default
    // camera), the Orbit Control at the comp centre
    4: [
      { values: [365, 15, 91.3, 0, 0, 0, 85, -14, 35], zoom: 0, pos: [960, 540] },
      { values: [300, 12.5, 0, 0, -90, 90, 73, -30, 17.8], zoom: 0, pos: [960, 540] },
      { values: [365, 38.1, 101.4, 90, 0, 36, 85, -20.6, 23.3], zoom: 0, pos: [960, 540] },
      { values: [500, 25, 13.8, 0, 0, 10, 82, -20.7, 20], zoom: 0, pos: [960, 540] },
      { values: [400, 122, 46.8, 0, 0, 90, 100, -5.4, 21], zoom: 0, pos: [960, 540] }
    ]
  };

  var SHAPES = {
    1: { name: 'Circle', sliders: PATH_SLIDERS },
    2: { name: 'Path', sliders: PATH_SLIDERS },
    3: { name: 'Vision', sliders: VISION_SLIDERS },
    4: { name: 'Orbit', sliders: ORBIT_SLIDERS }
  };

  // After Effects default label colours (index = layer.label)
  var LABELS = ['#8a8a92', '#b53838', '#e4d84c', '#a9cbc7', '#e5bcc9', '#a9a9ca', '#e7c19e', '#b3c7b3',
    '#677de0', '#4aa44c', '#8e2c9a', '#e8920d', '#7f452a', '#f46dd6', '#3da2a5', '#a89677', '#1e401e'];
  var SAMPLE = ['#5b8def', '#e8b04a', '#e0705a', '#5cc59a', '#9b7ce0', '#e07aa8', '#4fbcd0', '#c9c06a'];

  var state = {
    shape: 1,
    style: { 1: 0, 2: 0, 3: 0, 4: 0 },
    vals: { 1: null, 2: null, 3: null, 4: null }, // slider values per shape (switching keeps your tweaks)
    comp: { w: 1920, h: 1080, fps: 30, name: '' },
    layers: null,       // selected cards [{w, h, color, index}] or null = sample cards
    rigPath: null,      // path read from a linked rig (its mask may have been reshaped)
    ctrl: null,         // linked Control layer name
    ctrlShape: 0,
    playing: true,
    t: 0,
    last: 0,
    raf: 0,
    visible: false,
    pending: {},
    pushTimer: 0
  };

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function shape() { return SHAPES[state.shape]; }
  function vals() { return state.vals[state.shape]; }

  function styleValues(sid, idx) {
    var out = {};
    SHAPES[sid].sliders.forEach(function (s, i) { out[s[0]] = PRESETS[sid][idx].values[i]; });
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* After Effects math (the same formulas the card expressions run)     */
  /* ------------------------------------------------------------------ */

  // linear() / ease() of AE expressions: clamped interpolation; ease uses a smooth cubic
  function linearAE(t, a, b, v1, v2) {
    if (a === b) return t <= a ? v1 : v2;
    var u = clamp((t - a) / (b - a), 0, 1);
    return v1 + (v2 - v1) * u;
  }
  function easeAE(t, a, b, v1, v2) {
    if (a === b) return t <= a ? v1 : v2;
    var u = clamp((t - a) / (b - a), 0, 1);
    return v1 + (v2 - v1) * u * u * (3 - 2 * u);
  }

  // arc-length table of a mask path, for pointOnPath / tangentOnPath
  function buildLut(d) {
    if (!d || !d.v || d.v.length < 2) return null;
    var pts = [d.v[0]], len = [0], seg = [0], loc = [0], ctl = [], total = 0, n = d.v.length, segs = d.closed ? n : n - 1, STEPS = 64;
    function bez(a, b, c, e, t) { var m = 1 - t; return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * e; }
    for (var k = 0; k < segs; k++) {
      var j = (k + 1) % n, p0 = d.v[k], p3 = d.v[j];
      var p1 = [p0[0] + d.o[k][0], p0[1] + d.o[k][1]], p2 = [p3[0] + d.i[j][0], p3[1] + d.i[j][1]];
      ctl.push([p0, p1, p2, p3]);
      for (var s = 1; s <= STEPS; s++) {
        var t = s / STEPS, q = [bez(p0[0], p1[0], p2[0], p3[0], t), bez(p0[1], p1[1], p2[1], p3[1], t)];
        var last = pts[pts.length - 1];
        total += Math.sqrt((q[0] - last[0]) * (q[0] - last[0]) + (q[1] - last[1]) * (q[1] - last[1]));
        pts.push(q);
        len.push(total);
        seg.push(k);
        loc.push(t);
      }
    }
    return total > 0 ? { pts: pts, len: len, seg: seg, loc: loc, ctl: ctl, total: total } : null;
  }

  function seek(lut, pct) {
    var target = clamp(pct, 0, 1) * lut.total, lo = 0, hi = lut.len.length - 1;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (lut.len[mid] < target) lo = mid; else hi = mid;
    }
    var seg = lut.len[hi] - lut.len[lo];
    return { lo: lo, hi: hi, f: seg > 0 ? (target - lut.len[lo]) / seg : 0 };
  }
  function pointOnPath(lut, pct) {
    var s = seek(lut, pct), a = lut.pts[s.lo], b = lut.pts[s.hi];
    return [a[0] + (b[0] - a[0]) * s.f, a[1] + (b[1] - a[1]) * s.f];
  }
  // direction of the curve itself (bezier derivative) at that point; a corner with no handles
  // falls back to the second derivative, which points along the curve there
  function tangentOnPath(lut, pct) {
    var s = seek(lut, pct), k = lut.seg[s.hi], t0 = lut.seg[s.lo] === k ? lut.loc[s.lo] : 0;
    var t = t0 + (lut.loc[s.hi] - t0) * s.f, c = lut.ctl[k], m = 1 - t;
    var dx = 3 * m * m * (c[1][0] - c[0][0]) + 6 * m * t * (c[2][0] - c[1][0]) + 3 * t * t * (c[3][0] - c[2][0]);
    var dy = 3 * m * m * (c[1][1] - c[0][1]) + 6 * m * t * (c[2][1] - c[1][1]) + 3 * t * t * (c[3][1] - c[2][1]);
    if (Math.abs(dx) + Math.abs(dy) < 1e-9) {
      dx = 6 * m * (c[2][0] - 2 * c[1][0] + c[0][0]) + 6 * t * (c[3][0] - 2 * c[2][0] + c[1][0]);
      dy = 6 * m * (c[2][1] - 2 * c[1][1] + c[0][1]) + 6 * t * (c[3][1] - 2 * c[2][1] + c[1][1]);
    }
    return [dx, dy];
  }

  // Circle / Path / Vision card: position on the path (layer space), scale %, rotation Z
  function pathCard(v, lut, idx, n, time, W, H) {
    var spd = v['Speed'] / 1000, spc = v['Spacing'] / 100, phase = v['Phase Offset'] / 100, manual = v['Move Carousel'] / 100;
    var pct = ((time * spd) + (idx / n) * spc + phase + manual) % 1;
    if (pct < 0) pct += 1;
    var pos = pointOnPath(lut, pct);
    var a = v['Depth Angle'] * Math.PI / 180, cx = W / 2, cy = H / 2;
    var projected = (pos[0] - cx) * Math.sin(a) + (pos[1] - cy) * Math.cos(a);
    var norm = (projected / Math.sqrt(cx * cx + cy * cy) + 1) / 2;
    var depthScale = linearAE(norm, 0, 1, v['Scale Min'], 100);
    var s = linearAE(v['Scale Depth'] / 100, 0, 1, 100, depthScale) * (v['Global Scale'] / 100);
    var tg = tangentOnPath(lut, pct);
    return { p: pos, s: s, rz: Math.atan2(tg[1], tg[0]) * 180 / Math.PI * v['Rotation Follow'] };
  }

  /*
   * 3D: AE's default comp camera (no camera layer) sits at the comp centre, ZOOM in front of it.
   * Rotations apply Z, then Y, then X (After Effects order). y points down, z into the screen.
   */
  // camera zoom: a style's own camera (Orbit), else AE's default comp camera (50mm preset: 2666.67 for a 1920 comp)
  function camZoom(W, Z) { return Z || W * 1.3888889; }
  function rotX(p, deg) { var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; }
  function rotY(p, deg) { var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; }
  function rotZ(p, deg) { var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; }
  function project(p, W, H, Zc) {
    var Z = camZoom(W, Zc), f = Z / (Z + p[2]);
    return [W / 2 + (p[0] - W / 2) * f, H / 2 + (p[1] - H / 2) * f, f];
  }

  // a card that faces the camera (Vision: Auto-Orient towards camera, Orbit: lookAt): its world corners
  function facingCorners(center, w, h, s, rz, ry, W, H, Zc) {
    var cam = [W / 2, H / 2, -camZoom(W, Zc)];
    var z = [center[0] - cam[0], center[1] - cam[1], center[2] - cam[2]], l = Math.sqrt(z[0] * z[0] + z[1] * z[1] + z[2] * z[2]);
    z = [z[0] / l, z[1] / l, z[2] / l];
    var x = [z[2], 0, -z[0]], lx = Math.sqrt(x[0] * x[0] + x[2] * x[2]); // up (0,1,0) x z
    x = [x[0] / lx, 0, x[2] / lx];
    var y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(function (q) {
      var p = rotY(rotZ([q[0] * s, q[1] * s, 0], rz), ry);
      return project([
        center[0] + x[0] * p[0] + y[0] * p[1] + z[0] * p[2],
        center[1] + x[1] * p[0] + y[1] * p[1] + z[1] * p[2],
        center[2] + x[2] * p[0] + y[2] * p[1] + z[2] * p[2]], W, H, Zc);
    });
  }

  // Vision: card world position through the 3D null (anchor = comp centre, position = centre + off)
  function visionWorld(v, p, W, H, off) {
    off = off || [0, 0, 0];
    var d = [p[0] - W / 2, p[1] - H / 2, 0];
    d = rotX(rotY(d, v['Y slider']), v['X slider']);
    return [d[0] + W / 2 + off[0], d[1] + H / 2 + off[1], d[2] + off[2]];
  }
  function visionRotY(v, world, W, H) {
    var sx = project(world, W, H)[0], rot = easeAE(Math.abs(sx - W / 2), 0, W * (700 / 1920), 0, v['3D Y Angle']);
    return sx < W / 2 ? rot : -rot;
  }

  // Orbit card (index = its layer index, like the expression): world position, scale %, opacity
  function orbitCard(v, index, W, H, Zc, c0) {
    c0 = c0 || [W / 2, H / 2]; // Orbit Control position
    var r = v['Radius'], raw = Math.max(1, v['Element Count']), off = v['Offset'];
    function getP(c) {
      var i = ((index - 0.5 + off) % c + c) % c, ga = Math.PI * (3 - Math.sqrt(5));
      var inc = Math.acos(1 - 2 * (i / c)), azi = ga * i;
      return [Math.sin(inc) * Math.cos(azi) * r, Math.cos(inc) * r, Math.sin(inc) * Math.sin(azi) * r];
    }
    var c1 = Math.floor(raw), a = getP(c1), b = getP(c1 + 1), f = raw % 1;
    var p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    p = rotZ(rotY(rotX(p, v['Rotation X']), v['Rotation Y']), v['Rotation Z']);
    var k = 1 + (index % 2) * 0.01;
    var world = [p[0] * k + c0[0], p[1] * k + c0[1], p[2] * k];
    var cam = [W / 2, H / 2, -camZoom(W, Zc)];
    var dist = function (q) { return Math.sqrt((q[0] - cam[0]) * (q[0] - cam[0]) + (q[1] - cam[1]) * (q[1] - cam[1]) + (q[2] - cam[2]) * (q[2] - cam[2])); };
    var d = dist(world), cd = dist([c0[0], c0[1], 0]);
    var t = clamp(linearAE(d, cd - r, cd + r, 0, 1), 0, 1);
    var s = linearAE(v['Perspective Boost'], 0, 100, 100, linearAE(t, 0, 1, v['Scale Max'], v['Scale Min']));
    return { world: world, s: s, o: index <= Math.floor(v['Element Count']) ? 1 : 0 };
  }

  /* ------------------------------------------------------------------ */
  /* Preview                                                             */
  /* ------------------------------------------------------------------ */

  var canvas = $('crCanvas'), ctx = canvas.getContext('2d');

  // the preview always shows a standard 16:9 frame, whatever the comp size (the comp only gives the fps)
  var PREVIEW = { w: 1920, h: 1080 };
  // the preview always shows 10 sample cards (the layers in AE do not change it)
  var PREVIEW_CARDS = 10, STYLE_CARDS = 9; // Vision, Orbit: 9 cards like the SaaSor style comps
  function orbitZoom() { return PRESETS[4][state.style[4]].zoom; }
  function visionOff() { return PRESETS[3][state.style[3]].nullOff || [0, 0, 0]; }
  function orbitCentre() { return PRESETS[4][state.style[4]].pos || [PREVIEW.w / 2, PREVIEW.h / 2]; }
  function cards() {
    var sv = state.shape >= 3, size = sv ? 266.67 : Math.round(PREVIEW.h * 0.28), out = []; // Vision, Orbit: like the SaaSor style comps
    for (var i = 0, n = sv ? STYLE_CARDS : PREVIEW_CARDS; i < n; i++) out.push({ w: size, h: size, color: SAMPLE[i % SAMPLE.length], index: i + 2 });
    return out;
  }

  function activePath() {
    if (state.rigPath && state.ctrlShape === state.shape) return state.rigPath;
    return stylePath(state.shape, state.style[state.shape]);
  }

  /* ---------- your own paths: saved over a style, kept in the library folder (synced with GitHub) ---------- */

  var custom = {}; // shape -> style index -> path
  function customFile() { return App.path.join(App.lib(), 'carousel-styles.json'); }
  function loadCustom() {
    try { custom = JSON.parse(App.fs.readFileSync(customFile(), 'utf8')).paths || {}; } catch (e) { custom = {}; }
  }
  function saveCustom(message) {
    App.mkdirp(App.lib());
    App.fs.writeFileSync(customFile(), JSON.stringify({ paths: custom }, null, 2), 'utf8');
    if (App.sync) App.sync(message);
  }
  function customPath(sid, idx) { return (custom[sid] && custom[sid][idx]) || null; }
  function stylePath(sid, idx) { return customPath(sid, idx) || PRESETS[sid][idx].path || null; }

  function roundPath(p) {
    var r = function (a) { return a.map(function (q) { return [Math.round(q[0] * 100) / 100, Math.round(q[1] * 100) / 100]; }); };
    return { closed: !!p.closed, v: r(p.v), i: r(p.i), o: r(p.o) };
  }

  var lutCache = { src: null, lut: null };
  function activeLut() {
    var p = activePath();
    if (lutCache.src !== p) lutCache = { src: p, lut: buildLut(p) };
    return lutCache.lut;
  }

  function roundRect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2)); // a hidden / tiny stage must not throw
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // one card per entry: {pts: 4 screen corners in comp px, depth, color, i}
  function layout(time) {
    var v = vals(), W = PREVIEW.w, H = PREVIEW.h, list = cards(), n = list.length, out = [];
    var lut = state.shape === 4 ? null : activeLut();
    list.forEach(function (c, i) {
      var hw = c.w / 2, hh = c.h / 2, corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], pts, depth = 0, alpha = 1;
      if (state.shape === 4) {
        // the expression uses the layer index: the sample cards sit right under the control
        var Z = orbitZoom(), oc = orbitCard(v, c.index, W, H, Z, orbitCentre());
        if (!oc.o || oc.world[2] <= -camZoom(W, Z) + 1) return; // hidden by Element Count, or behind the camera (AE does not draw it)
        pts = facingCorners(oc.world, c.w, c.h, oc.s / 100, 0, 0, W, H, Z);
        depth = oc.world[2];
      } else {
        if (!lut) return;
        var pc2 = pathCard(v, lut, i, n, time, W, H), sc = pc2.s / 100;
        if (state.shape === 3) {
          // the ring is tilted by the null, the cards themselves face the camera (Auto-Orient)
          var world = visionWorld(v, pc2.p, W, H, visionOff());
          pts = facingCorners(world, c.w, c.h, sc, pc2.rz, visionRotY(v, world, W, H), W, H);
          depth = world[2];
        } else {
          pts = corners.map(function (q) {
            var p = rotZ([q[0] * sc, q[1] * sc, 0], pc2.rz);
            return [pc2.p[0] + p[0], pc2.p[1] + p[1]];
          });
        }
      }
      out.push({ pts: pts, depth: depth, color: c.color, i: i, alpha: alpha });
    });
    // far first; 2D cards keep After Effects' layer order (top layer drawn last)
    out.sort(function (a, b) { return Math.abs(a.depth - b.depth) > 1e-6 ? b.depth - a.depth : b.i - a.i; });
    return out;
  }

  function draw() {
    var box = canvas.parentNode.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var Wc = Math.max(10, Math.round(box.width)), Hc = Math.max(10, Math.round(box.height));
    if (canvas.width !== Wc * dpr || canvas.height !== Hc * dpr) {
      canvas.width = Wc * dpr;
      canvas.height = Hc * dpr;
      canvas.style.width = Wc + 'px';
      canvas.style.height = Hc + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, Wc, Hc);

    var cw = PREVIEW.w, ch = PREVIEW.h;
    var k = Math.min((Wc - 16) / cw, (Hc - 16) / ch);
    var fw = cw * k, fh = ch * k, fx = (Wc - fw) / 2, fy = (Hc - fh) / 2;
    ctx.fillStyle = '#060607';
    roundRect(fx, fy, fw, fh, 6);
    ctx.fill();
    ctx.save();
    roundRect(fx, fy, fw, fh, 6);
    ctx.clip();

    // the Path Carousel mask, as a guide (2D shapes only - Vision's ring is tilted)
    var lut = (state.shape === 1 || state.shape === 2) ? activeLut() : null;
    if (lut) {
      ctx.beginPath();
      lut.pts.forEach(function (q, i) {
        if (i) ctx.lineTo(fx + q[0] * k, fy + q[1] * k); else ctx.moveTo(fx + q[0] * k, fy + q[1] * k);
      });
      ctx.strokeStyle = 'rgba(79, 188, 208, .28)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    layout(state.t).forEach(function (it) {
      ctx.globalAlpha = it.alpha;
      ctx.fillStyle = it.color;
      ctx.beginPath();
      it.pts.forEach(function (p, j) {
        if (j) ctx.lineTo(fx + p[0] * k, fy + p[1] * k); else ctx.moveTo(fx + p[0] * k, fy + p[1] * k);
      });
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, .35)';
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function timecode(t) {
    var r = Math.round(state.comp.fps || 30), f = Math.floor(t * r + 1e-6);
    var pad = function (x) { return (x < 10 ? '0' : '') + x; };
    var sec = Math.floor(f / r);
    return Math.floor(sec / 3600) + ':' + pad(Math.floor(sec / 60) % 60) + ':' + pad(sec % 60) + ':' + pad(f % r);
  }

  function frame(now) {
    state.raf = 0;
    if (!state.visible) return;
    if (state.playing) {
      if (state.last) state.t += Math.min(0.1, (now - state.last) / 1000);
      state.last = now;
    }
    draw();
    $('crTc').textContent = timecode(state.t);
    if (state.playing) state.raf = requestAnimationFrame(frame);
  }

  function redraw() {
    if (!state.visible || state.raf) return;
    state.raf = requestAnimationFrame(frame);
  }

  function setPlaying(on) {
    state.playing = on;
    state.last = 0;
    $('crPlay').classList.toggle('paused', !on);
    redraw();
  }

  /* ------------------------------------------------------------------ */
  /* Controls                                                            */
  /* ------------------------------------------------------------------ */

  var rows = {};

  function fmt(s, val) { return s[3] < 1 ? (+val).toFixed(s[3] < 0.1 ? 2 : 1) : String(Math.round(val)); }

  function setValue(key, val, fromUser) {
    vals()[key] = val;
    var r = rows[key];
    if (r) {
      r.range.value = clamp(val, r.s[1], r.s[2]);
      if (document.activeElement !== r.num) r.num.value = fmt(r.s, val);
      r.reset.classList.toggle('changed', Math.abs(val - styleValues(state.shape, state.style[state.shape])[key]) > 1e-6);
    }
    if (fromUser) { queuePush(key); save(); }
    redraw();
  }

  function buildSliders() {
    var box = $('crSliders');
    box.innerHTML = '';
    rows = {};
    shape().sliders.forEach(function (s) {
      var row = document.createElement('div');
      row.className = 'cr-row';
      row.innerHTML =
        '<span class="cr-label" title="Drag left / right to change">' + s[0] + '</span>' +
        '<input type="range" min="' + s[1] + '" max="' + s[2] + '" step="' + s[3] + '">' +
        '<label class="cr-num"><input type="number" step="' + s[3] + '"></label>' +
        '<button class="cr-row-reset" title="Back to the style value"><svg viewBox="0 0 16 16"><path d="M3.5 6.5A5 5 0 1 1 3 9"/><path d="M3 3v3.5h3.5"/></svg></button>';
      var range = row.querySelector('input[type=range]'), num = row.querySelector('input[type=number]');
      var reset = row.querySelector('.cr-row-reset');
      rows[s[0]] = { s: s, range: range, num: num, reset: reset };
      reset.addEventListener('click', function () { setValue(s[0], styleValues(state.shape, state.style[state.shape])[s[0]], true); });
      range.addEventListener('input', function () { setValue(s[0], +range.value, true); });
      num.addEventListener('change', function () {
        var x = parseFloat(num.value);
        if (isNaN(x)) x = vals()[s[0]];
        setValue(s[0], x, true);
        num.value = fmt(s, x);
      });
      num.addEventListener('keydown', function (e) { if (e.key === 'Enter') num.blur(); });
      scrub(row.querySelector('.cr-label'), s);
      box.appendChild(row);
    });
    $('crCtlTitle').textContent = shape().name + ' Control✦';
  }

  // drag the label like an After Effects value (Shift = faster, Ctrl = finer)
  function scrub(label, s) {
    label.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var x0 = e.clientX, v0 = vals()[s[0]], per = (s[2] - s[1]) / 300;
      document.body.classList.add('scrubbing');
      function move(ev) {
        var m = ev.shiftKey ? 10 : ev.ctrlKey ? 0.1 : 1;
        var val = Math.round((v0 + (ev.clientX - x0) * per * m) / s[3]) * s[3];
        setValue(s[0], +val.toFixed(4), true);
      }
      function up() {
        document.body.classList.remove('scrubbing');
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      }
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
  }

  function syncControls() {
    Object.keys(rows).forEach(function (k) { setValue(k, vals()[k], false); });
  }

  // the active style is only highlighted while the preview shows a style (not a linked rig)
  function paintStyles() {
    Array.prototype.forEach.call($('crPresets').children, function (b, j) {
      b.classList.toggle('active', !state.ctrl && j === state.style[state.shape]);
    });
  }

  function buildStyles() {
    var box = $('crPresets');
    box.innerHTML = '';
    PRESETS[state.shape].forEach(function (p, i) {
      var b = document.createElement('button');
      b.textContent = 'Style ' + (i + 1);
      b.classList.toggle('active', !state.ctrl && state.style[state.shape] === i);
      if (customPath(state.shape, i)) b.title = 'Uses your saved path';
      b.addEventListener('click', function () { applyStyle(i, true); });
      box.appendChild(b);
    });
  }

  // a style button shows that style on its own - a linked rig in AE is left alone (the panel unlinks)
  function applyStyle(i, fromUser) {
    if (fromUser && state.ctrl) {
      App.status('Showing Style ' + (i + 1) + '. ' + state.ctrl + ' in AE is unchanged - Create makes this style, Refresh selection edits the rig again.');
      setLink(null, 0);
    }
    state.style[state.shape] = i;
    updatePathBar();
    state.vals[state.shape] = styleValues(state.shape, i);
    paintStyles();
    syncControls();
    save();
    redraw();
  }

  function setShape(sid, fromUser) {
    state.shape = sid;
    Array.prototype.forEach.call($('crStyles').children, function (b) {
      b.classList.toggle('active', +b.getAttribute('data-style') === sid);
    });
    if (!state.vals[sid]) state.vals[sid] = styleValues(sid, state.style[sid]);
    buildStyles();
    buildSliders();
    syncControls();
    updateApplyLabel();
    updatePathBar();
    if (fromUser) save();
    redraw();
  }

  // only the chosen shape / style are remembered - slider values always start from the style itself,
  // so a rig's values (or old tweaks) can never show up under a style button
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ shape: state.shape, style: state.style })); } catch (e) {}
  }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY));
      if (!s || !SHAPES[s.shape]) return;
      state.shape = s.shape;
      [1, 2, 3, 4].forEach(function (k) {
        if (s.style && s.style[k] >= 0 && s.style[k] < 5) state.style[k] = s.style[k];
      });
    } catch (e) {}
  }

  /* ------------------------------------------------------------------ */
  /* Talking to After Effects                                            */
  /* ------------------------------------------------------------------ */

  // linked rig of the same shape: send changed values a moment after the last change (one undo step per pause)
  function queuePush(key) {
    if (!state.ctrl || state.ctrlShape !== state.shape) return;
    state.pending[key] = vals()[key];
    clearTimeout(state.pushTimer);
    state.pushTimer = setTimeout(function () {
      var v = state.pending;
      state.pending = {};
      App.host('carouselSet', state.ctrl, v).then(function (r) {
        if (!r.ok) { App.status(r.error, 'error'); return setLink(null, 0); }
        if (r.skipped) App.status(r.skipped + ' keyframed slider(s) left unchanged - edit them in After Effects.', 'warn');
      });
    }, 150);
  }

  function setLink(name, sid) {
    var wasLinked = state.ctrl ? state.ctrlShape : 0;
    state.ctrl = name;
    state.ctrlShape = sid || 0;
    if (!name) state.rigPath = null;
    // leaving a rig: its values go, the shape shows its selected style again
    if (!name && wasLinked) {
      state.vals[wasLinked] = styleValues(wasLinked, state.style[wasLinked]);
      if (wasLinked === state.shape) syncControls();
    }
    paintStyles();
    var el = $('crLink');
    el.textContent = name || 'not linked';
    el.classList.toggle('on', !!name);
    updateRemove();
    updateApplyLabel();
  }

  // Remove works on whatever carousel is clicked in AE (any shape), or the linked one
  function updateRemove() {
    var on = !!(state.selCtrl || state.ctrl);
    $('crDelete').disabled = !on;
    $('crDelete').title = on ? 'Remove "' + (state.selCtrl || state.ctrl) + '" - the shapes stay, stacked in the comp centre' : 'Click a carousel layer in AE (a card, its Control or Path Carousel) to remove it';
  }

  // polled while the Tools tab is open, so Remove lights up as soon as a carousel layer is clicked
  var selTimer = 0;
  function pollSelection() {
    App.host('carouselSelected').then(function (r) {
      var name = r && r.ok ? r.ctrl : null;
      if (name !== state.selCtrl) { state.selCtrl = name; updateRemove(); }
    });
  }

  function updateApplyLabel() {
    $('crApply').textContent = 'Create ' + shape().name + ' carousel';
  }

  function refresh(quiet) {
    return App.host('carouselInfo').then(function (r) {
      if (!r.ok) { if (!quiet) App.status(r.error, 'error'); return; }
      if (r.comp) state.comp = r.comp;
      var info;
      if (r.layers.length) {
        state.layers = r.layers.map(function (l, i) {
          return {
            w: l.w > 1 ? l.w : 300,
            h: l.h > 1 ? l.h : 300,
            index: l.index,
            color: l.label ? LABELS[l.label] || SAMPLE[i % SAMPLE.length] : SAMPLE[i % SAMPLE.length]
          };
        });
        info = r.comp.name + ' · ' + r.layers.length + ' layer' + (r.layers.length === 1 ? '' : 's') +
          (r.ctrl ? ' driven by ' + r.ctrl : ' selected');
      } else {
        state.layers = null;
        info = (r.comp ? r.comp.name + ' · no' : 'No composition ·') + ' layers selected - showing sample cards. Select layers, then Refresh.';
      }
      $('crInfo').textContent = info;

      if (r.ctrl && SHAPES[r.shape]) {
        setLink(r.ctrl, r.shape);
        state.rigPath = r.path || null;
        state.vals[r.shape] = state.vals[r.shape] || styleValues(r.shape, 0);
        SHAPES[r.shape].sliders.forEach(function (s) {
          if (r.values[s[0]] !== undefined) state.vals[r.shape][s[0]] = +r.values[s[0]];
        });
        setShape(r.shape, false);
      } else {
        setLink(null, 0);
      }
      redraw();
    });
  }

  function apply() {
    var v = vals(), sh = shape();
    var spec = {
      shape: state.shape,
      names: sh.sliders.map(function (s) { return s[0]; }),
      values: sh.sliders.map(function (s) { return +v[s[0]]; }),
      path: state.shape === 4 ? null : stylePath(state.shape, state.style[state.shape]),
      camera: state.shape === 4 ? orbitZoom() : 0,
      ctrlPos: state.shape === 4 ? orbitCentre() : null,
      nullOff: state.shape === 3 ? visionOff() : null
    };
    App.host('carouselApply', spec).then(function (r) {
      if (!r.ok) return App.status(r.error, 'error');
      App.status('"' + r.ctrl + '" created - ' + r.count + ' layers.', 'success');
      refresh(true);
    });
  }

  // the path row: only for the path shapes; "Default" when the style uses a saved path
  function updatePathBar() {
    var sid = state.shape, idx = state.style[sid];
    $('crPathBar').hidden = sid === 4;
    $('crSavePathLabel').textContent = 'Save path to Style ' + (idx + 1);
  }

  // read the path straight from the linked / selected rig in AE and store it over the selected style
  function savePath() {
    var sid = state.shape, idx = state.style[sid];
    App.host('carouselInfo').then(function (r) {
      if (!r.ok) return App.status(r.error, 'error');
      if (!r.ctrl || r.shape !== sid || !r.path) {
        return App.status('Select the ' + SHAPES[sid].name + ' carousel in AE (its Control, Path Carousel or a card), then save.', 'error');
      }
      // replacing a style's path is easy to do by accident (two styles end up identical) - ask first
      var name = SHAPES[sid].name + ' Style ' + (idx + 1);
      App.confirmAction('Save path', 'The path of "' + r.ctrl + '" replaces the path of ' + name + '. Other styles stay as they are.', function () {
        custom[sid] = custom[sid] || {};
        custom[sid][idx] = roundPath(r.path);
        try { saveCustom('Carousel: ' + name + ' path'); } catch (e) { return App.status('Could not save: ' + e.message, 'error'); }
        buildStyles();
        updatePathBar();
        App.status(name + ' now uses your path.', 'success');
        refresh(true);
      }, 'Save to ' + name);
    });
  }

  function del() {
    if (!state.selCtrl && !state.ctrl) return;
    App.host('carouselDelete', state.ctrl || '').then(function (r) {
      if (!r.ok) return App.status(r.error, 'error');
      App.status('"' + r.ctrl + '" removed - ' + r.count + ' layers stay, stacked in the centre.', 'success');
      state.selCtrl = null;
      setLink(null, 0);
      refresh(true);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  load();
  loadCustom();
  setShape(state.shape, false);
  setLink(null, 0);

  Array.prototype.forEach.call($('crStyles').children, function (b) {
    b.addEventListener('click', function () { setShape(+b.getAttribute('data-style'), true); });
  });
  $('crPlay').addEventListener('click', function () { setPlaying(!state.playing); });
  $('crRefresh').addEventListener('click', function () { refresh(false); });
  $('crApply').addEventListener('click', apply);
  $('crDelete').addEventListener('click', del);
  $('crSavePath').addEventListener('click', savePath);
  // Reset: back to the style values - on a linked rig the values go to AE, the link stays
  $('crReset').addEventListener('click', function () {
    if (!state.ctrl) return applyStyle(state.style[state.shape], true);
    var sv = styleValues(state.shape, state.style[state.shape]);
    Object.keys(sv).forEach(function (k) { setValue(k, sv[k], true); });
  });
  window.addEventListener('resize', redraw);

  window.TLTools = {
    setVisible: function (v) {
      state.visible = v;
      if (v) {
        state.last = 0;
        loadCustom(); // may have changed on the other computer
        buildStyles();
        updatePathBar();
        redraw();
        refresh(true);
        clearInterval(selTimer);
        selTimer = setInterval(pollSelection, 700);
        pollSelection();
      } else {
        clearInterval(selTimer);
        if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
      }
    },
    seek: function (t) { state.t = t; setPlaying(false); },
    // exposed for checking the preview against values sampled in After Effects
    math: { pathCard: pathCard, orbitCard: orbitCard, visionWorld: visionWorld, visionRotY: visionRotY, buildLut: buildLut, PRESETS: PRESETS, SHAPES: SHAPES, styleValues: styleValues }
  };
})();
