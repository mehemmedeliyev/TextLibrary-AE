/* Text Library - panel logic (CEP, Chromium 61+ compatible: no ?. / ??) */
(function () {
  'use strict';

  var nodeRequire = (window.cep_node && window.cep_node.require) || window.require;
  var fs = nodeRequire('fs');
  var path = nodeRequire('path');

  var CATEGORY_DEFAULTS = ['Simple Text', 'Complex Text'];
  var LS_LIB = 'tl.libPath';

  var state = {
    lib: '',
    cats: [],
    presets: {},       // category -> [preset]
    currentCat: null,
    query: '',
    saveType: 'simple'
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------------ */
  /* CEP / ExtendScript bridge                                           */
  /* ------------------------------------------------------------------ */

  function systemPath(type) {
    var p = decodeURI(window.__adobe_cep__.getSystemPath(type));
    if (/^file:\/\/\/[A-Za-z]:/.test(p)) return p.replace('file:///', '');
    return p.replace('file://', '');
  }

  // JS value -> ExtendScript literal (non-ASCII escaped so Azerbaijani letters survive the bridge)
  function lit(v) {
    return JSON.stringify(v).replace(/[\u007f-￿]/g, function (c) {
      return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  function evalScript(code) {
    return new Promise(function (resolve) {
      window.__adobe_cep__.evalScript(code, resolve);
    });
  }

  function host(fn) {
    var args = Array.prototype.slice.call(arguments, 1).map(lit).join(',');
    return evalScript('TL.' + fn + '(' + args + ')').then(function (raw) {
      try { return JSON.parse(raw); } catch (e) { return { ok: false, error: 'After Effects response: ' + raw }; }
    });
  }

  /* ------------------------------------------------------------------ */
  /* File system helpers                                                 */
  /* ------------------------------------------------------------------ */

  function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }

  function mkdirp(p) {
    if (isDir(p)) return;
    mkdirp(path.dirname(p));
    fs.mkdirSync(p);
  }

  function rmrf(p) {
    if (!fs.existsSync(p)) return;
    if (isDir(p)) {
      fs.readdirSync(p).forEach(function (f) { rmrf(path.join(p, f)); });
      fs.rmdirSync(p);
    } else {
      fs.unlinkSync(p);
    }
  }

  function sanitize(name) {
    var s = String(name).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    return s.replace(/[. ]+$/, '') || 'Preset';
  }

  function uniqueDir(base) {
    var p = base, n = 2;
    while (fs.existsSync(p)) p = base + ' ' + (n++);
    return p;
  }

  function fileUrl(p) {
    var s = p.replace(/\\/g, '/');
    if (s.charAt(0) !== '/') s = '/' + s;
    return 'file://' + s.split('/').map(function (seg) {
      return /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg);
    }).join('/');
  }

  function frameName(i) { return ('0000' + i).slice(-4) + '.png'; }

  /* ------------------------------------------------------------------ */
  /* Library                                                             */
  /* ------------------------------------------------------------------ */

  // The library lives in the repo ("library" next to the panel code) so it travels with git push/pull.
  function repoLib() { return path.join(systemPath('extension'), 'library'); }
  function legacyLib() { return path.join(systemPath('myDocuments'), 'TextLibrary'); }

  function defaultLib() {
    return isDir(repoLib()) ? repoLib() : legacyLib();
  }

  /* ------------------------------------------------------------------ */
  /* GitHub sync of the library (git must be installed)                  */
  /* ------------------------------------------------------------------ */

  var childProcess = nodeRequire('child_process');
  var gitState = { repo: false, chain: Promise.resolve() };

  function gitExe() {
    var p = 'C:\\Program Files\\Git\\cmd\\git.exe';
    return fs.existsSync(p) ? p : 'git';
  }

  // run git inside the library folder
  function git(args) {
    return new Promise(function (resolve) {
      childProcess.execFile(gitExe(), ['-C', state.lib].concat(args), { windowsHide: true, timeout: 120000 },
        function (err, stdout, stderr) {
          resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || (err && err.message) || '') });
        });
    });
  }

  // git calls run one after another
  function gitQueue(fn) {
    gitState.chain = gitState.chain.then(fn, fn);
    return gitState.chain;
  }

  function detectRepo() {
    return git(['rev-parse', '--is-inside-work-tree']).then(function (r) {
      gitState.repo = r.ok && r.out.trim() === 'true';
      $('btnSync').hidden = !gitState.repo;
      return gitState.repo;
    });
  }

  function firstLine(s) { return String(s).split(/\r?\n/).filter(Boolean)[0] || 'unknown error'; }

  // commit + push only the library folder (code changes are left alone)
  function syncPush(message) {
    if (!gitState.repo) return Promise.resolve();
    return gitQueue(function () {
      setSyncing(true);
      return git(['add', '-A', '--', '.'])
        .then(function () { return git(['commit', '-m', message, '--', '.']); })
        .then(function (c) {
          if (!c.ok) return { ok: true, nothing: true }; // nothing to commit
          return git(['push', '-q']);
        })
        .then(function (r) {
          setSyncing(false);
          if (!r.ok) status('Saved locally, but GitHub sync failed: ' + firstLine(r.err), 'warn');
        });
    });
  }

  // bring in presets added/deleted on the other computer
  function syncPull(quiet) {
    if (!gitState.repo) return Promise.resolve();
    return gitQueue(function () {
      setSyncing(true);
      return git(['pull', '--ff-only', '-q']).then(function (r) {
        setSyncing(false);
        if (!r.ok) {
          if (!quiet) status('GitHub sync failed: ' + firstLine(r.err), 'warn');
          return;
        }
        loadLibrary();
        render();
        if (!quiet) status('Library synced with GitHub.', 'success');
      });
    });
  }

  function setSyncing(on) { $('btnSync').classList.toggle('spinning', on); }

  function loadLibrary() {
    mkdirp(state.lib);
    var dirs = fs.readdirSync(state.lib).filter(function (f) { return isDir(path.join(state.lib, f)); });
    if (!dirs.length) {
      CATEGORY_DEFAULTS.forEach(function (c) { mkdirp(path.join(state.lib, c)); });
      dirs = CATEGORY_DEFAULTS.slice();
    }
    dirs.sort(function (a, b) { return a.localeCompare(b); });
    state.cats = dirs;
    state.presets = {};
    dirs.forEach(function (cat) { state.presets[cat] = readCategory(cat); });
    if (state.cats.indexOf(state.currentCat) < 0) state.currentCat = state.cats[0] || null;
  }

  function readCategory(cat) {
    var dir = path.join(state.lib, cat), list = [];
    fs.readdirSync(dir).forEach(function (f) {
      var pdir = path.join(dir, f);
      var metaFile = path.join(pdir, 'meta.json');
      if (!isDir(pdir) || !fs.existsSync(metaFile) || !fs.existsSync(path.join(pdir, 'preset.aep'))) return;
      try {
        var meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
        meta.dir = pdir;
        meta.cat = cat;
        list.push(meta);
      } catch (e) { /* broken preset - ignore */ }
    });
    list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    return list;
  }

  function thumbUrl(p) {
    return fileUrl(path.join(p.dir, 'frames', frameName(p.thumb || 1))) + '?v=' + (p.created || 0);
  }

  /* ------------------------------------------------------------------ */
  /* UI: status / busy / modals                                          */
  /* ------------------------------------------------------------------ */

  function status(msg, kind) {
    var el = $('status');
    el.innerHTML = '';
    var span = document.createElement('span');
    if (kind) span.className = kind;
    span.textContent = msg;
    el.title = msg; // long messages are cut off - hover shows the full text
    el.appendChild(span);
  }

  function busy(text) {
    $('busyText').textContent = text || '';
    $('busy').hidden = !text;
  }

  function openModal(id) { $(id).hidden = false; }
  function closeModal(id) { $(id).hidden = true; }

  Array.prototype.forEach.call(document.querySelectorAll('[data-close]'), function (b) {
    b.addEventListener('click', function () {
      var m = b.closest('.modal-back');
      if (m) m.hidden = true;
    });
  });

  /* ------------------------------------------------------------------ */
  /* UI: sidebar + grid                                                  */
  /* ------------------------------------------------------------------ */

  // Each category gets its own colour (cycled), like the coloured icon circles on dashboard cards
  var CAT_COLORS = [
    ['#3d8bff', '61, 139, 255'],
    ['#ffd23f', '255, 210, 63'],
    ['#ff7a3d', '255, 122, 61'],
    ['#5ee87a', '94, 232, 122'],
    ['#a65cff', '166, 92, 255'],
    ['#ff5fa2', '255, 95, 162'],
    ['#36d6e7', '54, 214, 231']
  ];
  var CAT_ICON = '<svg viewBox="0 0 16 16"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.4 1.5h4.8A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/></svg>';

  function renderCats() {
    var ul = $('cats');
    ul.innerHTML = '';
    state.cats.forEach(function (cat, i) {
      var li = document.createElement('li');
      if (cat === state.currentCat && !state.query) li.className = 'active';
      var color = CAT_COLORS[i % CAT_COLORS.length];
      li.style.setProperty('--cat', color[0]);
      li.style.setProperty('--cat-rgb', color[1]);
      li.innerHTML = '<span class="cat-icon">' + CAT_ICON + '</span><span class="label"></span><span class="count"></span>';
      li.querySelector('.label').textContent = cat;
      li.querySelector('.count').textContent = state.presets[cat].length;
      li.addEventListener('click', function () {
        state.currentCat = cat;
        state.query = '';
        $('search').value = '';
        render();
      });
      ul.appendChild(li);
    });
  }

  function currentList() {
    if (!state.query) return state.presets[state.currentCat] || [];
    var q = state.query.toLocaleLowerCase();
    var out = [];
    state.cats.forEach(function (cat) {
      state.presets[cat].forEach(function (p) {
        if (String(p.name).toLocaleLowerCase().indexOf(q) >= 0) out.push(p);
      });
    });
    return out;
  }

  function renderGrid() {
    var grid = $('grid'), list = currentList();
    stopPlayback();
    grid.innerHTML = '';
    $('contentHead').textContent = state.query
      ? list.length + ' result' + (list.length === 1 ? '' : 's') + ' for "' + state.query + '"'
      : (state.currentCat || '');

    $('empty').hidden = list.length > 0;
    if (!list.length) {
      $('empty').innerHTML = state.query
        ? 'Nothing found.'
        : 'This category is empty.<br>Select a text layer or open a composition in the timeline, then press <b>Save to Library</b>.';
    }

    list.forEach(function (p) { grid.appendChild(makeCard(p)); });
  }

  function makeCard(p) {
    var card = document.createElement('div');
    card.className = 'card';
    // text animations: In / Out / Remove; compositions: Apply
    var actions = p.type === 'complex'
      ? '<button class="card-act primary-act" data-mode="apply" title="Add as a precomp at the current time">Apply</button>'
      : '<button class="card-act primary-act" data-mode="in" title="Add to the start of the selected layers">In</button>' +
        '<button class="card-act primary-act" data-mode="out" title="Add to the end of the selected layers (played in reverse)">Out</button>' +
        '<button class="card-act remove-act" data-mode="remove" title="Remove all animation from the selected layers (keyframes, expressions, animators, effects) - static text stays">Remove</button>';
    card.innerHTML =
      '<div class="thumb"><img alt=""><div class="card-actions">' + actions + '</div></div>' +
      '<div class="meta"><span class="badge"></span><span class="name"></span><span class="cat"></span>' +
      '<button class="icon-btn menu-btn" title="More">&#x2630;</button></div>';

    var img = card.querySelector('img');
    img.src = thumbUrl(p);
    var badge = card.querySelector('.badge');
    badge.textContent = p.type === 'complex' ? 'COMP' : 'T';
    if (p.type === 'complex') badge.classList.add('complex');
    badge.title = p.type === 'complex' ? 'Composition - added as a precomp' : 'Text animation - applied to the selected layers';
    card.querySelector('.name').textContent = p.name;
    card.querySelector('.name').title = p.name;
    if (state.query) card.querySelector('.cat').textContent = p.cat;

    card.addEventListener('mouseenter', function () { startPlayback(img, p); });
    card.addEventListener('mouseleave', function () { stopPlayback(); img.src = thumbUrl(p); });
    Array.prototype.forEach.call(card.querySelectorAll('.card-act'), function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); applyPreset(p, b.getAttribute('data-mode')); });
      b.addEventListener('dblclick', function (e) { e.stopPropagation(); });
    });
    card.addEventListener('dblclick', function () { applyPreset(p, p.type === 'complex' ? 'apply' : 'in'); });
    card.querySelector('.menu-btn').addEventListener('click', function (e) {
      e.stopPropagation();
      openCardMenu(this, p);
    });
    card.querySelector('.menu-btn').addEventListener('dblclick', function (e) { e.stopPropagation(); });
    return card;
  }

  /* ------------------------------------------------------------------ */
  /* Card menu / delete                                                  */
  /* ------------------------------------------------------------------ */

  var menuPreset = null;

  function openCardMenu(anchor, p) {
    var menu = $('cardMenu');
    menuPreset = p;
    menu.hidden = false;
    var r = anchor.getBoundingClientRect();
    var left = Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8);
    var top = r.bottom + 4;
    if (top + menu.offsetHeight > window.innerHeight - 8) top = r.top - menu.offsetHeight - 4;
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
  }

  function closeCardMenu() {
    $('cardMenu').hidden = true;
  }

  document.addEventListener('click', function (e) {
    if (!$('cardMenu').hidden && !$('cardMenu').contains(e.target)) $('cardMenu').hidden = true;
  });

  /* ------------------------------------------------------------------ */
  /* Motion tab                                                          */
  /* ------------------------------------------------------------------ */

  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  // run a host call and report the result in the status bar
  function motion(fn, args, done) {
    host.apply(null, [fn].concat(args || [])).then(function (r) {
      if (!r.ok) return status(r.error, 'error');
      status(done(r), 'success');
    });
  }

  Array.prototype.forEach.call($('anchorPad').querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () {
      var pad = $('anchorPad');
      Array.prototype.forEach.call(pad.querySelectorAll('button'), function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      motion('setAnchor', [+b.getAttribute('data-ax'), +b.getAttribute('data-ay')], function (r) {
        return 'Anchor moved on ' + plural(r.done, 'layer') + (r.skipped ? ' (' + r.skipped + ' skipped)' : '') + '.';
      });
    });
  });

  function propCount(n) { return n + (n === 1 ? ' property' : ' properties'); }

  $('mElastic').addEventListener('click', function () {
    motion('addMotionExpression', ['elastic'], function (r) { return 'Elastic added to ' + propCount(r.count) + '.'; });
  });
  $('mBounce').addEventListener('click', function () {
    motion('addMotionExpression', ['bounce'], function (r) { return 'Bounce added to ' + propCount(r.count) + '.'; });
  });

  var seqReverse = false;
  Array.prototype.forEach.call($('seqDir').children, function (b) {
    b.addEventListener('click', function () {
      seqReverse = b.getAttribute('data-rev') === '1';
      Array.prototype.forEach.call($('seqDir').children, function (x) { x.classList.toggle('active', x === b); });
    });
  });

  // -/+ buttons next to the number fields
  Array.prototype.forEach.call(document.querySelectorAll('[data-num]'), function (b) {
    b.addEventListener('click', function (e) {
      e.preventDefault();
      var input = $(b.getAttribute('data-num'));
      var min = input.min !== '' ? +input.min : -9999;
      input.value = Math.max(min, (parseInt(input.value, 10) || 0) + (+b.getAttribute('data-d')));
    });
  });

  $('mSequence').addEventListener('click', function () {
    var offset = parseInt($('seqOffset').value, 10) || 0;
    var step = Math.max(1, parseInt($('seqStep').value, 10) || 1);
    motion('sequenceLayers', [offset, step, seqReverse], function (r) {
      return plural(r.count, 'layer') + ' sequenced - ' + (offset * step) + ' frames between layers (' + offset + ' x ' + step + ').';
    });
  });

  $('mExtract').addEventListener('click', function () {
    motion('extractPrecomp', [], function (r) { return plural(r.count, 'layer') + ' extracted from the precomp.'; });
  });
  $('mMerge').addEventListener('click', function () {
    motion('mergeShapes', [], function (r) {
      return plural(r.count, 'shape layer') + ' merged.' + (r.parented ? ' Note: parenting of ' + r.parented + ' layer(s) was not kept.' : '');
    });
  });
  $('mNull').addEventListener('click', function () {
    motion('addNullParent', [], function (r) {
      return '"' + r.name + '" created' + (r.count ? ' and ' + plural(r.count, 'layer') + ' parented to it.' : '.');
    });
  });
  $('mShape').addEventListener('click', function () {
    motion('convertToShape', [], function (r) { return plural(r.count, 'layer') + ' converted to shapes.'; });
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-new]'), function (b) {
    b.addEventListener('click', function () {
      motion('newLayer', [b.getAttribute('data-new')], function (r) { return '"' + r.name + '" created.'; });
    });
  });

  /* ------------------------------------------------------------------ */
  /* Duration popover                                                    */
  /* ------------------------------------------------------------------ */

  var DUR_CHIPS = [5, 10, 15, 20, 30, 60];
  var dur = { fps: 25, old: 0 };

  function timecode(sec, fps) {
    var f = Math.round(fps) || 25;
    var frames = Math.round(sec * fps);
    var ff = frames % f, s = Math.floor(frames / f);
    var pad = function (n) { return ('0' + n).slice(-2); };
    return Math.floor(s / 3600) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) + ':' + pad(ff);
  }

  function fmtSec(v) { return (Math.round(v * 100) / 100) + 's'; }

  function durValue() { return parseFloat($('durInput').value); }

  function durUpdate() {
    var v = durValue();
    $('durTc').textContent = v > 0 ? timecode(v, dur.fps) : '—';
    Array.prototype.forEach.call($('durChips').children, function (c) {
      c.classList.toggle('active', +c.getAttribute('data-sec') === v);
    });
    $('durOk').disabled = !(v > 0);
  }

  function durSet(v) {
    $('durInput').value = Math.max(0.1, Math.round(v * 100) / 100);
    durUpdate();
  }

  DUR_CHIPS.forEach(function (s) {
    var c = document.createElement('button');
    c.className = 'dur-chip';
    c.setAttribute('data-sec', s);
    c.textContent = s + 's';
    c.addEventListener('click', function () { durSet(s); });
    $('durChips').appendChild(c);
  });

  Array.prototype.forEach.call(document.querySelectorAll('.dur-step'), function (b) {
    b.addEventListener('click', function (e) {
      var step = +b.getAttribute('data-step') * (e.shiftKey ? 0.5 : 1);
      durSet((durValue() || 0) + step);
    });
  });

  $('durInput').addEventListener('input', durUpdate);
  $('durInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') durApply(); });
  $('durOk').addEventListener('click', durApply);

  // Shown in the Edit tab for the comp currently loaded there (r = getTexts result)
  function durShow(r) {
    dur.target = r;
    dur.fps = r.fps;
    dur.old = r.duration;
    $('durOld').textContent = 'now ' + fmtSec(r.duration);
    durSet(r.duration);
    sizeShow(r.width, r.height);
    $('durBox').hidden = false;
  }

  /* ------------------------------------------------------------------ */
  /* Composition size (Edit tab)                                         */
  /* ------------------------------------------------------------------ */

  var size = { w: 0, h: 0, linked: false };

  function gcd(a, b) { return b ? gcd(b, a % b) : a; }

  function ratioText(w, h) {
    if (!(w > 0 && h > 0)) return '';
    var g = gcd(w, h), rw = w / g, rh = h / g;
    return rw <= 32 && rh <= 32 ? rw + ':' + rh : (w / h).toFixed(3);
  }

  function sizeShow(w, h) {
    size.w = w;
    size.h = h;
    $('sizeW').value = w;
    $('sizeH').value = h;
    $('sizeOld').textContent = 'now ' + w + '×' + h;
    sizeUpdate();
  }

  function sizeVals() { return [Math.round(parseFloat($('sizeW').value)), Math.round(parseFloat($('sizeH').value))]; }

  function sizeUpdate() {
    var v = sizeVals();
    var valid = v[0] >= 4 && v[0] <= 30000 && v[1] >= 4 && v[1] <= 30000;
    $('sizeRatio').textContent = valid ? ratioText(v[0], v[1]) : '—';
    $('sizeOk').disabled = !valid || (v[0] === size.w && v[1] === size.h);
  }

  $('sizeW').addEventListener('input', function () {
    var w = parseFloat(this.value);
    if (size.linked && w > 0 && size.w) $('sizeH').value = Math.round(w * size.h / size.w);
    sizeUpdate();
  });
  $('sizeH').addEventListener('input', function () {
    var h = parseFloat(this.value);
    if (size.linked && h > 0 && size.h) $('sizeW').value = Math.round(h * size.w / size.h);
    sizeUpdate();
  });
  ['sizeW', 'sizeH'].forEach(function (id) {
    $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') sizeApply(); });
  });

  $('sizeLink').addEventListener('click', function () {
    size.linked = !size.linked;
    this.classList.toggle('active', size.linked);
  });

  $('sizeSwap').addEventListener('click', function () {
    var w = $('sizeW').value;
    $('sizeW').value = $('sizeH').value;
    $('sizeH').value = w;
    sizeUpdate();
  });

  $('sizeOk').addEventListener('click', sizeApply);

  function sizeApply() {
    var v = sizeVals(), t = dur.target;
    if (!t || $('sizeOk').disabled) return;
    host('setCompSize', t.compId, v[0], v[1]).then(function (r) {
      if (!r.ok) return status(r.error, 'error');
      status('"' + r.name + '" ' + size.w + '×' + size.h + ' → ' + r.width + '×' + r.height, 'success');
      sizeShow(r.width, r.height);
      readSelection(); // layer positions changed - refresh the fields
    });
  }

  function durApply() {
    var v = durValue(), t = dur.target;
    if (!(v > 0) || !t) return;
    host('setDuration', v, t.compId, t.outerId, t.layerIndex).then(function (r) {
      if (!r.ok) return status(r.error, 'error');
      status('"' + r.name + '" ' + fmtSec(dur.old) + ' → ' + fmtSec(r.duration) + ' (' + r.layers + ' layer' + (r.layers === 1 ? '' : 's') + ' extended)', 'success');
      dur.old = r.duration;
      $('durOld').textContent = 'now ' + fmtSec(r.duration);
      durSet(r.duration);
    });
  }

  Array.prototype.forEach.call($('cardMenu').querySelectorAll('button'), function (b) {
    b.addEventListener('click', function () {
      var p = menuPreset, action = b.getAttribute('data-action');
      closeCardMenu();
      if (!p) return;
      if (action === 'reveal') host('revealFolder', p.dir);
      if (action === 'delete') {
        confirmAction('Delete preset', '"' + p.name + '" will be permanently removed from the library and from disk. This cannot be undone.', function () {
          deletePreset(p);
        });
      }
    });
  });

  var confirmCallback = null;

  function confirmAction(title, text, cb) {
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    confirmCallback = cb;
    openModal('confirmModal');
  }

  $('btnConfirmOk').addEventListener('click', function () {
    closeModal('confirmModal');
    var cb = confirmCallback;
    confirmCallback = null;
    if (cb) cb();
  });

  function deletePreset(p) {
    stopPlayback();
    try {
      rmrf(p.dir);
    } catch (e) {
      status('Could not delete: ' + e.message, 'error');
      return;
    }
    loadLibrary();
    render();
    status('"' + p.name + '" deleted.', 'success');
    syncPush('Library: delete "' + p.name + '"');
  }

  /* ------------------------------------------------------------------ */
  /* Deep copy                                                           */
  /* ------------------------------------------------------------------ */

  $('btnDeepCopy').addEventListener('click', function () {
    busy('Deep Copy...');
    host('deepCopy').then(function (r) {
      busy(null);
      if (!r.ok) return status(r.error, 'error');
      status('"' + r.name + '" created - ' + r.comps + ' composition' + (r.comps === 1 ? '' : 's') + ' copied independently.', 'success');
      if (!$('view-edit').hidden) readSelection();
    });
  });

  function render() {
    renderCats();
    renderGrid();
  }

  /* ------------------------------------------------------------------ */
  /* Hover preview playback                                              */
  /* ------------------------------------------------------------------ */

  var player = null;

  function startPlayback(img, p) {
    stopPlayback();
    var n = p.frames || 1;
    if (n < 2) return;
    var urls = [];
    for (var i = 1; i <= n; i++) {
      urls.push(fileUrl(path.join(p.dir, 'frames', frameName(i))) + '?v=' + (p.created || 0));
    }
    // preload so playback is smooth after the first loop
    var cache = urls.map(function (u) { var im = new Image(); im.src = u; return im; });
    var idx = 0;
    player = {
      cache: cache,
      timer: setInterval(function () {
        idx = (idx + 1) % urls.length;
        img.src = urls[idx];
      }, 1000 / (p.fps || 15))
    };
  }

  function stopPlayback() {
    if (player) {
      clearInterval(player.timer);
      player = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Apply                                                               */
  /* ------------------------------------------------------------------ */

  // mode: 'apply' (composition) | 'in' | 'out' | 'remove' (text animation)
  function applyPreset(p, mode) {
    var aep = path.join(p.dir, 'preset.aep');
    if (mode === 'remove') {
      busy('Removing animation...');
      host('removePreset').then(function (r) {
        busy(null);
        if (!r.ok) return status(r.error, 'error');
        status('All animation removed from ' + r.layers + ' layer' + (r.layers === 1 ? '' : 's') + ' - static text left.', 'success');
      });
    } else if (p.type === 'complex') {
      busy('Adding composition...');
      host('applyComplex', aep, p.compName, p.name).then(function (r) {
        busy(null);
        if (!r.ok) return status(r.error, 'error');
        status('"' + p.name + '" added. Edit its texts in the Edit tab.', 'success');
        readSelection();
      });
    } else {
      busy('Applying animation...');
      host('applySimple', aep, p.compName, mode, p.name).then(function (r) {
        busy(null);
        if (!r.ok) return status(r.error, 'error');
        if (!r.applied) return status('None of the selected layers is a text layer.', 'error');
        var msg = '"' + p.name + '" (' + (mode === 'out' ? 'Out' : 'In') + ') applied to ' + r.applied + ' layer' + (r.applied === 1 ? '' : 's') + '.';
        if (r.skipped) msg += ' (' + r.skipped + ' non-text layer' + (r.skipped === 1 ? '' : 's') + ' skipped)';
        if (r.warnings && r.warnings.length) {
          status(msg + ' Problems: ' + r.warnings.join(' | '), 'warn');
        } else {
          status(msg, 'success');
        }
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Save                                                                */
  /* ------------------------------------------------------------------ */

  var TYPE_HINTS = {
    simple: 'Select ONE animated text layer in the timeline. Keyframes, text animators, effects and masks are saved.',
    complex: 'The composition open in the timeline is saved as a whole. The preview is rendered from its work area.'
  };

  function setSaveType(t) {
    state.saveType = t;
    Array.prototype.forEach.call($('saveType').children, function (b) {
      b.classList.toggle('active', b.getAttribute('data-type') === t);
    });
    $('saveTypeHint').textContent = TYPE_HINTS[t];
  }

  function openSave() {
    var sel = $('saveCat');
    sel.innerHTML = '';
    state.cats.forEach(function (c) {
      var o = document.createElement('option');
      o.value = o.textContent = c;
      sel.appendChild(o);
    });
    if (state.currentCat) sel.value = state.currentCat;
    if (state.currentCat === 'Complex Text') setSaveType('complex');
    else if (state.currentCat === 'Simple Text') setSaveType('simple');
    else setSaveType(state.saveType);
    $('saveName').value = '';
    openModal('saveModal');
    $('saveName').focus();
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // Frames are written by After Effects possibly asynchronously - wait until they exist on disk.
  function waitForFrames(dir, total) {
    var started = Date.now(), lastChange = Date.now(), lastCount = -1;
    function count() {
      var c = 0;
      while (c < total && fs.existsSync(path.join(dir, frameName(c + 1)))) c++;
      return c;
    }
    function tick() {
      var c = count();
      if (c !== lastCount) { lastCount = c; lastChange = Date.now(); }
      busy('Rendering preview... ' + c + ' / ' + total);
      if (c >= total) return sleep(300).then(function () { return c; });
      if (Date.now() - lastChange > 20000 || Date.now() - started > 180000) return Promise.resolve(c);
      return sleep(250).then(tick);
    }
    return tick();
  }

  function doSave() {
    var name = $('saveName').value.trim();
    var cat = $('saveCat').value;
    var type = state.saveType;
    if (!name) { $('saveName').focus(); return; }
    if (!cat) return;

    closeModal('saveModal');
    var dest = uniqueDir(path.join(state.lib, cat, sanitize(name)));
    var info = null;

    busy('Saving project...');
    host('saveBegin', type, dest)
      .then(function (r) {
        if (!r.ok) throw new Error(r.error);
        info = r;
        return waitForFrames(path.join(dest, 'frames'), r.frames);
      })
      .then(function (got) {
        info.framesGot = got;
        busy('Writing to library...');
        return host('saveFinish');
      })
      .then(function (r) {
        if (!r.ok) throw new Error(r.error);
        var frames = Math.max(1, info.framesGot);
        var meta = {
          name: name,
          type: type,
          compName: info.compName,
          frames: frames,
          fps: info.fps,
          thumb: Math.min(info.thumb, frames),
          width: info.width,
          height: info.height,
          created: Date.now()
        };
        fs.writeFileSync(path.join(dest, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
        busy(null);
        state.currentCat = cat;
        state.query = '';
        $('search').value = '';
        loadLibrary();
        render();
        status('"' + name + '" saved to the library.', 'success');
        syncPush('Library: add "' + name + '"');
      })
      .catch(function (e) {
        busy(null);
        try { rmrf(dest); } catch (ignore) {}
        status('Not saved: ' + e.message, 'error');
      });
  }

  /* ------------------------------------------------------------------ */
  /* Categories                                                          */
  /* ------------------------------------------------------------------ */

  function doAddCat() {
    var name = sanitize($('catName').value);
    if (!$('catName').value.trim()) { $('catName').focus(); return; }
    var p = path.join(state.lib, name);
    if (isDir(p)) { status('A category with this name already exists.', 'error'); return; }
    mkdirp(p);
    fs.writeFileSync(path.join(p, '.keep'), ''); // git does not track empty folders
    closeModal('catModal');
    state.currentCat = name;
    state.query = '';
    $('search').value = '';
    loadLibrary();
    render();
    status('Category "' + name + '" created.', 'success');
    syncPush('Library: add category "' + name + '"');
  }

  /* ------------------------------------------------------------------ */
  /* Edit tab                                                            */
  /* ------------------------------------------------------------------ */

  function toUi(t) { return String(t).replace(/\r\n|\r|\u0003/g, '\n'); }
  function toAe(t) { return String(t).replace(/\r\n|\n/g, '\r'); }

  var editLoaded = false;

  function readSelection() {
    return host('getTexts').then(function (r) {
      // Nothing suitable selected: keep showing what was loaded before
      if (!r.ok) {
        if (!editLoaded) {
          $('editTitle').textContent = r.error;
          $('durBox').hidden = true;
        }
        return;
      }
      editLoaded = true;
      var list = $('editList');
      list.innerHTML = '';
      $('editTitle').textContent = r.name;
      durShow(r);
      if (!r.texts.length) {
        list.innerHTML = '<p class="hint">No text layers found in this composition.</p>';
        return;
      }
      r.texts.forEach(function (t) { list.appendChild(makeEditItem(t)); });
    });
  }

  // Watch the After Effects selection while the Edit tab is open and load the new comp automatically.
  var selPoll = { timer: null, key: null, busy: false };

  function pollSelection() {
    if (selPoll.busy || document.hidden) return;
    selPoll.busy = true;
    evalScript('TL.selectionKey()').then(function (key) {
      if (typeof key !== 'string' || key.indexOf('EvalScript') === 0) return;
      if (!key) { selPoll.key = ''; return; } // nothing selected: keep the view, reload when something is picked again
      if (key === selPoll.key) return;
      selPoll.key = key;
      return readSelection();
    }).then(function () { selPoll.busy = false; }, function () { selPoll.busy = false; });
  }

  function watchSelection(on) {
    clearInterval(selPoll.timer);
    selPoll.timer = null;
    if (!on) return;
    selPoll.key = null; // force a load when the tab opens
    pollSelection();
    selPoll.timer = setInterval(pollSelection, 700);
  }

  var TEXT_PROPS = [
    { key: 'fontSize', label: 'Font Size', min: 1, step: 1 },
    { key: 'tracking', label: 'Letter Spacing', min: -1000, step: 1 },
    { key: 'leading', label: 'Line Spacing', min: 0, step: 1 },
    { key: 'x', label: 'Move X', min: -100000, step: 1, move: true, title: 'Left / right (px)' },
    { key: 'y', label: 'Move Y', min: -100000, step: 1, move: true, title: 'Up / down (px)' }
  ];

  function roundNum(v) { return Math.round(v * 10) / 10; }

  function fieldValue(def, state) {
    if (def.key === 'leading' && (state.autoLeading || !state.leading)) return null; // Auto
    return typeof state[def.key] === 'number' ? state[def.key] : null;
  }

  function makeEditItem(t) {
    var wrap = document.createElement('div');
    wrap.className = 'edit-item';
    wrap.innerHTML =
      '<label><b></b> <span></span><button class="reset" title="Reset text to its original">&#x21BA;</button></label>' +
      '<textarea spellcheck="false"></textarea><div class="text-props"></div>';
    wrap.querySelector('b').textContent = t.layer;
    wrap.querySelector('span').textContent = '· ' + t.compName;

    // All calls for this layer run one after another so moves/resets never overlap.
    var chain = Promise.resolve(), flashTimer = null;
    function call(fn, arg, updateFields) {
      chain = chain.then(function () {
        return host(fn, t.compId, t.index, arg).then(function (r) {
          if (!r.ok) return status(r.error, 'error');
          if (r.warning) status(r.warning, 'warn');
          wrap.classList.add('saved');
          clearTimeout(flashTimer);
          flashTimer = setTimeout(function () { wrap.classList.remove('saved'); }, 600);
          if (updateFields) applyState(r.state);
        });
      });
    }

    // text
    var ta = wrap.querySelector('textarea');
    ta.value = toUi(t.text);
    ta.rows = Math.min(6, ta.value.split('\n').length);
    var lastText = ta.value, textTimer = null;
    function pushText() {
      clearTimeout(textTimer);
      if (ta.value === lastText) return;
      lastText = ta.value;
      ta.rows = Math.min(6, lastText.split('\n').length);
      call('setTextProps', { text: toAe(lastText) });
    }
    ta.addEventListener('input', function () {
      clearTimeout(textTimer);
      textTimer = setTimeout(pushText, 600);
    });
    ta.addEventListener('blur', pushText);
    wrap.querySelector('.reset').addEventListener('click', function () {
      clearTimeout(textTimer);
      call('resetTextProp', 'text', true);
    });

    // numeric fields
    var row = wrap.querySelector('.text-props');
    var fields = {};
    TEXT_PROPS.forEach(function (def) {
      var f = makePropField(def, fieldValue(def, t), function (v, prev) {
        var p = {};
        if (def.move) p.move = def.key === 'x' ? [v - prev, 0] : [0, v - prev];
        else p[def.key] = v;
        call('setTextProps', p);
      }, function () {
        call('resetTextProp', def.key, true);
      }, def.key === 'leading' ? function () {
        // Auto leading in AE = font size * 1.2
        var fs = fields.fontSize && fields.fontSize.get();
        return fs ? Math.round(fs * 1.2) : 0;
      } : null);
      fields[def.key] = f;
      row.appendChild(f.el);
    });

    var align = makeAlignField(t.justification, function (v) {
      call('setTextProps', { justification: v });
    }, function () {
      call('resetTextProp', 'justification', true);
    });
    row.appendChild(align.el);

    function applyState(s) {
      if (!s) return;
      TEXT_PROPS.forEach(function (def) { fields[def.key].set(fieldValue(def, s)); });
      align.set(s.justification);
      if (document.activeElement !== ta) {
        ta.value = lastText = toUi(s.text);
        ta.rows = Math.min(6, ta.value.split('\n').length);
      }
    }
    return wrap;
  }

  // Paragraph alignment: left / center / right
  var ALIGN_ICONS = {
    left: [[2, 14], [2, 10], [2, 14], [2, 8]],
    center: [[3, 13], [5, 11], [3, 13], [6, 10]],
    right: [[2, 14], [6, 14], [2, 14], [8, 14]]
  };
  var ALIGN_TITLES = { left: 'Align left', center: 'Align center', right: 'Align right' };

  function alignIcon(kind) {
    var lines = ALIGN_ICONS[kind].map(function (l, i) {
      var y = 3.5 + i * 3;
      return '<line x1="' + l[0] + '" y1="' + y + '" x2="' + l[1] + '" y2="' + y + '"/>';
    }).join('');
    return '<svg viewBox="0 0 16 16" width="14" height="14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">' + lines + '</svg>';
  }

  function makeAlignField(value, onChange, onReset) {
    var box = document.createElement('div');
    box.className = 'prop align';
    box.innerHTML = '<span class="label">Paragraph</span><div class="align-btns"></div>' +
      '<button class="reset" title="Reset to original">&#x21BA;</button>';
    var btns = box.querySelector('.align-btns');
    var current = null;

    ['left', 'center', 'right'].forEach(function (kind) {
      var b = document.createElement('button');
      b.className = 'align-btn';
      b.setAttribute('data-align', kind);
      b.title = ALIGN_TITLES[kind];
      b.innerHTML = alignIcon(kind);
      b.addEventListener('click', function () {
        if (current === kind) return;
        set(kind);
        onChange(kind);
      });
      btns.appendChild(b);
    });
    box.querySelector('.reset').addEventListener('click', onReset);

    function set(v) {
      current = v;
      Array.prototype.forEach.call(btns.children, function (b) {
        b.classList.toggle('active', b.getAttribute('data-align') === v);
      });
    }
    set(value);
    return { el: box, set: set };
  }

  // value null = no explicit value (Line Spacing "Auto")
  function makePropField(def, value, onChange, onReset, autoStart) {
    var box = document.createElement('div');
    box.className = 'prop';
    box.innerHTML =
      '<span class="scrub"></span><input type="number">' +
      '<button class="reset" title="Reset to original">&#x21BA;</button>';
    var label = box.querySelector('.scrub');
    var input = box.querySelector('input');
    label.textContent = def.label;
    label.title = (def.title ? def.title + ' - ' : '') + 'Drag left/right to change (Shift: x10)';
    input.step = def.step;
    input.min = def.min;
    input.placeholder = def.key === 'leading' ? 'Auto' : '—';
    box.querySelector('.reset').addEventListener('click', onReset);

    var last = null, timer = null;
    function set(v) {
      clearTimeout(timer);
      last = (typeof v === 'number') ? roundNum(v) : null;
      input.value = last === null ? '' : last;
    }
    set(value);

    function commit(delay) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var v = parseFloat(input.value);
        if (isNaN(v)) { input.value = last === null ? '' : last; return; }
        v = Math.max(def.min, roundNum(v));
        input.value = v;
        if (v === last) return;
        var prev = last === null ? 0 : last;
        last = v;
        onChange(v, prev);
      }, delay);
    }
    input.addEventListener('input', function () { commit(350); });
    input.addEventListener('change', function () { commit(0); });

    // drag the label left/right to change the value, like After Effects
    label.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var startX = e.clientX, startV = parseFloat(input.value);
      if (isNaN(startV)) startV = autoStart ? autoStart() : 0;
      document.body.classList.add('scrubbing');
      function move(ev) {
        var mult = ev.shiftKey ? 10 : 1;
        var v = Math.max(def.min, roundNum(startV + Math.round((ev.clientX - startX) / 2) * def.step * mult));
        input.value = v;
        commit(60);
      }
      function up() {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.classList.remove('scrubbing');
        commit(0);
      }
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    return { el: box, set: set, get: function () { return last; } };
  }

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */

  function switchTab(tab) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    document.body.setAttribute('data-tab', tab); // switches the accent colour
    $('view-browse').hidden = tab !== 'browse';
    $('view-edit').hidden = tab !== 'edit';
    $('view-flow').hidden = tab !== 'flow';
    $('view-motion').hidden = tab !== 'motion';
    watchSelection(tab === 'edit');
    if (window.TLFlow) window.TLFlow.setVisible(tab === 'flow');
  }

  // Shared helpers for flow.js
  window.TLApp = {
    host: host,
    status: status,
    openModal: openModal,
    closeModal: closeModal,
    confirmAction: confirmAction,
    lib: function () { return state.lib; },
    fs: fs,
    path: path,
    mkdirp: mkdirp
  };

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); });
  });

  $('search').addEventListener('input', function () {
    state.query = this.value.trim();
    render();
  });

  $('btnSave').addEventListener('click', openSave);
  $('btnDoSave').addEventListener('click', doSave);
  $('saveName').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSave(); });
  Array.prototype.forEach.call($('saveType').children, function (b) {
    b.addEventListener('click', function () { setSaveType(b.getAttribute('data-type')); });
  });

  $('btnAddCat').addEventListener('click', function () {
    $('catName').value = '';
    openModal('catModal');
    $('catName').focus();
  });
  $('btnDoAddCat').addEventListener('click', doAddCat);
  $('catName').addEventListener('keydown', function (e) { if (e.key === 'Enter') doAddCat(); });

  $('btnRefresh').addEventListener('click', function () {
    loadLibrary();
    render();
    status('Library refreshed.');
  });

  $('btnSync').addEventListener('click', function () {
    syncPull(false).then(function () { return syncPush('Library: sync'); });
  });

  $('btnSettings').addEventListener('click', function () {
    $('libPath').value = state.lib;
    openModal('settingsModal');
  });
  $('btnPickLib').addEventListener('click', function () {
    host('pickFolder', state.lib).then(function (r) {
      if (!r.ok || !r.path) return;
      state.lib = r.path;
      try { localStorage.setItem(LS_LIB, r.path); } catch (e) {}
      $('libPath').value = r.path;
      state.currentCat = null;
      loadLibrary();
      render();
      detectRepo();
    });
  });
  $('btnOpenLib').addEventListener('click', function () { host('revealFolder', state.lib); });


  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeCardMenu();
      Array.prototype.forEach.call(document.querySelectorAll('.modal-back'), function (m) { m.hidden = true; });
    }
  });

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */

  function init() {
    var saved = null;
    try { saved = localStorage.getItem(LS_LIB); } catch (e) {}
    // the old Documents library was moved into the repo - prefer the repo copy
    if (saved && path.resolve(saved) === path.resolve(legacyLib()) && isDir(repoLib())) {
      saved = null;
      try { localStorage.removeItem(LS_LIB); } catch (e) {}
    }
    state.lib = saved || defaultLib();

    try {
      loadLibrary();
    } catch (e) {
      status('Could not open library: ' + e.message, 'error');
    }
    render();

    // (Re)load the host script so edits are picked up without restarting After Effects.
    var hostFile = path.join(systemPath('extension'), 'jsx', 'host.jsx').replace(/\\/g, '/');
    evalScript('$.evalFile(' + lit(hostFile) + ')').then(function () {
      return host('ping');
    }).then(function (r) {
      if (r.ok) status('Ready - After Effects ' + r.version);
      else status('Host script failed to load: ' + r.error, 'error');
    });

    // pull presets added / deleted on the other computer
    detectRepo().then(function (isRepo) { if (isRepo) syncPull(true); });
  }

  init();
})();
