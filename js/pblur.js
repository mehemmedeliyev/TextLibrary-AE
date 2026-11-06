/* Progressive Blur: preview with draggable Start / End + Add / Remove (TL.progressiveBlurAdd in host.jsx) */
(function () {
  'use strict';

  var App = window.TLApp;
  var $ = function (id) { return document.getElementById(id); };
  var LS_KEY = 'tl.pblur.v1';
  var LEVELS = 8; // the preview stacks this many blur steps along the ramp

  // start / end: 0..1 across the layer (0,0 = top left), like the PB Start / PB End nulls in AE
  var state = { start: [0.5, 0.2], end: [0.5, 0.9], blur: 120, visible: false, drag: null };
  try {
    var saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (saved.start) state.start = saved.start;
    if (saved.end) state.end = saved.end;
    if (saved.blur !== undefined) state.blur = +saved.blur;
  } catch (e) {}
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ start: state.start, end: state.end, blur: state.blur })); } catch (e) {}
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  var canvas = $('pbCanvas'), ctx = canvas.getContext('2d');
  var art = document.createElement('canvas'), actx = art.getContext('2d'); // the sample layer, sharp
  var tmp = document.createElement('canvas'), tctx = tmp.getContext('2d'); // one blur step, masked
  var artKey = '';

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

  // the sample layer: a small poster with detail, so the blur reads
  function box(W, H) {
    var h = H - 24, w = Math.min(W - 24, h * 0.75);
    return { x: (W - w) / 2, y: 12, w: w, h: h };
  }

  function paintArt(b) {
    var g = actx.createLinearGradient(0, b.y, 0, b.y + b.h);
    g.addColorStop(0, '#2b2f6b');
    g.addColorStop(0.55, '#c0587a');
    g.addColorStop(1, '#f2b25c');
    actx.save();
    roundRect(actx, b.x, b.y, b.w, b.h, 10);
    actx.clip();
    actx.fillStyle = g;
    actx.fillRect(b.x, b.y, b.w, b.h);
    actx.fillStyle = 'rgba(255, 236, 200, .95)';
    actx.beginPath();
    actx.arc(b.x + b.w * 0.5, b.y + b.h * 0.42, b.w * 0.2, 0, Math.PI * 2);
    actx.fill();
    actx.fillStyle = '#1d1b33';
    actx.beginPath();
    actx.moveTo(b.x, b.y + b.h * 0.72);
    actx.lineTo(b.x + b.w * 0.3, b.y + b.h * 0.55);
    actx.lineTo(b.x + b.w * 0.55, b.y + b.h * 0.68);
    actx.lineTo(b.x + b.w * 0.8, b.y + b.h * 0.5);
    actx.lineTo(b.x + b.w, b.y + b.h * 0.62);
    actx.lineTo(b.x + b.w, b.y + b.h);
    actx.lineTo(b.x, b.y + b.h);
    actx.closePath();
    actx.fill();
    actx.fillStyle = 'rgba(255, 255, 255, .9)';
    actx.font = '600 ' + Math.round(b.w * 0.11) + 'px Segoe UI, sans-serif';
    actx.textAlign = 'center';
    actx.fillText('TEXT', b.x + b.w / 2, b.y + b.h * 0.18);
    actx.restore();
  }

  function pt(b, f) { return [b.x + f[0] * b.w, b.y + f[1] * b.h]; }

  function draw() {
    var r = canvas.parentNode.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    var W = Math.max(10, Math.round(r.width)), H = Math.max(10, Math.round(r.height));
    [canvas, art, tmp].forEach(function (c) {
      if (c.width !== W * dpr || c.height !== H * dpr) { c.width = W * dpr; c.height = H * dpr; }
    });
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    var b = box(W, H);
    var key = W + 'x' + H + '@' + dpr;
    if (key !== artKey) {
      artKey = key;
      actx.setTransform(dpr, 0, 0, dpr, 0, 0);
      actx.clearRect(0, 0, W, H);
      paintArt(b);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(art, 0, 0);

    // progressive blur: each step is a stronger blur shown from its slice of the ramp onwards
    var s = pt(b, state.start), e = pt(b, state.end);
    var scale = b.h / 1080; // the Blur value is in AE pixels of a ~1080 px tall layer
    if (state.blur > 0 && (s[0] !== e[0] || s[1] !== e[1])) {
      for (var k = 1; k <= LEVELS; k++) {
        tctx.setTransform(1, 0, 0, 1, 0, 0);
        tctx.clearRect(0, 0, tmp.width, tmp.height);
        tctx.globalCompositeOperation = 'source-over';
        tctx.filter = 'blur(' + (state.blur * scale * k / LEVELS * dpr).toFixed(2) + 'px)';
        tctx.drawImage(art, 0, 0);
        tctx.filter = 'none';
        tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var g = tctx.createLinearGradient(s[0], s[1], e[0], e[1]);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop((k - 1) / LEVELS, 'rgba(0,0,0,0)');
        g.addColorStop(k / LEVELS, '#000');
        g.addColorStop(1, '#000');
        tctx.globalCompositeOperation = 'destination-in';
        tctx.fillStyle = g;
        tctx.fillRect(0, 0, W, H);
        ctx.drawImage(tmp, 0, 0);
      }
    }

    // the ramp: dashed line, Start (hollow = sharp) and End (filled = blurred)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = 'rgba(255, 255, 255, .7)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(s[0], s[1]);
    ctx.lineTo(e[0], e[1]);
    ctx.stroke();
    ctx.setLineDash([]);
    handle(s, false, 'Start');
    handle(e, true, 'End');
  }

  function handle(p, filled, label) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], 6, 0, Math.PI * 2);
    ctx.fillStyle = filled ? '#9b8cf0' : 'rgba(20, 20, 24, .85)';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = '600 10px Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(0, 0, 0, .6)';
    ctx.fillText(label, p[0] + 10, p[1] + 4);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, p[0] + 9, p[1] + 3);
  }

  var raf = 0;
  function redraw() {
    if (!state.visible || raf) return;
    raf = requestAnimationFrame(function () { raf = 0; draw(); });
  }

  /* ---------- dragging Start / End ---------- */

  function local(ev) {
    var r = canvas.getBoundingClientRect(), b = box(r.width, r.height);
    return { b: b, f: [(ev.clientX - r.left - b.x) / b.w, (ev.clientY - r.top - b.y) / b.h], x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  canvas.addEventListener('mousedown', function (ev) {
    var l = local(ev), s = pt(l.b, state.start), e = pt(l.b, state.end);
    var ds = Math.hypot(l.x - s[0], l.y - s[1]), de = Math.hypot(l.x - e[0], l.y - e[1]);
    // grab the nearer handle (a click anywhere moves it there)
    state.drag = ds <= de ? 'start' : 'end';
    canvas.parentNode.classList.add('grab');
    move(ev);
    ev.preventDefault();
  });
  function move(ev) {
    if (!state.drag) return;
    var f = local(ev).f;
    state[state.drag] = [clamp(f[0], -0.25, 1.25), clamp(f[1], -0.25, 1.25)];
    redraw();
  }
  window.addEventListener('mousemove', move);
  window.addEventListener('mouseup', function () {
    if (!state.drag) return;
    state.drag = null;
    canvas.parentNode.classList.remove('grab');
    save();
  });

  /* ---------- Blur ---------- */

  function setBlur(v) {
    v = clamp(Math.round(+v || 0), 0, 500);
    state.blur = v;
    save();
    $('pbBlur').value = v;
    $('pbBlurNum').value = v;
    redraw();
  }
  $('pbBlur').addEventListener('input', function () { setBlur(this.value); });
  $('pbBlurNum').addEventListener('change', function () { setBlur(this.value); });

  /* ---------- Add / Remove ---------- */

  $('pbApply').addEventListener('click', function () {
    App.host('progressiveBlurAdd', state.start, state.end, state.blur).then(function (r) {
      if (!r.ok) return App.status(r.error, 'error');
      var n = (r.nums || [1])[0];
      App.status('Progressive Blur' + (n > 1 ? ' ' + n : '') + ' added' + (r.count > 1 ? ' to ' + r.count + ' layers' : '') + ' - move PB Start / PB End in AE to adjust.', 'success');
    });
  });
  $('pbRemove').addEventListener('click', function () {
    App.host('progressiveBlurRemove').then(function (r) {
      if (!r.ok) return App.status(r.error, 'error');
      App.status((r.count === 1 ? 'Progressive Blur removed.' : r.count + ' Progressive Blurs removed.'), 'success');
    });
  });

  window.addEventListener('resize', redraw);
  setBlur(state.blur);

  window.TLPBlur = {
    setVisible: function (v) {
      state.visible = v;
      if (v) redraw();
    }
  };
})();
