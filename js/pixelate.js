/* PixelateClick: preview + "Add effect" for the block-noise reveal rig (TL.pixelateAdd in host.jsx) */
(function () {
  'use strict';

  var App = window.TLApp;
  var $ = function (id) { return document.getElementById(id); };
  var LS_KEY = 'tl.pixelate.v1';

  // timings of the original rig (seconds) - the same numbers host.jsx uses; Duration stretches them
  var MASK_DUR = 1.75, RING_DUR = 1.683, LEAD = 0.25;
  var MASK_END = 1050.75; // reveal circle radius at the end in the original rig
  var TEAL = [0, 255, 228];

  // the Wave table: [key, label, min, max, step, default, unit, tooltip] - % of the original rig unless noted
  var WAVE = [
    ['dur', 'Duration', 0.3, 5, 0.05, 1.75, 's', 'How long the whole effect takes'],
    ['pixel', 'Pixel size', 1, 300, 1, 100, '%', 'Size of the pixel squares - the edge grid follows them'],
    ['width', 'Width', 20, 300, 5, 100, '%', 'How wide the band of pixels is'],
    ['lead', 'Lead', 50, 200, 5, 100, '%', 'How far the wave runs ahead of the layer'],
    ['tail', 'Tail', 10, 300, 5, 100, '%', 'How long the end of the wave takes to fade out'],
    ['soft', 'Softness', 0, 300, 5, 100, '%', 'Blur of the wave and of the reveal edge'],
    ['glow', 'Glow', 0, 300, 5, 100, '%', 'Strength of the glow (0 = no glow)'],
    ['edges', 'Edges', 0, 100, 5, 100, '%', 'Strength of the grid lines'],
    ['lines', 'Line width', 0, 500, 5, 100, '%', 'Thickness of the grid lines (0 = no lines)'],
    ['speed', 'Noise speed', 0, 300, 5, 100, '%', 'How fast the squares change colour']
  ];
  function waveDefaults() {
    var w = {};
    WAVE.forEach(function (s) { w[s[0]] = s[5]; });
    return w;
  }

  // color: the last colour Auto color found (0..1), the preview uses it while Auto color is on
  // mode: 'in' appear, 'out' disappear (appear played backwards), 'static' always visible
  var state = { mode: 'in', origin: [0, 0], wave: waveDefaults(), auto: false, color: null, visible: false, playing: true, t: 0, last: 0, raf: 0 };
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (saved.mode) state.mode = saved.mode;
    if (saved.origin) state.origin = saved.origin;
    if (saved.pixel) state.wave.pixel = saved.pixel; // before the Wave table
    Object.keys(saved.wave || {}).forEach(function (k) { if (k in state.wave) state.wave[k] = +saved.wave[k]; });
    state.auto = !!saved.auto;
    state.color = saved.color || null;
  } catch (e) {}
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ mode: state.mode, origin: state.origin, wave: state.wave, auto: state.auto, color: state.color })); } catch (e) {}
  }
  function loop() { return state.wave.dur + 0.85; } // preview: the effect, then a short hold

  // the effect colour at full brightness: aqua, or the layer's colour with Auto color
  function tint() {
    return state.auto && state.color ? state.color.map(function (v) { return v * 255; }) : TEAL;
  }
  function rgb(c, f, a) {
    return 'rgba(' + Math.round(c[0] * f) + ',' + Math.round(c[1] * f) + ',' + Math.round(c[2] * f) + ',' + (a === undefined ? 1 : a) + ')';
  }

  var canvas = $('pxCanvas'), ctx = canvas.getContext('2d');
  var off = document.createElement('canvas'), octx = off.getContext('2d'); // design + reveal, masked by the circle
  var fx = document.createElement('canvas'), fctx = fx.getContext('2d');  // noise blocks, masked by the ring

  /* AE ease: first key ease out 33%, second key full ease in (speed 0 on both) */
  function ease(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var x1 = 1 / 3, x2 = 0, lo = 0, hi = 1, u = x;
    for (var i = 0; i < 24; i++) {
      u = (lo + hi) / 2;
      var bx = 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
      if (bx < x) lo = u; else hi = u;
    }
    return 3 * (1 - u) * u * u + u * u * u; // y1 = 0, y2 = 1
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function roundRect(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  // a sample "design" layer: a small profile card
  function drawDesign(c, b) {
    var u = b.h / 10;
    c.fillStyle = '#dcdcdc';
    roundRect(c, b.x, b.y, b.w, b.h, u * 1.6);
    c.fill();
    c.fillStyle = '#4f4f53';
    roundRect(c, b.x + u * 0.55, b.y + u * 0.55, b.w - u * 1.1, b.h - u * 1.1, u * 1.15);
    c.fill();
    c.fillStyle = '#d8d8dc';
    c.beginPath();
    c.arc(b.x + u * 2.6, b.y + u * 4.6, u * 1.15, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#e9e9ec';
    roundRect(c, b.x + u * 4.3, b.y + u * 3.9, b.w * 0.3, u * 0.55, u * 0.27);
    c.fill();
    c.fillStyle = '#9a9aa0';
    roundRect(c, b.x + u * 4.3, b.y + u * 4.9, b.w * 0.42, u * 0.45, u * 0.22);
    c.fill();
    c.fillStyle = '#2f2f33';
    var bw = (b.w - u * 3.4) / 2;
    roundRect(c, b.x + u * 1.4, b.y + u * 6.7, bw, u * 1.5, u * 0.45);
    c.fill();
    roundRect(c, b.x + u * 2 + bw, b.y + u * 6.7, bw, u * 1.5, u * 0.45);
    c.fill();
  }

  // block noise value 0..1 for a cell - slowly changing like Evolution = time * 200
  function noise(i, j, t) {
    var s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    var seed = s - Math.floor(s);
    // mostly mid greys (teal after Tritone), a few near black / white (dark blocks)
    return clamp(0.5 + 0.42 * Math.sin(seed * 40 + t * (1.5 + seed * 2.5)) * (0.4 + seed), 0, 1);
  }

  function sizeCanvas(c, w, h) {
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  function cardBox(W, H) {
    var w = Math.min(W * 0.62, H * 0.5 * 2.15), h = w / 2.15;
    return { x: (W - w) / 2, y: (H - h) / 2, w: w, h: h };
  }

  function draw() {
    var box = canvas.parentNode.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var W = Math.max(10, Math.round(box.width)), H = Math.max(10, Math.round(box.height));
    sizeCanvas(canvas, W * dpr, H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    sizeCanvas(off, W * dpr, H * dpr);
    sizeCanvas(fx, W * dpr, H * dpr);
    [ctx, octx, fctx].forEach(function (c) {
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
      c.clearRect(0, 0, W, H);
    });

    var b = cardBox(W, H);
    var ox = b.x + state.origin[0] * b.w, oy = b.y + state.origin[1] * b.h;
    var R = 0;
    [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].forEach(function (p) {
      R = Math.max(R, Math.sqrt((p[0] - ox) * (p[0] - ox) + (p[1] - oy) * (p[1] - oy)));
    });
    var k = R * 1.1 / MASK_END; // same fit as in After Effects: the circle reaches the farthest corner
    var w = state.wave;
    var real = state.t % loop() - LEAD; // seconds on the timeline
    var t = real * MASK_DUR / w.dur;     // the same moment in the original 1.75 s rig
    var fadeAt = Math.max(0.02, RING_DUR - 0.5 * w.tail / 100);

    // the layer's place: a faint outline, so an empty frame still shows where the reveal goes
    ctx.strokeStyle = 'rgba(255, 255, 255, .08)';
    ctx.setLineDash([3, 4]);
    roundRect(ctx, b.x, b.y, b.w, b.h, b.h / 10 * 1.6);
    ctx.stroke();
    ctx.setLineDash([]);

    // at: time inside the appear animation - Disappear plays it backwards, Static only runs the ring
    var at = state.mode === 'out' ? MASK_DUR - t : t;
    var rt = state.mode === 'static' ? t : at;
    var e = state.mode === 'static' ? 1 : ease(at / MASK_DUR);
    if (e > 0) {
      // 1. the design
      drawDesign(octx, b);

      // 2. the noise ring (Reveal + Reveal edges), only on the design
      var s1 = 4.24 * w.lead / 100 * ease(rt / RING_DUR) * 0.9898 * k;
      var ringOp = rt < fadeAt ? 1 : 1 - ease((rt - fadeAt) / (RING_DUR - fadeAt));
      if (s1 > 0 && ringOp > 0) {
        var cell = Math.max(1, w.pixel * 0.9898 * k); // Fractal Noise Scale = pixel size
        var i0 = Math.floor((b.x - ox) / cell), i1 = Math.ceil((b.x + b.w - ox) / cell);
        var j0 = Math.floor((b.y - oy) / cell), j1 = Math.ceil((b.y + b.h - oy) / cell);
        var col = tint();
        for (var i = i0; i < i1; i++) {
          for (var j = j0; j < j1; j++) {
            var v = 1 - Math.abs(2 * noise(i, j, real * 3.5 * w.speed / 100) - 1); // Tritone: mid grey -> colour, black / white -> black
            fctx.fillStyle = rgb(col, v);
            fctx.fillRect(ox + i * cell, oy + j * cell, cell + 0.5, cell + 0.5);
          }
        }
        // Find Edges passes: thin glowing lines on the block borders
        fctx.globalCompositeOperation = 'lighter';
        fctx.strokeStyle = rgb(col, 0.67, 0.9 * w.edges / 100);
        fctx.lineWidth = w.lines / 100;
        fctx.beginPath();
        for (i = i0; i <= i1; i++) { fctx.moveTo(ox + i * cell, oy + j0 * cell); fctx.lineTo(ox + i * cell, oy + j1 * cell); }
        for (j = j0; j <= j1; j++) { fctx.moveTo(ox + i0 * cell, oy + j * cell); fctx.lineTo(ox + i1 * cell, oy + j * cell); }
        if (w.lines > 0) fctx.stroke(); // lineWidth 0 would be ignored by canvas

        // the blurred green ring (stroke 295 around radius 396) masks the noise;
        // Fast Box Blur runs 3 iterations, so its soft edge is about 2.5x the radius
        var mid = 396 * s1, half = 147.5 * w.width / 100 * s1;
        var blur = 50 * 2.5 * w.soft / 100 * s1, outer = Math.max(1, mid + half + blur);
        var g = fctx.createRadialGradient(ox, oy, 0, ox, oy, outer);
        var st = function (r) { return clamp(r / outer, 0, 1); };
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(st(mid - half - blur), 'rgba(0,0,0,0)');
        g.addColorStop(Math.max(st(mid - half - blur), st(mid - half + blur)), 'rgba(0,0,0,' + ringOp + ')');
        g.addColorStop(Math.max(st(mid - half + blur), st(mid + half - blur)), 'rgba(0,0,0,' + ringOp + ')');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        fctx.globalCompositeOperation = 'destination-in';
        fctx.fillStyle = g;
        fctx.fillRect(0, 0, W, H);

        // Deep Glow: a soft added copy under the crisp blocks
        octx.save();
        roundRect(octx, b.x, b.y, b.w, b.h, b.h / 10 * 1.6);
        octx.clip();
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.drawImage(fx, 0, 0);
        if (w.glow > 0) {
          octx.globalCompositeOperation = 'lighter';
          octx.globalAlpha = Math.min(1, 0.5 * w.glow / 100);
          octx.filter = 'blur(' + Math.round(6 * dpr * Math.max(0.5, Math.sqrt(w.glow / 100))) + 'px)';
          octx.drawImage(fx, 0, 0);
          octx.filter = 'none';
        }
        octx.restore();
      }

      // 3. the blurred white circle (Ui reveal layer) is the matte of everything - Static has none
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (state.mode !== 'static') {
        var sm = 2.87091 * e * k, r = 366 * sm, bm = 43 * 2.5 * w.soft / 100 * sm, ro = Math.max(1, r + bm);
        var gm = octx.createRadialGradient(ox, oy, 0, ox, oy, ro);
        gm.addColorStop(0, '#000');
        gm.addColorStop(clamp((r - bm) / ro, 0, 1), '#000');
        gm.addColorStop(1, 'rgba(0,0,0,0)');
        octx.globalCompositeOperation = 'destination-in';
        octx.globalAlpha = 1;
        octx.fillStyle = gm;
        octx.fillRect(0, 0, W, H);
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(off, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // the start point
    ctx.strokeStyle = rgb(tint(), 0.8, 0.9);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ox, oy, 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  function frame(now) {
    state.raf = 0;
    if (!state.visible) return;
    if (state.playing) {
      if (state.last) state.t += Math.min(0.1, (now - state.last) / 1000);
      state.last = now;
    }
    draw();
    if (state.playing) state.raf = requestAnimationFrame(frame);
  }

  function redraw() {
    if (!state.visible || state.raf) return;
    state.raf = requestAnimationFrame(frame);
  }

  function setPlaying(on) {
    state.playing = on;
    state.last = 0;
    $('pxPlay').classList.toggle('paused', !on);
    redraw();
  }

  /* ---------- start point: 3 x 3 picker, or a click on the preview ---------- */

  function setOrigin(o) {
    state.origin = o;
    save();
    Array.prototype.forEach.call($('pxOrigin').children, function (btn) {
      btn.classList.toggle('active', +btn.getAttribute('data-x') === o[0] && +btn.getAttribute('data-y') === o[1]);
    });
    if (!state.playing) state.t = LEAD + state.wave.dur * 0.45; // paused: show the reveal half open
    redraw();
    liveUpdate();
  }

  var NAMES = { '0': 'top', '0.5': 'middle', '1': 'bottom' }, COLS = { '0': 'left', '0.5': 'centre', '1': 'right' };
  [0, 0.5, 1].forEach(function (y) {
    [0, 0.5, 1].forEach(function (x) {
      var btn = document.createElement('button');
      btn.setAttribute('data-x', x);
      btn.setAttribute('data-y', y);
      btn.title = x === 0.5 && y === 0.5 ? 'Centre' : NAMES[y] + ' ' + COLS[x];
      btn.addEventListener('click', function () { setOrigin([x, y]); });
      $('pxOrigin').appendChild(btn);
    });
  });

  canvas.addEventListener('click', function (ev) {
    var r = canvas.getBoundingClientRect(), b = cardBox(r.width, r.height);
    var snap = function (v) { return Math.round(clamp(v, 0, 1) * 2) / 2; };
    setOrigin([snap((ev.clientX - r.left - b.x) / b.w), snap((ev.clientY - r.top - b.y) / b.h)]);
  });

  /* ---------- the Wave table ---------- */

  var rows = {};
  function fmt(s, v) { return s[4] < 1 ? (+v).toFixed(2) : String(Math.round(v)); }

  function setWave(key, v) {
    var s = rows[key].spec;
    v = +v;
    if (isNaN(v)) v = s[5];
    // the number box may go past the slider range (host.jsx clamps to its own limits)
    v = s[0] === 'dur' ? clamp(v, 0.2, 20) : clamp(v, 0, 1000);
    state.wave[key] = v;
    save();
    rows[key].range.value = v;
    rows[key].num.value = fmt(s, v);
    rows[key].row.classList.toggle('changed', Math.abs(v - s[5]) > 1e-6);
    redraw();
    liveUpdate();
  }

  WAVE.forEach(function (s) {
    var row = document.createElement('div');
    row.className = 'cr-row px-row';
    row.title = s[7];
    var label = document.createElement('span');
    label.className = 'cr-label';
    label.textContent = s[1] + (s[6] === 's' ? ' (s)' : '');
    var range = document.createElement('input');
    range.type = 'range';
    range.min = s[2]; range.max = s[3]; range.step = s[4];
    var box = document.createElement('label');
    box.className = 'cr-num';
    var num = document.createElement('input');
    num.type = 'number';
    num.step = s[4];
    box.appendChild(num);
    row.appendChild(label); row.appendChild(range); row.appendChild(box);
    $('pxSliders').appendChild(row);
    rows[s[0]] = { spec: s, row: row, range: range, num: num };
    range.addEventListener('input', function () { setWave(s[0], range.value); });
    num.addEventListener('change', function () { setWave(s[0], num.value); });
    label.addEventListener('dblclick', function () { setWave(s[0], s[5]); }); // double-click a label: back to the original
  });

  $('pxReset').addEventListener('click', function () {
    WAVE.forEach(function (s) { setWave(s[0], s[5]); });
  });

  /* ---------- mode: Appear / Disappear / Static ---------- */

  function setMode(m) {
    state.mode = m;
    save();
    Array.prototype.forEach.call($('pxModes').children, function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-mode') === m);
    });
    state.t = 0; // start the loop again so the new mode shows from the beginning
    state.last = 0;
    redraw();
    liveUpdate();
  }
  Array.prototype.forEach.call($('pxModes').children, function (btn) {
    btn.addEventListener('click', function () { setMode(btn.getAttribute('data-mode')); });
  });

  /* ---------- Auto color ---------- */

  function setAuto(on) {
    state.auto = on;
    save();
    $('pxAuto').checked = on;
    var sw = $('pxSwatch');
    sw.hidden = !(on && state.color);
    if (state.color) sw.style.background = rgb(state.color, 255);
    redraw();
  }
  $('pxAuto').addEventListener('change', function () { setAuto(this.checked); liveUpdate(); });

  /* ---------- live update: after Add effect, changes rebuild the effect on the layer ---------- */

  // the rig is rebuilt on the selected layers that have it (same start time / colour), a moment after
  // the last change; only one rebuild runs at a time, a change during it queues one more
  var live = { on: false, timer: 0, busy: false, again: false };
  function hostOpts(update) {
    var opts = { mode: state.mode, auto: state.auto, update: !!update };
    Object.keys(state.wave).forEach(function (k) { opts[k] = state.wave[k]; });
    return opts;
  }
  function liveUpdate() {
    if (!live || !live.on) return; // (also called while the panel is still setting up)
    clearTimeout(live.timer);
    live.timer = setTimeout(runUpdate, 300);
  }
  function runUpdate() {
    if (live.busy) { live.again = true; return; }
    live.busy = true;
    App.host('pixelateAdd', state.origin[0], state.origin[1], hostOpts(true)).then(function (r) {
      live.busy = false;
      if (r.ok && r.count) App.status('PixelateClick updated on ' + (r.count === 1 ? 'the layer' : r.count + ' layers') + '.', 'success');
      else if (!r.ok) App.status(r.error, 'error');
      if (live.again) { live.again = false; runUpdate(); }
    });
  }

  /* ---------- Add effect ---------- */

  function apply() {
    var opts = hostOpts(false);
    App.host('pixelateAdd', state.origin[0], state.origin[1], opts).then(function (r) {
      if (!r.ok) return App.status(r.error, 'error');
      live.on = true; // from now on the Wave table, start point and mode update the effect in AE
      var what = r.count === 1 ? 'the layer' : r.count + ' layers';
      var msg = 'PixelateClick (' + { 'in': 'Appear', out: 'Disappear', 'static': 'Static' }[state.mode] + ') added to ' + what;
      if (state.auto) {
        var found = (r.colors || []).filter(Boolean);
        if (found.length) {
          state.color = found[found.length - 1];
          setAuto(true);
          msg += ' - colour taken from the layer';
        } else {
          msg += ' - no clear colour in the layer, aqua is used';
        }
      }
      if (r.glow === 'Glow') msg += ' - Deep Glow is not installed, Glow is used instead';
      App.status(msg + '.', 'success');
    });
  }

  $('pxPlay').addEventListener('click', function () { setPlaying(!state.playing); });
  $('pxApply').addEventListener('click', apply);
  $('pxRemove').addEventListener('click', function () {
    App.host('pixelateRemove').then(function (r) {
      if (!r.ok) return App.status(r.error, 'error');
      live.on = false;
      App.status('PixelateClick removed from ' + (r.count === 1 ? 'the layer' : r.count + ' layers') + ' - back to static.', 'success');
    });
  });
  window.addEventListener('resize', redraw);
  setOrigin(state.origin);
  WAVE.forEach(function (s) { setWave(s[0], state.wave[s[0]]); });
  setAuto(state.auto);
  setMode(state.mode);

  window.TLPixelate = {
    setVisible: function (v) {
      if (v === state.visible) return;
      state.visible = v;
      state.last = 0;
      if (v) redraw();
      else if (state.raf) { cancelAnimationFrame(state.raf); state.raf = 0; }
    },
    seek: function (t) { state.t = LEAD + t; setPlaying(false); } // seconds into the reveal
  };
})();
