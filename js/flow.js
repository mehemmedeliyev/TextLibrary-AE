/* Text Library - Flow tab: cubic-bezier easing preview, editor and presets */
(function () {
  'use strict';

  var App = window.TLApp;
  var $ = function (id) { return document.getElementById(id); };
  var SVGNS = 'http://www.w3.org/2000/svg';

  var DEFAULTS = [
    ['linear', 0, 0, 1, 1], ['easeIn', 0.42, 0, 1, 1], ['easeOut', 0, 0, 0.58, 1], ['ease', 0.42, 0, 0.58, 1],
    ['sineIn', 0.12, 0, 0.39, 0], ['sineOut', 0.61, 1, 0.88, 1], ['sine', 0.37, 0, 0.63, 1],
    ['quadIn', 0.11, 0, 0.5, 0], ['quadOut', 0.5, 1, 0.89, 1], ['quad', 0.45, 0, 0.55, 1],
    ['cubicIn', 0.32, 0, 0.67, 0], ['cubicOut', 0.33, 1, 0.68, 1], ['cubic', 0.65, 0, 0.35, 1],
    ['quartIn', 0.5, 0, 0.75, 0], ['quartOut', 0.25, 1, 0.5, 1], ['quart', 0.76, 0, 0.24, 1],
    ['quintIn', 0.64, 0, 0.78, 0], ['quintOut', 0.22, 1, 0.36, 1], ['quint', 0.83, 0, 0.17, 1],
    ['expoIn', 0.7, 0, 0.84, 0], ['expoOut', 0.16, 1, 0.3, 1], ['expo', 0.87, 0, 0.13, 1],
    ['circIn', 0.55, 0, 1, 0.45], ['circOut', 0, 0.55, 0.45, 1], ['circ', 0.85, 0, 0.15, 1],
    ['backIn', 0.36, 0, 0.66, -0.56], ['backOut', 0.34, 1.56, 0.64, 1], ['back', 0.68, -0.6, 0.32, 1.6]
  ].map(function (d) { return { name: d[0], v: d.slice(1) }; });

  var Y_MIN = -0.4, Y_MAX = 1.4;
  var MOVE_MS = 1000, HOLD_MS = 450;

  var state = {
    cur: [0.87, 0, 0.13, 1],
    selected: { set: 'default', name: 'expo' },
    custom: [],
    visible: false,
    raf: null,
    startedAt: 0
  };

  /* ------------------------------------------------------------------ */
  /* Math                                                                */
  /* ------------------------------------------------------------------ */

  function bezierY(c, t) {
    var x1 = c[0], y1 = c[1], x2 = c[2], y2 = c[3];
    function bx(s) { var m = 1 - s; return 3 * m * m * s * x1 + 3 * m * s * s * x2 + s * s * s; }
    function by(s) { var m = 1 - s; return 3 * m * m * s * y1 + 3 * m * s * s * y2 + s * s * s; }
    function dbx(s) { var m = 1 - s; return 3 * m * m * x1 + 6 * m * s * (x2 - x1) + 3 * s * s * (1 - x2); }
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    var s = t, i;
    for (i = 0; i < 8; i++) {
      var d = dbx(s);
      if (Math.abs(d) < 1e-6) break;
      var next = s - (bx(s) - t) / d;
      if (next < 0 || next > 1) break;
      s = next;
      if (Math.abs(bx(s) - t) < 1e-6) return by(s);
    }
    var lo = 0, hi = 1;
    s = t;
    for (i = 0; i < 40; i++) {
      var x = bx(s);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = s; else hi = s;
      s = (lo + hi) / 2;
    }
    return by(s);
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function round(v, d) { var m = Math.pow(10, d); return Math.round(v * m) / m; }
  function fmt(c) { return c.map(function (v) { return v.toFixed(2); }).join(', '); }

  /* ------------------------------------------------------------------ */
  /* Storage (inside the library folder)                                 */
  /* ------------------------------------------------------------------ */

  function storeFile() { return App.path.join(App.lib(), 'flow-curves.json'); }

  function loadCustom() {
    try {
      var data = JSON.parse(App.fs.readFileSync(storeFile(), 'utf8'));
      state.custom = (data.curves || []).filter(function (c) { return c && c.name && c.v && c.v.length === 4; });
    } catch (e) {
      state.custom = [];
    }
  }

  function saveCustom() {
    App.mkdirp(App.lib());
    App.fs.writeFileSync(storeFile(), JSON.stringify({ curves: state.custom }, null, 2), 'utf8');
  }

  /* ------------------------------------------------------------------ */
  /* SVG helpers                                                         */
  /* ------------------------------------------------------------------ */

  function el(name, attrs, parent) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  function curvePath(c, sx, sy) {
    return 'M' + sx(0) + ' ' + sy(0) +
      ' C' + sx(c[0]) + ' ' + sy(c[1]) + ' ' + sx(c[2]) + ' ' + sy(c[3]) + ' ' + sx(1) + ' ' + sy(1);
  }

  /* ------------------------------------------------------------------ */
  /* Editor                                                              */
  /* ------------------------------------------------------------------ */

  var ED = { x0: 20, w: 180, y0: 170, h: 120 };
  function esx(x) { return ED.x0 + x * ED.w; }
  function esy(v) { return ED.y0 - v * ED.h; }

  var editor = $('flowEditor');
  var ed = {};

  function buildEditor() {
    editor.innerHTML = '';
    el('rect', { x: 0, y: 0, width: 220, height: 220, class: 'ed-bg' }, editor);
    for (var i = 0; i <= 4; i++) {
      el('line', { x1: esx(i / 4), y1: esy(Y_MIN), x2: esx(i / 4), y2: esy(Y_MAX), class: 'ed-grid' }, editor);
      el('line', { x1: esx(0), y1: esy(i / 4), x2: esx(1), y2: esy(i / 4), class: 'ed-grid' }, editor);
    }
    el('line', { x1: esx(0), y1: esy(0), x2: esx(1), y2: esy(0), class: 'ed-unit' }, editor);
    el('line', { x1: esx(0), y1: esy(1), x2: esx(1), y2: esy(1), class: 'ed-unit' }, editor);
    ed.l1 = el('line', { class: 'ed-arm' }, editor);
    ed.l2 = el('line', { class: 'ed-arm' }, editor);
    ed.curve = el('path', { class: 'ed-curve' }, editor);
    el('circle', { cx: esx(0), cy: esy(0), r: 3.5, class: 'ed-end' }, editor);
    el('circle', { cx: esx(1), cy: esy(1), r: 3.5, class: 'ed-end' }, editor);
    ed.h1 = el('circle', { r: 7, class: 'ed-handle', 'data-h': 1 }, editor);
    ed.h2 = el('circle', { r: 7, class: 'ed-handle', 'data-h': 2 }, editor);
    [ed.h1, ed.h2].forEach(function (h) { h.addEventListener('pointerdown', startDrag); });
  }

  function drawEditor() {
    var c = state.cur;
    ed.curve.setAttribute('d', curvePath(c, esx, esy));
    setAttrs(ed.l1, { x1: esx(0), y1: esy(0), x2: esx(c[0]), y2: esy(c[1]) });
    setAttrs(ed.l2, { x1: esx(1), y1: esy(1), x2: esx(c[2]), y2: esy(c[3]) });
    setAttrs(ed.h1, { cx: esx(c[0]), cy: esy(c[1]) });
    setAttrs(ed.h2, { cx: esx(c[2]), cy: esy(c[3]) });
  }

  function setAttrs(n, a) { for (var k in a) if (a.hasOwnProperty(k)) n.setAttribute(k, a[k]); }

  var drag = null;

  function svgPoint(evt) {
    var pt = editor.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    return pt.matrixTransform(editor.getScreenCTM().inverse());
  }

  function startDrag(evt) {
    evt.preventDefault();
    drag = { h: +evt.target.getAttribute('data-h'), id: evt.pointerId };
    editor.setPointerCapture(evt.pointerId);
  }

  editor.addEventListener('pointermove', function (evt) {
    if (!drag) return;
    var p = svgPoint(evt);
    var x = round(clamp((p.x - ED.x0) / ED.w, 0, 1), 3);
    var y = round(clamp((ED.y0 - p.y) / ED.h, Y_MIN, Y_MAX), 3);
    var c = state.cur.slice(0);
    if (drag.h === 1) { c[0] = x; c[1] = y; } else { c[2] = x; c[3] = y; }
    setCurve(c, null);
  });

  function endDrag(evt) {
    if (!drag) return;
    try { editor.releasePointerCapture(drag.id); } catch (e) {}
    drag = null;
  }
  editor.addEventListener('pointerup', endDrag);
  editor.addEventListener('pointercancel', endDrag);

  /* ------------------------------------------------------------------ */
  /* Preview (ball moving left -> right)                                 */
  /* ------------------------------------------------------------------ */

  var preview = $('flowPreview'), ball = $('flowBall'), ticks = $('flowGhosts');
  var BALL = 14, PAD = 24, TICKS = 24; // 24 steps ~ one second at 24 fps

  function travel() {
    var w = preview.clientWidth;
    return { from: PAD, dist: Math.max(10, w - PAD * 2 - BALL) };
  }

  // One tick per frame step: dense ticks = slow, wide gaps = fast
  function drawGhosts() {
    ticks.innerHTML = '';
    var tr = travel();
    for (var i = 0; i <= TICKS; i++) {
      var g = document.createElement('span');
      g.className = 'flow-tick';
      g.style.left = (tr.from + BALL / 2 + bezierY(state.cur, i / TICKS) * tr.dist) + 'px';
      ticks.appendChild(g);
    }
  }

  function frame(now) {
    if (!state.visible) { state.raf = null; return; }
    var cycle = MOVE_MS + HOLD_MS;
    var e = (now - state.startedAt) % cycle;
    var t = Math.min(1, e / MOVE_MS);
    var tr = travel();
    ball.style.transform = 'translateX(' + (tr.from + bezierY(state.cur, t) * tr.dist) + 'px)';
    state.raf = requestAnimationFrame(frame);
  }

  function restartPreview() {
    state.startedAt = performance.now();
    drawGhosts();
    if (state.visible && !state.raf) state.raf = requestAnimationFrame(frame);
  }

  window.addEventListener('resize', function () { if (state.visible) drawGhosts(); });

  /* ------------------------------------------------------------------ */
  /* Preset lists                                                        */
  /* ------------------------------------------------------------------ */

  var TH = { x0: 9, w: 38, y0: 42, h: 28 };
  function tsx(x) { return TH.x0 + x * TH.w; }
  function tsy(v) { return TH.y0 - v * TH.h; }

  // Default curves as a table: one row per family, columns In / Out / In-Out
  var FAMILIES = ['Ease', 'Sine', 'Quad', 'Cubic', 'Quart', 'Quint', 'Expo', 'Circ', 'Back'];
  var COLUMNS = [['In', 'In'], ['Out', 'Out'], ['', 'In-Out']];
  var BY_NAME = {};
  DEFAULTS.forEach(function (d) { BY_NAME[d.name] = d; });

  function makeThumb(item, set, label) {
    var div = document.createElement('div');
    div.className = 'flow-item';
    div.title = item.name + '  (' + fmt(item.v) + ')';
    if (state.selected && state.selected.set === set && state.selected.name === item.name) div.classList.add('active');
    var svg = el('svg', { viewBox: '0 0 56 50', class: 'flow-thumb' }, div);
    el('line', { x1: tsx(0), y1: tsy(0), x2: tsx(1), y2: tsy(0), class: 'th-base' }, svg);
    el('path', { d: curvePath(item.v, tsx, tsy), class: 'th-curve' }, svg);
    if (label) {
      var l = document.createElement('div');
      l.className = 'flow-label';
      l.textContent = label;
      div.appendChild(l);
    }

    div.addEventListener('click', function () {
      state.selected = { set: set, name: item.name };
      setCurve(item.v.slice(0), state.selected);
      renderLists();
    });
    div.addEventListener('dblclick', apply);
    return div;
  }

  // "expo" -> "Expo · In-Out"
  function prettyName(sel) {
    if (!sel) return 'Custom (unsaved)';
    if (sel.set !== 'default') return sel.name;
    if (sel.name === 'linear') return 'Linear';
    for (var i = 0; i < FAMILIES.length; i++) {
      for (var j = 0; j < COLUMNS.length; j++) {
        if (FAMILIES[i].toLowerCase() + COLUMNS[j][0] === sel.name) return FAMILIES[i] + ' · ' + COLUMNS[j][1];
      }
    }
    return sel.name;
  }

  function sectionTitle(text) {
    var h = document.createElement('div');
    h.className = 'flow-section';
    h.textContent = text;
    return h;
  }

  function customSection() {
    var wrap = document.createElement('div');
    wrap.appendChild(sectionTitle('My curves'));
    if (!state.custom.length) {
      var p = document.createElement('p');
      p.className = 'hint flow-empty';
      p.textContent = 'No saved curves yet. Shape a curve on the left and press Save.';
      wrap.appendChild(p);
      return wrap;
    }
    var grid = document.createElement('div');
    grid.className = 'flow-custom';
    state.custom.forEach(function (it) { grid.appendChild(makeThumb(it, 'custom', it.name)); });
    wrap.appendChild(grid);
    return wrap;
  }

  function defaultTable() {
    var wrap = document.createElement('div');
    wrap.appendChild(sectionTitle('Presets'));
    var table = document.createElement('div');
    table.className = 'flow-matrix';

    // header row - the corner cell holds Linear
    var corner = makeThumb(BY_NAME.linear, 'default', 'Linear');
    corner.classList.add('corner');
    table.appendChild(corner);
    COLUMNS.forEach(function (c) {
      var h = document.createElement('div');
      h.className = 'flow-col';
      h.textContent = c[1];
      table.appendChild(h);
    });

    FAMILIES.forEach(function (fam) {
      var base = fam.toLowerCase();
      var rowName = document.createElement('div');
      rowName.className = 'flow-row';
      rowName.textContent = fam;
      table.appendChild(rowName);
      COLUMNS.forEach(function (c) {
        var item = BY_NAME[base + c[0]];
        table.appendChild(item ? makeThumb(item, 'default') : document.createElement('div'));
      });
    });
    wrap.appendChild(table);
    return wrap;
  }

  function renderLists() {
    var root = $('flowLists');
    root.innerHTML = '';
    root.appendChild(customSection());
    root.appendChild(defaultTable());
    var sel = state.selected;
    $('flowSelName').textContent = prettyName(sel);
    $('flowDelete').disabled = !(sel && sel.set === 'custom');
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                             */
  /* ------------------------------------------------------------------ */

  // selected === null means the user edited the curve by hand
  function setCurve(c, selected) {
    state.cur = c;
    if (selected === null && state.selected) {
      state.selected = null;
      renderLists();
    }
    $('flowValues').value = fmt(c);
    drawEditor();
    restartPreview();
  }

  function apply() {
    var c = state.cur;
    App.host('applyEase', c[0], c[1], c[2], c[3]).then(function (r) {
      if (!r.ok) return App.status(r.error, 'error');
      App.status('Ease applied to ' + r.pairs + ' keyframe pair' + (r.pairs === 1 ? '' : 's') + ' (' + fmt(c) + ')', 'success');
    });
  }

  $('flowApply').addEventListener('click', apply);

  $('flowValues').addEventListener('change', function () {
    var nums = this.value.split(/[\s,;]+/).filter(Boolean).map(Number);
    if (nums.length !== 4 || nums.some(isNaN)) {
      this.value = fmt(state.cur);
      return App.status('Format: x1, y1, x2, y2  (e.g. 0.42, 0, 0.58, 1)', 'error');
    }
    setCurve([clamp(nums[0], 0, 1), clamp(nums[1], Y_MIN, Y_MAX), clamp(nums[2], 0, 1), clamp(nums[3], Y_MIN, Y_MAX)], null);
  });
  $('flowValues').addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); });

  function doSaveCurve() {
    var name = $('curveName').value.trim();
    if (!name) { $('curveName').focus(); return; }
    var existing = state.custom.filter(function (c) { return c.name === name; })[0];
    if (existing) existing.v = state.cur.slice(0);
    else state.custom.push({ name: name, v: state.cur.slice(0) });
    try {
      saveCustom();
    } catch (e) {
      return App.status('Curve not saved: ' + e.message, 'error');
    }
    App.closeModal('curveModal');
    state.selected = { set: 'custom', name: name };
    renderLists();
    App.status('Curve "' + name + '" saved.', 'success');
  }

  $('flowSave').addEventListener('click', function () {
    $('curveName').value = (state.selected && state.selected.set === 'custom') ? state.selected.name : '';
    App.openModal('curveModal');
    $('curveName').focus();
  });
  $('btnDoSaveCurve').addEventListener('click', doSaveCurve);
  $('curveName').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSaveCurve(); });

  $('flowDelete').addEventListener('click', function () {
    var sel = state.selected;
    if (!sel || sel.set !== 'custom') return;
    App.confirmAction('Delete curve', 'Curve "' + sel.name + '" will be deleted.', function () {
      state.custom = state.custom.filter(function (c) { return c.name !== sel.name; });
      try { saveCustom(); } catch (e) { return App.status('Could not delete: ' + e.message, 'error'); }
      state.selected = null;
      renderLists();
      App.status('Curve "' + sel.name + '" deleted.', 'success');
    });
  });

  /* ------------------------------------------------------------------ */
  /* Public                                                              */
  /* ------------------------------------------------------------------ */

  window.TLFlow = {
    setVisible: function (v) {
      state.visible = v;
      if (v) {
        loadCustom();
        renderLists();
        drawEditor();
        restartPreview();
      }
    }
  };

  buildEditor();
  $('flowValues').value = fmt(state.cur);
  drawEditor();
})();
