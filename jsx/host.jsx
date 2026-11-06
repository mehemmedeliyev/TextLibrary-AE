/*
 * Text Library - After Effects host script (ExtendScript / ES3)
 * Every public function returns a JSON string: {ok:true,...} or {ok:false,error:"..."}
 */

var TL = TL || {};

TL.PREVIEW_FPS = 30;
TL.PREVIEW_MAX_SEC = 8;
TL.PREVIEW_MAX_WIDTH = 480;
TL.PRESET_COMP = "TL_PRESET";
TL.PROJECT_FOLDER = "Text Library";

/* ------------------------------------------------------------------ */
/* JSON helpers (ExtendScript has no reliable JSON object)             */
/* ------------------------------------------------------------------ */

TL.quote = function (s) {
    return '"' + String(s).replace(/[\\"\u0000-\u001f\u007f-￿]/g, function (c) {
        if (c === '\\') return '\\\\';
        if (c === '"') return '\\"';
        var h = c.charCodeAt(0).toString(16);
        while (h.length < 4) h = "0" + h;
        return "\\u" + h;
    }) + '"';
};

TL.str = function (v) {
    if (v === null || v === undefined) return "null";
    var t = typeof v, i, parts;
    if (t === "number") return isFinite(v) ? String(v) : "null";
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") return TL.quote(v);
    if (v instanceof Array) {
        parts = [];
        for (i = 0; i < v.length; i++) parts.push(TL.str(v[i]));
        return "[" + parts.join(",") + "]";
    }
    parts = [];
    for (var k in v) {
        if (v.hasOwnProperty(k)) parts.push(TL.quote(k) + ":" + TL.str(v[k]));
    }
    return "{" + parts.join(",") + "}";
};

TL.ok = function (o) { o = o || {}; o.ok = true; return TL.str(o); };
TL.err = function (msg) { return TL.str({ ok: false, error: String(msg) }); };
TL.errFromException = function (e) {
    return TL.err(e.toString() + (e.line ? " (line " + e.line + ")" : ""));
};

TL.ping = function () {
    return TL.ok({ version: app.version });
};

/* ------------------------------------------------------------------ */
/* Project helpers                                                     */
/* ------------------------------------------------------------------ */

TL.activeComp = function () {
    var c = app.project ? app.project.activeItem : null;
    return (c && c instanceof CompItem) ? c : null;
};

TL.findItemById = function (id) {
    var items = app.project.items;
    for (var i = 1; i <= items.length; i++) {
        if (items[i].id === id) return items[i];
    }
    return null;
};

TL.findCompIn = function (folder, name) {
    for (var i = 1; i <= folder.numItems; i++) {
        var it = folder.item(i);
        if (it instanceof CompItem && it.name === name) return it;
        if (it instanceof FolderItem) {
            var r = TL.findCompIn(it, name);
            if (r) return r;
        }
    }
    return null;
};

TL.getProjectFolder = function (name) {
    var items = app.project.items;
    for (var i = 1; i <= items.length; i++) {
        if (items[i] instanceof FolderItem && items[i].name === name && items[i].parentFolder === app.project.rootFolder) return items[i];
    }
    return items.addFolder(name);
};

TL.isTextLayer = function (layer) {
    return layer instanceof TextLayer;
};

/* Earliest / latest keyframe time anywhere inside a property group (recursive). */
TL.keyRange = function (group, acc) {
    for (var i = 1; i <= group.numProperties; i++) {
        var p = group.property(i);
        if (!p) continue;
        if (p.propertyType === PropertyType.PROPERTY) {
            if (p.numKeys > 0) {
                var a = p.keyTime(1), b = p.keyTime(p.numKeys);
                if (acc.min === null || a < acc.min) acc.min = a;
                if (acc.max === null || b > acc.max) acc.max = b;
            }
        } else {
            TL.keyRange(p, acc);
        }
    }
    return acc;
};

/* ------------------------------------------------------------------ */
/* PREVIEW FRAMES - every text reads "LOREM IPSUM" while rendering     */
/* ------------------------------------------------------------------ */

TL.PREVIEW_TEXT = "LOREM IPSUM";

/*
 * Swap every text layer of comp (and its precomps) to the preview text; returns an undo list.
 * white: also paint the text white (simple presets, so every preview looks the same).
 */
TL.loremDoc = function (d, white, keep) {
    if (!keep) d.text = TL.PREVIEW_TEXT;
    if (white) {
        try { d.applyFill = true; d.fillColor = [1, 1, 1]; } catch (eF) {}
        try { d.applyStroke = false; } catch (eS) {}
    }
    return d;
};

TL.loremTexts = function (comp, white, undo, visited, keep) {
    undo = undo || [];
    visited = visited || {};
    if (visited[comp.id]) return undo;
    visited[comp.id] = true;
    for (var i = 1; i <= comp.numLayers; i++) {
        var l = comp.layer(i);
        if (TL.isTextLayer(l)) {
            var st = l.property("ADBE Text Properties").property("ADBE Text Document");
            try {
                if (st.numKeys > 0) {
                    var keys = [];
                    for (var k = 1; k <= st.numKeys; k++) {
                        keys.push(st.keyValue(k));
                        st.setValueAtKey(k, TL.loremDoc(st.keyValue(k), white, keep));
                    }
                    undo.push({ p: st, keys: keys });
                } else {
                    undo.push({ p: st, doc: st.value });
                    st.setValue(TL.loremDoc(st.value, white, keep));
                }
            } catch (e) {}
        } else if (l.source && l.source instanceof CompItem) {
            TL.loremTexts(l.source, white, undo, visited, keep);
        }
    }
    return undo;
};

TL.restoreTexts = function (undo) {
    for (var i = undo.length - 1; i >= 0; i--) {
        var u = undo[i];
        try {
            if (u.keys) {
                for (var k = 1; k <= u.keys.length; k++) u.p.setValueAtKey(k, u.keys[k - 1]);
            } else {
                u.p.setValue(u.doc);
            }
        } catch (e) {}
    }
};

/* Render the preview PNGs of a preset comp into folder; returns the frame count. */
TL.renderPreview = function (target, type, folder, keepText) {
    var start, end;
    if (type === "simple") {
        var l = target.layer(1);
        var r = TL.keyRange(l, { min: null, max: null });
        if (r.min === null) {
            start = l.inPoint;
            end = Math.min(l.outPoint, l.inPoint + 3);
        } else {
            start = Math.max(l.inPoint, r.min - 0.2);
            end = Math.min(l.outPoint, r.max + 0.8);
        }
    } else {
        start = target.workAreaStart;
        end = target.workAreaStart + target.workAreaDuration;
    }
    if (end - start > TL.PREVIEW_MAX_SEC) end = start + TL.PREVIEW_MAX_SEC;
    if (end <= start) end = start + 1 / TL.PREVIEW_FPS;

    var oldRes = target.resolutionFactor;
    var f = Math.max(1, Math.ceil(target.width / TL.PREVIEW_MAX_WIDTH));
    target.resolutionFactor = [f, f];
    var undo = TL.loremTexts(target, type === "simple", null, null, keepText);
    var count = Math.max(1, Math.floor((end - start) * TL.PREVIEW_FPS));
    var wrap = null, shot = target, hidden = null;
    try {
        if (type === "simple") {
            hidden = target.layer(1).enabled ? null : target.layer(1); // the layer may have been saved with its eye off
            if (hidden) hidden.enabled = true;
            wrap = TL.previewWrap(target, end - 1 / TL.PREVIEW_FPS);
            if (wrap) { wrap.resolutionFactor = [f, f]; shot = wrap; }
        }
        for (var i = 0; i < count; i++) {
            var name = String(i + 1);
            while (name.length < 4) name = "0" + name;
            shot.saveFrameToPng(start + i / TL.PREVIEW_FPS, new File(folder.fsName + "/" + name + ".png"));
        }
    } finally {
        try { if (wrap) wrap.remove(); } catch (eW) {}
        try { if (hidden) hidden.enabled = false; } catch (eH) {}
        TL.restoreTexts(undo);
        target.resolutionFactor = oldRes;
    }
    return count;
};

/*
 * Simple presets keep the font size / position of the layer they were made from, so previews
 * would differ wildly. Wrap the preset comp in a temp comp that centres the text (as it rests
 * at time t) and scales it to one standard letter size (font size, so short words and long
 * paragraphs read the same size; very long text is shrunk to fit). Returns the wrapper comp, or null.
 */
TL.PREVIEW_FONT = 0.094;       // font size on screen, of the comp height
TL.PREVIEW_TEXT_WIDTH = 0.9;   // max, of the comp width
TL.PREVIEW_TEXT_HEIGHT = 0.85; // max, of the comp height
TL.previewWrap = function (target, t) {
    var l = target.layer(1);
    if (!TL.isTextLayer(l)) return null;
    var r = l.sourceRectAtTime(t, false);
    if (!r || r.width <= 0 || r.height <= 0) return null;
    var tr = l.property("ADBE Transform Group");
    var pos = tr.property("ADBE Position").valueAtTime(t, false);
    var anc = tr.property("ADBE Anchor Point").valueAtTime(t, false);
    var sc = tr.property("ADBE Scale").valueAtTime(t, false);
    var sx = sc[0] / 100, sy = sc[1] / 100;
    var bw = r.width * Math.abs(sx), bh = r.height * Math.abs(sy);
    if (bw <= 0 || bh <= 0) return null;
    var cx = pos[0] + (r.left + r.width / 2 - anc[0]) * sx;
    var cy = pos[1] + (r.top + r.height / 2 - anc[1]) * sy;
    var fs = 0;
    try { fs = l.property("ADBE Text Properties").property("ADBE Text Document").valueAtTime(t, false).fontSize * Math.abs(sy); } catch (eF) {}
    var k = Math.min(TL.PREVIEW_TEXT_WIDTH * target.width / bw, TL.PREVIEW_TEXT_HEIGHT * target.height / bh);
    if (fs > 0) k = Math.min(k, TL.PREVIEW_FONT * target.height / fs);

    var wrap = app.project.items.addComp("TL_PREVIEW_WRAP", target.width, target.height, target.pixelAspect, target.duration, target.frameRate);
    wrap.bgColor = target.bgColor;
    var L = wrap.layers.add(target);
    L.startTime = 0;
    try { L.collapseTransformation = true; } catch (eC) {} // sharp text, nothing clipped at the comp edge
    L.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([cx, cy]);
    L.property("ADBE Transform Group").property("ADBE Position").setValue([target.width / 2, target.height / 2]);
    L.property("ADBE Transform Group").property("ADBE Scale").setValue([k * 100, k * 100]);
    return wrap;
};

/* Re-render the preview of a stored preset (imports its preset.aep, then removes it again). */
TL.rerenderPreview = function (destPath, compName, type, keepText) {
    var imported = null;
    try {
        var f = new File(destPath + "/preset.aep");
        if (!f.exists) return TL.err("Preset file not found: " + f.fsName);
        imported = app.project.importFile(new ImportOptions(f));
        var target = TL.findCompIn(imported, compName || TL.PRESET_COMP);
        if (!target) return TL.err("Preset composition not found.");
        var folder = new Folder(destPath + "/frames");
        if (!folder.exists) folder.create();
        var old = folder.getFiles("*.png");
        for (var i = 0; i < old.length; i++) old[i].remove();
        var count = TL.renderPreview(target, type, folder, keepText);
        return TL.ok({ frames: count, thumb: Math.max(1, Math.round(count * 0.6)) });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        try { if (imported) imported.remove(); } catch (eR) {}
    }
};

/* ------------------------------------------------------------------ */
/* SAVE  (two steps so preview frames can finish writing in between)   */
/* ------------------------------------------------------------------ */

TL._pending = null;

/*
 * Step 1: save the user's project, prepare the comp to store and render preview frames.
 * type: "simple" (selected text layer animation) | "complex" (active composition)
 */
TL.saveBegin = function (type, destPath) {
    var tempComp = null;
    try {
        var proj = app.project;
        var comp = TL.activeComp();
        if (!comp) return TL.err("No active composition. Open a composition in the timeline.");

        var srcLayer = null;
        if (type === "simple") {
            if (comp.selectedLayers.length !== 1) return TL.err("Select ONE animated text layer in the timeline.");
            srcLayer = comp.selectedLayers[0];
            if (!TL.isTextLayer(srcLayer)) return TL.err("The selected layer is not a text layer.");
        }

        // The project must live on disk: we save it, store a reduced copy, and reopen it.
        if (!proj.file) {
            proj.saveWithDialog();
            if (!proj.file) return TL.err("The project was not saved - operation cancelled.");
        } else {
            proj.save();
        }
        var origPath = proj.file.fsName;

        var dest = new Folder(destPath);
        if (!dest.exists) dest.create();
        var framesFolder = new Folder(dest.fsName + "/frames");
        if (!framesFolder.exists) framesFolder.create();

        var target;
        if (type === "simple") {
            target = tempComp = proj.items.addComp(TL.PRESET_COMP, comp.width, comp.height, comp.pixelAspect, comp.duration, comp.frameRate);
            target.bgColor = [0, 0, 0];
            srcLayer.copyToComp(target);
        } else {
            target = comp;
        }
        var oldRes = target.resolutionFactor;
        var count = TL.renderPreview(target, type, framesFolder);

        TL._pending = {
            compId: target.id,
            oldRes: oldRes,
            origPath: origPath,
            destPath: dest.fsName,
            compName: target.name
        };

        return TL.ok({
            frames: count,
            fps: TL.PREVIEW_FPS,
            thumb: Math.max(1, Math.round(count * 0.6)),
            compName: target.name,
            width: target.width,
            height: target.height
        });
    } catch (e) {
        try { if (tempComp) tempComp.remove(); } catch (eR) {}
        return TL.errFromException(e);
    }
};

/* Step 2: reduce the project to the stored comp, save it into the library, reopen the original. */
TL.saveFinish = function () {
    var p = TL._pending;
    TL._pending = null;
    if (!p) return TL.err("No save in progress.");
    try {
        var proj = app.project;
        var target = TL.findItemById(p.compId);
        if (!target) return TL.err("Composition not found.");
        try { target.resolutionFactor = p.oldRes; } catch (e1) {}

        proj.reduceProject([target]);
        proj.save(new File(p.destPath + "/preset.aep"));
        app.open(new File(p.origPath));
        return TL.ok({});
    } catch (e) {
        try { app.open(new File(p.origPath)); } catch (e2) {}
        return TL.errFromException(e);
    }
};

/* ------------------------------------------------------------------ */
/* APPLY SIMPLE  - copy animation from the stored text layer           */
/* ------------------------------------------------------------------ */

TL.toArr = function (v) { return (v instanceof Array) ? v.slice(0) : [v]; };
TL.fromArr = function (a, like) { return (like instanceof Array) ? a : a[0]; };

TL.dist = function (a, b) {
    var s = 0;
    for (var i = 0; i < a.length && i < b.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]);
    return Math.sqrt(s);
};

/* The keyframe value that is "at rest" = closest to a reference value. */
TL.restValue = function (prop, ref) {
    var best = null, bestD = Infinity;
    for (var k = 1; k <= prop.numKeys; k++) {
        var v = TL.toArr(prop.keyValue(k));
        var d = TL.dist(v, ref);
        if (d < bestD) { bestD = d; best = v; }
    }
    return best;
};

/*
 * Transform keyframes are made relative to the target layer so the text
 * stays where the user placed it. Returns a value-mapping function or null.
 */
TL.transformMapper = function (sp, dp, ctx) {
    var mn = sp.matchName, cur, rest, ref;
    try {
        // already animated (e.g. In applied before Out): use the resting value in the middle of the layer
        cur = TL.toArr(dp.numKeys > 0 ? dp.valueAtTime((ctx.dstIn + ctx.dstOut) / 2, false) : dp.value);
    } catch (e) { return null; }

    var additive = {
        "ADBE Position": [ctx.center[0], ctx.center[1], 0],
        "ADBE Position_0": [ctx.center[0]],
        "ADBE Position_1": [ctx.center[1]],
        "ADBE Position_2": [0],
        "ADBE Anchor Point": [0, 0, 0],
        "ADBE Rotate Z": [0],
        "ADBE Rotate X": [0],
        "ADBE Rotate Y": [0],
        "ADBE Orientation": [0, 0, 0]
    };
    var multiplicative = {
        "ADBE Scale": [100, 100, 100],
        "ADBE Opacity": [100]
    };

    if (additive[mn]) {
        rest = TL.restValue(sp, additive[mn]);
        return function (v) {
            var a = TL.toArr(v);
            for (var i = 0; i < a.length; i++) a[i] = a[i] + ((cur[i] !== undefined ? cur[i] : 0) - (rest[i] !== undefined ? rest[i] : 0));
            return TL.fromArr(a, v);
        };
    }
    if (multiplicative[mn]) {
        rest = TL.restValue(sp, multiplicative[mn]);
        return function (v) {
            var a = TL.toArr(v);
            for (var i = 0; i < a.length; i++) {
                var r = rest[i];
                // a current value of 0 (e.g. left invisible by an old Remove) must not flatten the animation
                if (r && cur[i] !== undefined && cur[i] !== 0) a[i] = a[i] * cur[i] / r;
            }
            return TL.fromArr(a, v);
        };
    }
    return null;
};

/*
 * In:  the animation starts at the target layer's in-point.
 * Out: the animation is played backwards and ends at the target layer's out-point.
 */
TL.mapTime = function (t, ctx) {
    if (ctx.reverse) return ctx.dstOut - (t - ctx.srcStart);
    return t - ctx.srcStart + ctx.dstIn;
};

/*
 * Animators and masks added by a preset are tagged "<name> [<preset>]" so Remove can find them.
 * Effects keep their exact names (expressions refer to them, e.g. effect("Elasticity")) -
 * they are recorded in the layer comment instead.
 */
TL.tag = function (label) { return " [" + label + "]"; };
TL.TAG_PARENTS = { "ADBE Text Animators": 1, "ADBE Mask Parade": 1 };

/* Small JSON blobs in the layer comment, one line per tag: "[TAG]{...}" */
TL.markRe = function (tag) { return new RegExp("\\n?\\[" + tag + "\\](\\{[^\\n]*\\})"); };
TL.readMark = function (layer, tag) {
    var m = TL.markRe(tag).exec(layer.comment || "");
    if (!m) return null;
    try { return eval("(" + m[1] + ")"); } catch (e) { return null; }
};
TL.writeMark = function (layer, tag, obj) {
    var c = (layer.comment || "").replace(TL.markRe(tag), "");
    layer.comment = obj ? c + (c ? "\n" : "") + "[" + tag + "]" + TL.str(obj) : c;
};

TL.resolve = function (layer, path) {
    var g = layer;
    for (var i = 0; i < path.length; i++) {
        g = g.property(path[i]);
        if (!g) return null;
    }
    return g;
};

/* Returns the new key times. When ctx.reverse is set, in/out sides of every key are swapped. */
TL.copyKeys = function (sp, dp, ctx, mapper) {
    var n = sp.numKeys, k, times = [], R = !!ctx.reverse;
    for (k = 1; k <= n; k++) {
        var t = TL.mapTime(sp.keyTime(k), ctx);
        var v = sp.keyValue(k);
        if (mapper) v = mapper(v);
        dp.setValueAtTime(t, v);
        times.push(t);
    }
    for (k = 1; k <= n; k++) {
        var idx = dp.nearestKeyIndex(times[k - 1]);
        try {
            var tIn = sp.keyInInterpolationType(k), tOut = sp.keyOutInterpolationType(k);
            dp.setInterpolationTypeAtKey(idx, R ? tOut : tIn, R ? tIn : tOut);
        } catch (e1) {}
        try {
            var ie = sp.keyInTemporalEase(k), oe = sp.keyOutTemporalEase(k), inA = [], outA = [], j;
            for (j = 0; j < ie.length; j++) inA.push(new KeyframeEase(ie[j].speed, ie[j].influence));
            for (j = 0; j < oe.length; j++) outA.push(new KeyframeEase(oe[j].speed, oe[j].influence));
            dp.setTemporalEaseAtKey(idx, R ? outA : inA, R ? inA : outA);
        } catch (e2) {}
        try { dp.setTemporalContinuousAtKey(idx, sp.keyTemporalContinuous(k)); } catch (e3) {}
        try { dp.setTemporalAutoBezierAtKey(idx, sp.keyTemporalAutoBezier(k)); } catch (e4) {}
        if (sp.isSpatial) {
            try {
                var si = sp.keyInSpatialTangent(k), so = sp.keyOutSpatialTangent(k);
                dp.setSpatialTangentsAtKey(idx, R ? so : si, R ? si : so);
            } catch (e5) {}
            try { dp.setSpatialContinuousAtKey(idx, sp.keySpatialContinuous(k)); } catch (e6) {}
            try { dp.setSpatialAutoBezierAtKey(idx, sp.keySpatialAutoBezier(k)); } catch (e7) {}
            try { dp.setRovingAtKey(idx, sp.keyRoving(k)); } catch (e8) {}
        }
    }
    return times;
};

/* path: where dp lives on the target layer - stored so Remove can find these keys later */
TL.copyProp = function (sp, dp, ctx, opts, path) {
    if (!dp) return;
    var vt = sp.propertyValueType;
    if (vt === PropertyValueType.NO_VALUE || vt === PropertyValueType.CUSTOM_VALUE) return;
    if (sp.matchName === "ADBE Text Document") return; // never overwrite the target's text

    // Separated dimensions (X/Y/Z Position)
    try {
        if (sp.isSeparationLeader) {
            if (sp.dimensionsSeparated) { dp.dimensionsSeparated = true; return; }
        } else if (sp.isSeparationFollower && !sp.separationLeader.dimensionsSeparated) {
            return;
        }
    } catch (eSep) {}

    var hasExpr = false;
    try { hasExpr = sp.canSetExpression && sp.expression !== ""; } catch (eX) {}

    var rec = (opts.record && ctx.record) ? ctx.record.keys : null;

    if (sp.numKeys > 0) {
        var hadKeys = dp.numKeys > 0, orig = null;
        if (!hadKeys) { try { orig = dp.value; } catch (eO) {} }
        var mapper = opts.relative ? TL.transformMapper(sp, dp, ctx) : null;
        try {
            var times = TL.copyKeys(sp, dp, ctx, mapper);
            if (rec) rec.push({ p: path, t: times, h: hadKeys, o: orig });
        } catch (eK) {}
    } else if (!opts.animatedOnly && sp.isModified) {
        // with an expression, .value is the expression result - copy the value underneath it
        try { dp.setValue(hasExpr ? sp.valueAtTime(0, true) : sp.value); } catch (eV) {}
    }

    if (hasExpr) {
        try {
            if (rec && dp.expression === "") rec.push({ p: path, e: 1 });
            dp.expression = TL.markerTiming(sp.expression, ctx);
            dp.expressionEnabled = sp.expressionEnabled;
        } catch (eE) {}
    }
};

TL.copyMaskAttrs = function (sp, dp) {
    try { dp.maskMode = sp.maskMode; } catch (e1) {}
    try { dp.inverted = sp.inverted; } catch (e2) {}
    try { dp.rotoBezier = sp.rotoBezier; } catch (e3) {}
    try { dp.maskMotionBlur = sp.maskMotionBlur; } catch (e4) {}
    try { dp.maskFeatherFalloff = sp.maskFeatherFalloff; } catch (e5) {}
};

/* A freshly added animator may come with a default selector/properties - remove them so only copied ones remain. */
TL.clearAnimator = function (dstLayer, animPath) {
    var names = ["ADBE Text Selectors", "ADBE Text Animator Properties"];
    for (var i = 0; i < names.length; i++) {
        var guard = 50;
        while (guard-- > 0) {
            try {
                // re-resolve every time: remove() invalidates references
                var g = TL.resolve(dstLayer, animPath.concat([names[i]]));
                if (!g || g.numProperties === 0) break;
                g.property(g.numProperties).remove();
            } catch (e) { break; }
        }
    }
};

/* A property that carries something to copy: keyframes, an expression or a non-default value. */
TL.propInUse = function (sp) {
    if (sp.propertyType !== PropertyType.PROPERTY) return true;
    try { if (sp.numKeys > 0 || sp.isModified) return true; } catch (e1) {}
    try { return sp.canSetExpression && sp.expression !== ""; } catch (e2) {}
    return false;
};

/*
 * Recursively copy a property group. Destination is addressed by a path from the layer and
 * re-resolved every time, because adding properties invalidates existing object references.
 */
TL.copyGroup = function (sg, dstLayer, dPath, ctx, opts) {
    for (var i = 1; i <= sg.numProperties; i++) {
        var sp = sg.property(i);
        if (!sp) continue;
        var dg = TL.resolve(dstLayer, dPath);
        if (!dg) return;

        var childKey;
        if (dg.propertyType === PropertyType.INDEXED_GROUP) {
            if (!dg.canAddProperty(sp.matchName)) continue;
            if (opts.phase && sp.matchName === "ADBE Text Animator" && TL.animPhase(sp.name) && TL.animPhase(sp.name) !== opts.phase) continue;
            var added = dg.addProperty(sp.matchName);
            if (!added) continue;
            childKey = added.propertyIndex;
            try { added.name = sp.name + (ctx.label && TL.TAG_PARENTS[dg.matchName] ? TL.tag(ctx.label) : ""); } catch (eN) {}
            if (dg.matchName === "ADBE Effect Parade" && ctx.record) ctx.record.fx.push({ mn: sp.matchName, n: sp.name });
            try { added.enabled = sp.enabled; } catch (eEn) {}
            if (sp.matchName === "ADBE Mask Atom") TL.copyMaskAttrs(sp, added);
            if (sp.matchName === "ADBE Text Animator") TL.clearAnimator(dstLayer, dPath.concat([childKey]));
        } else {
            if (dg.matchName === "ADBE Text Animator Properties") {
                // every animator lists all 100+ properties, but only added ones take effect:
                // add (activate) the ones the source uses, skip the rest
                if (!TL.propInUse(sp)) continue;
                try { dg.addProperty(sp.matchName); } catch (eA) {}
            }
            if (!TL.resolve(dstLayer, dPath.concat([sp.matchName]))) continue;
            childKey = sp.matchName;
        }

        var childPath = dPath.concat([childKey]);
        if (sp.propertyType === PropertyType.PROPERTY) {
            TL.copyProp(sp, TL.resolve(dstLayer, childPath), ctx, opts, childPath);
        } else {
            TL.copyGroup(sp, dstLayer, childPath, ctx, opts);
        }
    }
};

/*
 * TR In / TR Out markers (like Animation Composer): presets whose expressions time the transition
 * from the layer in/out point ("var tTrI=bL.inPoint+1.27;") are rewritten on apply to read the
 * time of a "TR In" / "TR Out" layer marker instead, so dragging the marker changes the duration.
 * The offsets found are kept on ctx, to place the marker.
 */
TL.TR_IN = "TR In";
TL.TR_OUT = "TR Out";
TL.TR_FN = "function tlMk(n,d){for(var i=1;i<=bL.marker.numKeys;i++){var k=bL.marker.key(i);if(k.comment==n)return k.time;}return d;}";

TL.markerTiming = function (expr, ctx) {
    if (!expr || expr.indexOf("tTrI=") < 0 || expr.indexOf("tlMk(") >= 0) return expr;
    var mi = /var tTrI=bL\.inPoint\+([0-9.]+);/.exec(expr), mo = /var tTrO=bL\.outPoint-([0-9.]+);/.exec(expr);
    if (!mi && !mo) return expr;
    if (mi) {
        if (ctx && ctx.trIn === undefined) ctx.trIn = parseFloat(mi[1]);
        expr = expr.replace(mi[0], "var tTrI=tlMk('" + TL.TR_IN + "',bL.inPoint+" + mi[1] + ");");
    }
    if (mo) {
        if (ctx && ctx.trOut === undefined) ctx.trOut = parseFloat(mo[1]);
        expr = expr.replace(mo[0], "var tTrO=tlMk('" + TL.TR_OUT + "',bL.outPoint-" + mo[1] + ");");
    }
    return expr.replace("var tTrI=", TL.TR_FN + "var tTrI=");
};

TL.findMarker = function (layer, comment) {
    var mk = layer.property("ADBE Marker");
    for (var i = 1; i <= mk.numKeys; i++) if (mk.keyValue(i).comment === comment) return i;
    return 0;
};

/* After In / Out: put the matching marker on the layer (kept where it is if already there). */
TL.addTrMarker = function (layer, mode, ctx) {
    try {
        var out = mode === "out", d = out ? ctx.trOut : ctx.trIn;
        if (d === undefined) return;
        var name = out ? TL.TR_OUT : TL.TR_IN;
        if (TL.findMarker(layer, name)) return;
        var t = out ? layer.outPoint - d : layer.inPoint + d;
        layer.property("ADBE Marker").setValueAtTime(t, new MarkerValue(name));
    } catch (e) {}
};

/* After Remove: drop TR markers no animator reads any more. */
TL.cleanTrMarkers = function (layer) {
    try {
        var uses = { "in": false, "out": false };
        var an = layer.property("ADBE Text Properties").property("ADBE Text Animators");
        for (var i = 1; i <= an.numProperties; i++) {
            var ph = TL.animPhase(an.property(i).name);
            if (ph) uses[ph] = true;
        }
        var drop = [[TL.TR_IN, uses["in"]], [TL.TR_OUT, uses["out"]]];
        for (var k = 0; k < drop.length; k++) {
            if (drop[k][1]) continue;
            var idx;
            while ((idx = TL.findMarker(layer, drop[k][0])) > 0) layer.property("ADBE Marker").removeKey(idx);
        }
    } catch (e) {}
};

/* "IN Overshoot" -> "in", "OUT Overshoot" -> "out", anything else -> null */
TL.animPhase = function (name) {
    var m = /^(IN|OUT) /.exec(String(name));
    return m ? m[1].toLowerCase() : null;
};
TL.hasPhases = function (anims) {
    var seen = {};
    for (var i = 1; i <= anims.numProperties; i++) seen[TL.animPhase(anims.property(i).name)] = true;
    return !!(seen["in"] && seen["out"]);
};

/* mode: "in" | "out"; label: preset name used to tag what is added (for Remove) */
TL.copyLayerAnimation = function (src, dst, srcComp, mode, label) {
    var r = TL.keyRange(src, { min: null, max: null });
    var ctx = {
        srcStart: r.min !== null ? r.min : src.inPoint,
        reverse: mode === "out",
        dstIn: dst.inPoint, dstOut: dst.outPoint,
        center: [srcComp.width / 2, srcComp.height / 2],
        label: label,
        record: { mode: mode, keys: [], fx: [] }
    };
    var warnings = [];
    // each part is copied on its own, so a failure in one (e.g. an effect) doesn't stop the keyframes
    var part = function (name, fn) {
        try { fn(); } catch (e) { warnings.push(name + ": " + e.toString()); }
    };

    // layer switches the preset turns on are remembered (TLS mark), so Remove can turn them off again
    var sw = TL.readMark(dst, "TLS") || {};
    try { if (src.threeDLayer && !dst.threeDLayer) { dst.threeDLayer = true; sw.d3 = true; } } catch (e1) {}
    try { if (src.threeDPerChar && TL.isTextLayer(dst) && !dst.threeDPerChar) { dst.threeDPerChar = true; sw.pc = true; } } catch (e2) {}
    try { if (src.motionBlur && !dst.motionBlur) { dst.motionBlur = true; sw.mb = true; } } catch (e3) {}
    if (sw.d3 || sw.pc || sw.mb) TL.writeMark(dst, "TLS", sw);

    if (TL.isTextLayer(src) && TL.isTextLayer(dst)) {
        var st = src.property("ADBE Text Properties");
        part("Text options", function () {
            TL.copyGroup(st.property("ADBE Text More Options"), dst, ["ADBE Text Properties", "ADBE Text More Options"], ctx, { record: true });
        });
        part("Text animators", function () {
            // presets with separate "IN ..." / "OUT ..." animators: In adds only the IN ones, Out only the OUT ones
            var anims = st.property("ADBE Text Animators"), phase = TL.hasPhases(anims) ? (mode === "out" ? "out" : "in") : null;
            TL.copyGroup(anims, dst, ["ADBE Text Properties", "ADBE Text Animators"], ctx, { phase: phase });
        });
    }
    part("Masks", function () { TL.copyGroup(src.property("ADBE Mask Parade"), dst, ["ADBE Mask Parade"], ctx, {}); });
    // effects before transform: transform expressions often read effect sliders
    part("Effects", function () { TL.copyGroup(src.property("ADBE Effect Parade"), dst, ["ADBE Effect Parade"], ctx, {}); });
    part("Transform", function () {
        TL.copyGroup(src.property("ADBE Transform Group"), dst, ["ADBE Transform Group"], ctx, { animatedOnly: true, relative: true, record: true });
    });

    // remember what was added to existing properties / effect stack, so Remove can undo it
    if (label && (ctx.record.keys.length || ctx.record.fx.length)) {
        var data = TL.readMark(dst, "TLA") || {};
        if (!(data[label] instanceof Array)) data[label] = [];
        data[label].push(ctx.record);
        // static values before ANY preset touched a property - kept per layer (not per preset),
        // so whichever preset is removed last can put the property back
        if (!data.__orig) data.__orig = {};
        for (var o = 0; o < ctx.record.keys.length; o++) {
            var rk = ctx.record.keys[o], id = String(rk.p);
            if (!rk.h && rk.o !== null && rk.o !== undefined && data.__orig[id] === undefined) data.__orig[id] = rk.o;
        }
        TL.writeMark(dst, "TLA", data);
    }

    if (TL.isTextLayer(dst)) TL.addTrMarker(dst, mode, ctx);
    TL.expressionErrors(dst, dst.name, warnings);
    return warnings;
};

/* Collect expression errors on the layer (After Effects silently disables a broken expression). */
TL.expressionErrors = function (group, prefix, out) {
    for (var i = 1; i <= group.numProperties; i++) {
        var p = group.property(i);
        if (!p) continue;
        if (p.propertyType === PropertyType.PROPERTY) {
            try {
                if (p.canSetExpression && p.expression !== "" && p.expressionError) {
                    out.push(prefix + " > " + p.name + ": " + p.expressionError.split(/\r|\n/)[0]);
                }
            } catch (e) {}
        } else {
            TL.expressionErrors(p, prefix + " > " + p.name, out);
        }
    }
};

/*
 * Remove one preset from the selected layers - everything it added and nothing else:
 * its text animators / masks (tagged "[label]"), its effects, its keyframes and expressions.
 * Other presets on the same layer stay. When the last keyframe of a property goes, the property
 * gets back the static value it had before any preset touched it.
 */
/*
 * Remove: the selected layers go back to static - every Text Library animation on them is removed
 * (not only the one whose card was clicked), plus leftovers of Animation Composer presets.
 */
TL.removePreset = function (label) {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var sel = comp.selectedLayers, layers = [], i;
    for (i = 0; i < sel.length; i++) layers.push(sel[i]);
    if (!layers.length) return TL.err("Select the layers to remove the animation from.");

    app.beginUndoGroup("Text Library: Remove " + label);
    try {
        var touched = 0;
        for (i = 0; i < layers.length; i++) {
            var changes = 0;
            TL.withUnlocked(layers[i], function () { changes = TL.removeAllFromLayer(layers[i], label, comp.frameDuration / 2); });
            if (changes) touched++;
        }
        if (!touched) return TL.err("No Text Library animation found on the selected layers.");
        return TL.ok({ layers: touched });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* Labels of every preset applied to the layer: recorded ones + " [label]" tags on added groups. */
TL.presetLabels = function (layer, first) {
    var seen = {}, out = [];
    function add(l) { if (l && !seen[l]) { seen[l] = true; out.push(l); } }
    add(first);
    var data = TL.readMark(layer, "TLA") || {};
    for (var k in data) if (data.hasOwnProperty(k) && k !== "__orig") add(k);
    var parades = [["ADBE Text Properties", "ADBE Text Animators"], ["ADBE Mask Parade"], ["ADBE Effect Parade"]];
    for (var p = 0; p < parades.length; p++) {
        var g = TL.resolve(layer, parades[p]);
        for (var j = 1; g && j <= g.numProperties; j++) {
            var m = / \[([^\]]+)\]$/.exec(g.property(j).name);
            if (m) add(m[1]);
        }
    }
    return out;
};

TL.removeAllFromLayer = function (layer, label, tol) {
    var changes = 0, labels = TL.presetLabels(layer, label);
    for (var i = 0; i < labels.length; i++) changes += TL.removePresetFromLayer(layer, labels[i], tol);
    changes += TL.stripAnimationComposer(layer);
    TL.cleanTrMarkers(layer);
    // switches the presets turned on (motion blur, 3D) go back off once nothing is left
    var sw = TL.readMark(layer, "TLS");
    if (sw && !TL.readMark(layer, "TLA")) {
        try { if (sw.mb) layer.motionBlur = false; } catch (e1) {}
        try { if (sw.pc) layer.threeDPerChar = false; } catch (e2) {}
        try { if (sw.d3) layer.threeDLayer = false; } catch (e3) {}
        TL.writeMark(layer, "TLS", null);
        changes++;
    }
    return changes;
};

/* Animation Composer presets: "AC IN/OUT ..." animators, its pseudo control effects, its TR markers and expressions. */
TL.stripAnimationComposer = function (layer) {
    var changes = 0, j;
    try {
        var path = ["ADBE Text Properties", "ADBE Text Animators"];
        for (j = TL.resolve(layer, path).numProperties; j >= 1; j--) {
            var a = TL.resolve(layer, path).property(j);
            if (a && /^AC (IN|OUT) \[/.test(a.name)) { a.remove(); changes++; }
        }
    } catch (e1) {}
    try {
        for (j = layer.property("ADBE Effect Parade").numProperties; j >= 1; j--) {
            var ef = layer.property("ADBE Effect Parade").property(j);
            if (ef && ef.matchName.indexOf("Pseudo/MHAC") === 0) { ef.remove(); changes++; }
        }
    } catch (e2) {}
    try {
        var mk = layer.property("ADBE Marker");
        for (j = mk.numKeys; j >= 1; j--) {
            var p = mk.keyValue(j).getParameters();
            if (p && p["zzzzzzzzzzzzzzz_ACMarkerType"] !== undefined) { mk.removeKey(j); changes++; }
        }
    } catch (e3) {}
    try {
        var mo = layer.property("ADBE Text Properties").property("ADBE Text More Options");
        for (j = 1; j <= mo.numProperties; j++) {
            var q = mo.property(j);
            if (q && q.canSetExpression && q.expression.indexOf("getAnimationComposerPresetValue") >= 0) { q.expression = ""; changes++; }
        }
    } catch (e4) {}
    return changes;
};

TL.removePresetFromLayer = function (layer, label, tol) {
    var changes = 0, j, k;
    var suffix = TL.tag(label);

    // 1) tagged groups (Effect Parade too: effects were tagged by an older panel version)
    var parades = [["ADBE Text Properties", "ADBE Text Animators"], ["ADBE Mask Parade"], ["ADBE Effect Parade"]];
    for (var p = 0; p < parades.length; p++) {
        var g = TL.resolve(layer, parades[p]);
        if (!g) continue;
        for (j = g.numProperties; j >= 1; j--) {
            var item = TL.resolve(layer, parades[p]).property(j); // re-resolve: remove() invalidates refs
            var n = item ? item.name : "";
            if (n.length >= suffix.length && n.substr(n.length - suffix.length) === suffix) { item.remove(); changes++; }
        }
    }

    TL.cleanTrMarkers(layer);

    // 2) recorded effects, keyframes and expressions
    var data = TL.readMark(layer, "TLA");
    var recs = data && data[label];
    if (!(recs instanceof Array)) return changes;
    var touchedPaths = [];

    for (var r = 0; r < recs.length; r++) {
        var fx = recs[r].fx || [];
        for (k = fx.length - 1; k >= 0; k--) {
            var parade = layer.property("ADBE Effect Parade");
            for (j = parade.numProperties; j >= 1; j--) {
                var ef = layer.property("ADBE Effect Parade").property(j);
                if (ef && ef.matchName === fx[k].mn && ef.name === fx[k].n) { ef.remove(); changes++; break; }
            }
        }
        var keys = recs[r].keys || [];
        for (k = 0; k < keys.length; k++) {
            var e = keys[k], prop = TL.resolve(layer, e.p);
            if (!prop) continue;
            touchedPaths.push(e);
            if (e.e) { try { prop.expression = ""; changes++; } catch (eE) {} }
            for (j = 0; e.t && j < e.t.length; j++) {
                try {
                    if (prop.numKeys === 0) break;
                    var idx = prop.nearestKeyIndex(e.t[j]);
                    if (Math.abs(prop.keyTime(idx) - e.t[j]) <= tol) { prop.removeKey(idx); changes++; }
                } catch (eK) {}
            }
        }
    }

    // 3) properties left without keyframes get their pre-preset static value back
    var orig = data.__orig || {};
    for (k = 0; k < touchedPaths.length; k++) {
        var id = String(touchedPaths[k].p);
        var v = orig[id] !== undefined ? orig[id] : touchedPaths[k].o; // .o: records from older versions
        try {
            var rp = TL.resolve(layer, touchedPaths[k].p);
            if (rp && rp.numKeys === 0) {
                if (v !== null && v !== undefined) rp.setValue(v);
                delete orig[id];
            }
        } catch (eS) {}
    }

    delete data[label];
    var left = false;
    for (var key in data) {
        if (!data.hasOwnProperty(key) || key === "__orig") continue;
        left = true;
        break;
    }
    TL.writeMark(layer, "TLA", left ? data : null);
    return changes;
};

TL.applySimple = function (aepPath, compName, mode, label) {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var sel = comp.selectedLayers, targets = [], i;
    for (i = 0; i < sel.length; i++) targets.push(sel[i]);
    if (!targets.length) return TL.err("Select text layers in the timeline to apply the animation.");

    app.beginUndoGroup("Text Library: Apply Animation");
    var imported = null;
    try {
        var f = new File(aepPath);
        if (!f.exists) return TL.err("Preset file not found: " + aepPath);
        imported = app.project.importFile(new ImportOptions(f));
        var srcComp = TL.findCompIn(imported, compName || TL.PRESET_COMP);
        if (!srcComp || srcComp.numLayers < 1) return TL.err("Preset composition not found.");
        var src = srcComp.layer(1);

        var applied = 0, skipped = 0, warnings = [];
        for (i = 0; i < targets.length; i++) {
            if (!TL.isTextLayer(targets[i])) { skipped++; continue; }
            warnings = warnings.concat(TL.copyLayerAnimation(src, targets[i], srcComp, mode === "out" ? "out" : "in", label || ""));
            applied++;
        }
        return TL.ok({ applied: applied, skipped: skipped, warnings: warnings });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        try { if (imported) imported.remove(); } catch (eR) {}
        try { comp.openInViewer(); } catch (eV) {}
        app.endUndoGroup();
    }
};

/* ------------------------------------------------------------------ */
/* APPLY COMPLEX - import stored comp as a precomp layer               */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* SOUNDS - import a folder of sound effects, add one at the CTI       */
/* ------------------------------------------------------------------ */

TL.pickFolder = function (title) {
    var f = Folder.selectDialog(title || "Choose a folder");
    return TL.ok({ path: f ? f.fsName : null });
};

// the sound is imported once (kept in "Text Library/Sounds") and added to the active comp at the current time
TL.addSound = function (filePath, label) {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var f = new File(filePath);
    if (!f.exists) return TL.err("Sound file not found: " + filePath);

    app.beginUndoGroup("Text Library: Add Sound");
    try {
        var root = TL.getProjectFolder(TL.PROJECT_FOLDER), folder = null, item = null, i;
        for (i = 1; i <= root.numItems; i++) if (root.item(i) instanceof FolderItem && root.item(i).name === "Sounds") folder = root.item(i);
        if (!folder) { folder = app.project.items.addFolder("Sounds"); folder.parentFolder = root; }
        for (i = 1; i <= folder.numItems; i++) {
            var it = folder.item(i);
            if (it instanceof FootageItem && it.file && it.file.fsName === f.fsName) { item = it; break; }
        }
        if (!item) {
            item = app.project.importFile(new ImportOptions(f));
            item.parentFolder = folder;
            if (label) item.name = label;
        }
        var layer = comp.layers.add(item);
        layer.startTime = comp.time;
        for (i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        layer.selected = true;
        try { comp.openInViewer(); } catch (eV) {}
        return TL.ok({});
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

TL.applyComplex = function (aepPath, compName, label) {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");

    app.beginUndoGroup("Text Library: Add Composition");
    try {
        var f = new File(aepPath);
        if (!f.exists) return TL.err("Preset file not found: " + aepPath);
        var imported = app.project.importFile(new ImportOptions(f));
        var srcComp = TL.findCompIn(imported, compName);
        if (!srcComp) {
            imported.remove();
            return TL.err("Composition not found: " + compName);
        }
        imported.parentFolder = TL.getProjectFolder(TL.PROJECT_FOLDER);
        if (label) imported.name = label;

        var layer = comp.layers.add(srcComp);
        layer.startTime = comp.time;
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        layer.selected = true;
        try { comp.openInViewer(); } catch (eV) {}
        return TL.ok({});
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ------------------------------------------------------------------ */
/* EDIT - text layers inside the selected precomp                      */
/* ------------------------------------------------------------------ */

TL.textProp = function (layer) {
    return layer.property("ADBE Text Properties").property("ADBE Text Document");
};

TL.currentDoc = function (layer) {
    var p = TL.textProp(layer);
    return p.numKeys > 0 ? p.keyValue(1) : p.value;
};

/* Position as one or two properties (separated dimensions). */
TL.posProps = function (layer) {
    var tr = layer.property("ADBE Transform Group");
    var pos = tr.property("ADBE Position");
    if (pos.dimensionsSeparated) {
        return [{ p: tr.property("ADBE Position_0"), dim: 0 }, { p: tr.property("ADBE Position_1"), dim: 1 }];
    }
    return [{ p: pos, dim: -1 }];
};

/* Reference position = first keyframe (or static value). */
TL.posRef = function (layer) {
    var list = TL.posProps(layer), out = [0, 0];
    for (var i = 0; i < list.length; i++) {
        var p = list[i].p, v = p.numKeys > 0 ? p.keyValue(1) : p.value;
        if (list[i].dim === -1) { out[0] = v[0]; out[1] = v[1]; } else out[list[i].dim] = v;
    }
    return out;
};

/* Move the layer by dx/dy, shifting every position keyframe so the animation is preserved. */
TL.shiftPos = function (layer, dx, dy) {
    var list = TL.posProps(layer);
    for (var i = 0; i < list.length; i++) {
        var p = list[i].p, dim = list[i].dim;
        var add = function (v) {
            if (dim === -1) { v = v.slice(0); v[0] += dx; v[1] += dy; return v; }
            return v + (dim === 0 ? dx : dy);
        };
        if (p.numKeys > 0) {
            for (var k = 1; k <= p.numKeys; k++) p.setValueAtKey(k, add(p.keyValue(k)));
        } else {
            p.setValue(add(p.value));
        }
    }
};

TL.justName = function (v) {
    if (v === ParagraphJustification.LEFT_JUSTIFY) return "left";
    if (v === ParagraphJustification.CENTER_JUSTIFY) return "center";
    if (v === ParagraphJustification.RIGHT_JUSTIFY) return "right";
    return "other";
};

TL.justValue = function (name) {
    if (name === "left") return ParagraphJustification.LEFT_JUSTIFY;
    if (name === "center") return ParagraphJustification.CENTER_JUSTIFY;
    if (name === "right") return ParagraphJustification.RIGHT_JUSTIFY;
    return null;
};

/* Original state is kept in the layer comment as "[TL]{...}" so Reset survives saving/reopening. */
TL.SNAP_RE = /\n?\[TL\](\{[^\n]*\})/;

TL.readSnap = function (layer) {
    var m = TL.SNAP_RE.exec(layer.comment || "");
    if (!m) return null;
    try { return eval("(" + m[1] + ")"); } catch (e) { return null; }
};

TL.writeSnap = function (layer, s) {
    var c = (layer.comment || "").replace(TL.SNAP_RE, "");
    layer.comment = c + (c ? "\n" : "") + "[TL]" + TL.str(s);
};

TL.snapshot = function (layer) {
    var s = TL.readSnap(layer);
    if (s) {
        // snapshots from older panel versions have no paragraph alignment yet
        if (s.justification === undefined) {
            try { s.justification = TL.justName(TL.currentDoc(layer).justification); TL.writeSnap(layer, s); } catch (eJ) {}
        }
        return s;
    }
    var doc = TL.currentDoc(layer), ref = TL.posRef(layer);
    s = { text: doc.text, px: ref[0], py: ref[1] };
    try { s.fontSize = doc.fontSize; } catch (e1) {}
    try { s.tracking = doc.tracking; } catch (e2) {}
    try { s.leading = doc.leading; } catch (e3) {}
    try { s.autoLeading = !!doc.autoLeading; } catch (e4) { s.autoLeading = false; }
    try { s.justification = TL.justName(doc.justification); } catch (e5) {}
    TL.writeSnap(layer, s);
    return s;
};

/* State shown in the panel. x / y are offsets from the original position. */
TL.textState = function (comp, index) {
    var l = comp.layer(index);
    var snap = TL.snapshot(l);
    var doc = TL.currentDoc(l), ref = TL.posRef(l);
    var item = { compId: comp.id, compName: comp.name, index: index, layer: l.name, text: doc.text };
    try { item.fontSize = doc.fontSize; } catch (e1) {}
    try { item.tracking = doc.tracking; } catch (e2) {}
    try { item.autoLeading = !!doc.autoLeading; } catch (e3) { item.autoLeading = false; }
    try { item.leading = doc.leading; } catch (e4) {}
    try { item.justification = TL.justName(doc.justification); } catch (e5) {}
    item.x = Math.round((ref[0] - snap.px) * 10) / 10;
    item.y = Math.round((ref[1] - snap.py) * 10) / 10;
    return item;
};

/* Explain why (part of) the text may be invisible after an edit. */
TL.textWarnings = function (layer, comp) {
    var w = [];
    try {
        var tr = layer.property("ADBE Transform Group");
        var r = layer.sourceRectAtTime(comp.time, false);
        var pos = tr.property("ADBE Position").value, anc = tr.property("ADBE Anchor Point").value, sc = tr.property("ADBE Scale").value;
        var left = pos[0] + (r.left - anc[0]) * sc[0] / 100, right = pos[0] + (r.left + r.width - anc[0]) * sc[0] / 100;
        var top = pos[1] + (r.top - anc[1]) * sc[1] / 100, bottom = pos[1] + (r.top + r.height - anc[1]) * sc[1] / 100;
        if (!layer.parent && (left < 0 || top < 0 || right > comp.width || bottom > comp.height)) {
            w.push("The text goes outside the bounds of \"" + comp.name + "\" (" + comp.width + "x" + comp.height + ") and that part is hidden. Use Move X/Y or reduce the Font Size.");
        }
    } catch (e1) {}
    try {
        if (layer.property("ADBE Mask Parade").numProperties > 0) w.push("The layer has a mask - anything outside it is hidden.");
    } catch (e2) {}
    try {
        var matte = (layer.hasTrackMatte !== undefined) ? layer.hasTrackMatte : (layer.trackMatteType !== TrackMatteType.NO_TRACK_MATTE);
        if (matte) w.push("The layer uses a track matte - anything outside it is hidden.");
    } catch (e3) {}
    return w.join(" ");
};

TL.collectTexts = function (comp, out, visited) {
    if (visited[comp.id]) return;
    visited[comp.id] = true;
    for (var i = 1; i <= comp.numLayers; i++) {
        var l = comp.layer(i);
        if (TL.isTextLayer(l)) {
            out.push(TL.textState(comp, i));
        } else if (l.source && l.source instanceof CompItem) {
            TL.collectTexts(l.source, out, visited);
        }
    }
};

/*
 * What the Edit tab should show: the selected precomp layer in the timeline,
 * otherwise a single composition selected in the Project panel.
 */
TL.selTarget = function () {
    var active = app.project ? app.project.activeItem : null;
    if (active && active instanceof CompItem) {
        var sel = active.selectedLayers;
        if (sel.length === 1 && sel[0].source instanceof CompItem) {
            return { comp: sel[0].source, outer: active, layerIndex: sel[0].index, name: sel[0].name };
        }
    }
    var ps = app.project ? app.project.selection : [];
    if (ps.length === 1 && ps[0] instanceof CompItem) return { comp: ps[0], outer: null, layerIndex: 0, name: ps[0].name };
    return null;
};

/* Cheap string identifying the current target - polled by the panel. Empty = nothing suitable selected. */
TL.selectionKey = function () {
    try {
        var t = TL.selTarget();
        if (!t) return "";
        return t.comp.id + ":" + (t.outer ? t.outer.id + ":" + t.layerIndex : "");
    } catch (e) {
        return "";
    }
};

TL.getTexts = function () {
    try {
        var t = TL.selTarget();
        if (!t) return TL.err("Select a precomp layer in the timeline or a composition in the Project panel.");
        var out = [];
        app.beginUndoGroup("Text Library: Read Texts"); // first read stores the original state in layer comments
        try {
            TL.collectTexts(t.comp, out, {});
        } finally {
            app.endUndoGroup();
        }
        return TL.ok({
            name: t.name,
            compId: t.comp.id,
            outerId: t.outer ? t.outer.id : 0,
            layerIndex: t.layerIndex,
            duration: t.comp.duration,
            fps: t.comp.frameRate,
            width: t.comp.width,
            height: t.comp.height,
            texts: out
        });
    } catch (e) {
        return TL.errFromException(e);
    }
};

/* props: any of { text, fontSize, tracking, leading, autoLeading } */
TL.applyDocProps = function (doc, props) {
    if (props.text !== undefined) doc.text = props.text;
    if (props.fontSize !== undefined) doc.fontSize = props.fontSize;
    if (props.tracking !== undefined) doc.tracking = props.tracking;
    if (props.justification !== undefined && TL.justValue(props.justification) !== null) {
        doc.justification = TL.justValue(props.justification);
    }
    if (props.autoLeading === true) {
        try { doc.autoLeading = true; } catch (e1) {}
    } else if (props.leading !== undefined) {
        try { doc.autoLeading = false; } catch (e2) {}
        doc.leading = props.leading;
    }
    // Paragraph (box) text: grow the box so new lines are not cut off at the bottom.
    try {
        if (doc.boxText) {
            var lines = String(doc.text).split(/\r\n|\r|\n|\u0003/).length;
            var lh = (doc.autoLeading || !doc.leading) ? doc.fontSize * 1.2 : doc.leading;
            var need = Math.ceil(lines * lh + doc.fontSize * 0.4);
            var bs = doc.boxTextSize;
            if (bs[1] < need) doc.boxTextSize = [bs[0], need];
        }
    } catch (e3) {}
    return doc;
};

TL.editLayer = function (compId, layerIndex) {
    var comp = TL.findItemById(compId);
    if (!comp || !(comp instanceof CompItem)) throw new Error("Composition not found.");
    var layer = comp.layer(layerIndex);
    if (!TL.isTextLayer(layer)) throw new Error("Text layer not found.");
    return { comp: comp, layer: layer };
};

TL.setDoc = function (layer, props) {
    var prop = TL.textProp(layer);
    if (prop.numKeys > 0) {
        for (var k = 1; k <= prop.numKeys; k++) prop.setValueAtKey(k, TL.applyDocProps(prop.keyValue(k), props));
    } else {
        prop.setValue(TL.applyDocProps(prop.value, props));
    }
};

/* props: doc props (see applyDocProps) and/or move: [dx, dy] */
TL.setTextProps = function (compId, layerIndex, props) {
    app.beginUndoGroup("Text Library: Edit Text");
    try {
        var t = TL.editLayer(compId, layerIndex);
        TL.snapshot(t.layer);
        if (props.move) TL.shiftPos(t.layer, props.move[0], props.move[1]);
        if (props.text !== undefined || props.fontSize !== undefined || props.tracking !== undefined ||
            props.leading !== undefined || props.autoLeading !== undefined || props.justification !== undefined) {
            TL.setDoc(t.layer, props);
        }
        return TL.ok({ state: TL.textState(t.comp, layerIndex), warning: TL.textWarnings(t.layer, t.comp) });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* key: text | fontSize | tracking | leading | x | y */
TL.resetTextProp = function (compId, layerIndex, key) {
    app.beginUndoGroup("Text Library: Reset");
    try {
        var t = TL.editLayer(compId, layerIndex);
        var s = TL.snapshot(t.layer);
        if (key === "x" || key === "y") {
            var ref = TL.posRef(t.layer);
            TL.shiftPos(t.layer, key === "x" ? s.px - ref[0] : 0, key === "y" ? s.py - ref[1] : 0);
        } else if (key === "leading") {
            TL.setDoc(t.layer, s.autoLeading ? { autoLeading: true } : { leading: s.leading });
        } else if (key === "justification") {
            if (s.justification) TL.setDoc(t.layer, { justification: s.justification });
        } else if (key === "text" || key === "fontSize" || key === "tracking") {
            var p = {};
            p[key] = s[key];
            TL.setDoc(t.layer, p);
        } else {
            return TL.err("Unknown field: " + key);
        }
        return TL.ok({ state: TL.textState(t.comp, layerIndex), warning: TL.textWarnings(t.layer, t.comp) });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ------------------------------------------------------------------ */
/* NEW LAYER - null / adjustment / shape                                */
/* ------------------------------------------------------------------ */

TL.nextName = function (comp, base) {
    var n = 1;
    for (var i = 1; i <= comp.numLayers; i++) {
        var m = comp.layer(i).name.match(new RegExp("^" + base + " (\\d+)$"));
        if (m && +m[1] >= n) n = +m[1] + 1;
    }
    return base + " " + n;
};

TL.newLayer = function (type) {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var sel = comp.selectedLayers;
    var above = sel.length ? sel[0] : null;

    // solid: made right away at the comp's size (AE's New Solid dialog remembers the last size instead),
    // then AE's own Solid Settings dialog opens on it for the colour / name - Cancel keeps a white solid
    if (type === "solid") {
        var L;
        app.beginUndoGroup("Text Library: New Solid");
        try {
            L = comp.layers.addSolid([1, 1, 1], TL.nextName(comp, "White Solid"), comp.width, comp.height, comp.pixelAspect, comp.duration);
            if (above) L.moveBefore(above);
            for (var j = 1; j <= comp.numLayers; j++) comp.layer(j).selected = false;
            L.selected = true;
        } catch (eS) {
            return TL.errFromException(eS);
        } finally {
            app.endUndoGroup();
        }
        comp.openInViewer(); // Layer > Solid Settings works on the selected layer of the comp in front
        var cmd = app.findMenuCommandId("Solid Settings...");
        if (cmd > 0) app.executeCommand(cmd);
        return TL.ok({ name: L.name });
    }

    app.beginUndoGroup("Text Library: New Layer");
    try {
        var bases = { "null": "Null", "adjustment": "Adjustment Layer", "shape": "Shape Layer", "text": "Text" };
        if (!bases[type]) return TL.err("Unknown layer type: " + type);
        var name = TL.nextName(comp, bases[type]); // computed before adding so the new layer isn't counted

        var layer;
        if (type === "text") {
            layer = comp.layers.addText("Text");
            name = null; // a text layer is named after its content, like in After Effects
        } else if (type === "null") {
            layer = comp.layers.addNull(comp.duration);
        } else if (type === "adjustment") {
            layer = comp.layers.addSolid([1, 1, 1], name, comp.width, comp.height, comp.pixelAspect, comp.duration);
            layer.adjustmentLayer = true;
        } else {
            layer = comp.layers.addShape();
        }
        if (name) layer.name = name;
        if (above) layer.moveBefore(above);
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        layer.selected = true;
        return TL.ok({ name: layer.name });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ------------------------------------------------------------------ */
/* DURATION - change a comp's length and stretch layers that reach its end */
/* ------------------------------------------------------------------ */

/* The comp shown in the Edit tab (by id) plus, if it came from a timeline layer, that precomp layer. */
TL.durationTarget = function (compId, outerId, layerIndex) {
    var comp = TL.findItemById(compId);
    if (!comp || !(comp instanceof CompItem)) return null;
    var layer = null;
    if (outerId) {
        var outer = TL.findItemById(outerId);
        try {
            var l = outer.layer(layerIndex);
            if (l.source && l.source.id === comp.id) layer = l; // layers may have been reordered since
        } catch (e) {}
    }
    return { comp: comp, layer: layer };
};

/*
 * Set comp duration to newDur. Layers that ended at the old end (within one frame) are moved
 * to the new end; nested precomps are lengthened as needed. done: comp id -> length already applied.
 */
TL.resizeComp = function (comp, newDur, done) {
    if (done[comp.id] !== undefined && done[comp.id] >= newDur) return 0;
    done[comp.id] = newDur;

    var oldDur = comp.duration;
    var frame = comp.frameDuration;
    var fullWorkArea = comp.workAreaStart < frame && comp.workAreaDuration >= oldDur - frame;
    comp.duration = newDur;
    if (fullWorkArea) {
        try { comp.workAreaStart = 0; comp.workAreaDuration = newDur; } catch (eW) {}
    }

    var changed = 0;
    for (var i = 1; i <= comp.numLayers; i++) {
        var l = comp.layer(i);
        if (l.outPoint < oldDur - frame / 2) continue; // layer ends earlier on purpose - leave it

        if (l.source instanceof CompItem && l.stretch === 100) {
            var need = newDur - l.startTime;
            if (l.source.duration < need) TL.resizeComp(l.source, need, done);
        }
        var locked = l.locked;
        try {
            if (locked) l.locked = false;
            l.outPoint = newDur;
            changed++;
        } catch (eO) {
            // e.g. video footage shorter than the new length - leave it
        } finally {
            if (locked) l.locked = true;
        }
    }
    return changed;
};

TL.setDuration = function (seconds, compId, outerId, layerIndex) {
    var t = TL.durationTarget(compId, outerId, layerIndex);
    if (!t) return TL.err("Composition not found.");
    if (!(seconds > 0)) return TL.err("Duration must be greater than 0.");

    app.beginUndoGroup("Text Library: Set Duration");
    try {
        // snap to whole frames
        var fps = t.comp.frameRate;
        var newDur = Math.round(seconds * fps) / fps;
        var layers = TL.resizeComp(t.comp, newDur, {});

        if (t.layer && t.layer.stretch === 100) {
            var locked = t.layer.locked;
            try {
                if (locked) t.layer.locked = false;
                t.layer.outPoint = t.layer.startTime + newDur;
            } catch (eL) {
            } finally {
                if (locked) t.layer.locked = true;
            }
        }
        return TL.ok({ name: t.comp.name, duration: newDur, layers: layers });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ------------------------------------------------------------------ */
/* SIZE - change comp width/height around its centre (like Ctrl+K)      */
/* ------------------------------------------------------------------ */

/* Add dx/dy to a 2D/3D spatial property (all keyframes, or the static value). */
TL.shiftVector = function (p, dx, dy) {
    var add = function (v) { v = v.slice(0); v[0] += dx; v[1] += dy; return v; };
    if (p.numKeys > 0) {
        for (var k = 1; k <= p.numKeys; k++) p.setValueAtKey(k, add(p.keyValue(k)));
    } else {
        p.setValue(add(p.value));
    }
};

TL.withUnlocked = function (layer, fn) {
    var locked = layer.locked;
    try {
        if (locked) layer.locked = false;
        fn();
    } finally {
        if (locked) layer.locked = true;
    }
};

TL.setCompSize = function (compId, w, h) {
    w = Math.round(w);
    h = Math.round(h);
    if (!(w >= 4 && w <= 30000 && h >= 4 && h <= 30000)) return TL.err("Size must be between 4 and 30000.");
    var comp = TL.findItemById(compId);
    if (!comp || !(comp instanceof CompItem)) return TL.err("Composition not found.");
    if (comp.width === w && comp.height === h) return TL.ok({ name: comp.name, width: w, height: h });

    app.beginUndoGroup("Text Library: Composition Size");
    try {
        var dx = (w - comp.width) / 2, dy = (h - comp.height) / 2;
        comp.width = w;
        comp.height = h;

        // keep the content centred: move every top-level layer by half the size change
        for (var i = 1; i <= comp.numLayers; i++) {
            (function (l) {
                if (l.parent) return; // children follow their parent
                try { TL.withUnlocked(l, function () { TL.shiftPos(l, dx, dy); }); } catch (e1) {}
                // keep the Edit tab's stored original position in sync, so Reset doesn't jump back
                var s = TL.isTextLayer(l) ? TL.readSnap(l) : null;
                if (s) { s.px += dx; s.py += dy; TL.writeSnap(l, s); }
            })(comp.layer(i));
        }

        // in comps that use this one, shift the anchor point so the content stays where it was on screen
        var users = comp.usedIn;
        for (var u = 0; u < users.length; u++) {
            for (var j = 1; j <= users[u].numLayers; j++) {
                (function (l) {
                    if (!l.source || l.source.id !== comp.id) return;
                    try {
                        TL.withUnlocked(l, function () {
                            TL.shiftVector(l.property("ADBE Transform Group").property("ADBE Anchor Point"), dx, dy);
                        });
                    } catch (e2) {}
                })(users[u].layer(j));
            }
        }
        return TL.ok({ name: comp.name, width: comp.width, height: comp.height });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ------------------------------------------------------------------ */
/* DEEP COPY - fully independent duplicate of the selected precomp      */
/* ------------------------------------------------------------------ */

/* Duplicate a comp and, recursively, every comp nested inside it. map: original id -> copy (shared nests copied once). */
TL.dupDeep = function (comp, map) {
    if (map[comp.id]) return map[comp.id];
    var d = comp.duplicate();
    map[comp.id] = d;
    for (var i = 1; i <= d.numLayers; i++) {
        var l = d.layer(i);
        if (l.source && l.source instanceof CompItem) {
            l.replaceSource(TL.dupDeep(l.source, map), false);
        }
    }
    return d;
};

TL.deepCopy = function () {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var sel = comp.selectedLayers;
    if (sel.length !== 1 || !(sel[0].source instanceof CompItem)) {
        return TL.err("Select a precomp layer in the timeline for Deep Copy.");
    }

    app.beginUndoGroup("Text Library: Deep Copy");
    try {
        var map = {};
        var copy = TL.dupDeep(sel[0].source, map);
        var count = 0;
        for (var k in map) if (map.hasOwnProperty(k)) count++;

        var layer = sel[0].duplicate();
        layer.replaceSource(copy, false);
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        layer.selected = true;
        return TL.ok({ name: copy.name, comps: count });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ------------------------------------------------------------------ */
/* FLOW - apply a cubic-bezier easing to selected keyframes             */
/* ------------------------------------------------------------------ */

TL.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

TL.easePair = function (p, a, b, x1, y1, x2, y2) {
    var dt = p.keyTime(b) - p.keyTime(a);
    if (dt <= 0) return false;

    var BEZ = KeyframeInterpolationType.BEZIER;
    p.setInterpolationTypeAtKey(a, p.keyInInterpolationType(a), BEZ);
    p.setInterpolationTypeAtKey(b, BEZ, p.keyOutInterpolationType(b));
    try { p.setTemporalAutoBezierAtKey(a, false); p.setTemporalAutoBezierAtKey(b, false); } catch (e1) {}
    try { p.setTemporalContinuousAtKey(a, false); p.setTemporalContinuousAtKey(b, false); } catch (e2) {}

    var v1 = p.keyValue(a), v2 = p.keyValue(b);
    var n = p.keyOutTemporalEase(a).length;
    var dv = [], i;
    var scalarPath = (n === 1 && v1 instanceof Array); // spatial / colour: one ease for the whole value
    if (scalarPath) {
        var s = 0;
        for (i = 0; i < v1.length; i++) s += (v2[i] - v1[i]) * (v2[i] - v1[i]);
        dv.push(Math.sqrt(s));
    } else if (n === 1) {
        dv.push(v2 - v1);
    } else {
        for (i = 0; i < n; i++) dv.push(v2[i] - v1[i]);
    }

    var inf1 = TL.clamp(x1 * 100, 0.1, 100);
    var inf2 = TL.clamp((1 - x2) * 100, 0.1, 100);
    var slopeOut = y1 / Math.max(x1, 0.001);
    var slopeIn = (1 - y2) / Math.max(1 - x2, 0.001);

    var outA = [], inB = [];
    for (i = 0; i < n; i++) {
        var so = dv[i] / dt * slopeOut;
        var si = dv[i] / dt * slopeIn;
        if (scalarPath) { so = Math.max(0, so); si = Math.max(0, si); } // speed along a path can't be negative
        outA.push(new KeyframeEase(so, inf1));
        inB.push(new KeyframeEase(si, inf2));
    }

    p.setTemporalEaseAtKey(a, p.keyInTemporalEase(a), outA);
    p.setTemporalEaseAtKey(b, inB, p.keyOutTemporalEase(b));
    return true;
};

TL.applyEase = function (x1, y1, x2, y2) {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var props = comp.selectedProperties;

    app.beginUndoGroup("Text Library: Flow Ease");
    try {
        var pairs = 0;
        for (var i = 0; i < props.length; i++) {
            var p = props[i];
            if (p.propertyType !== PropertyType.PROPERTY || !p.canVaryOverTime) continue;
            var ks = p.selectedKeys.slice(0);
            ks.sort(function (m, n) { return m - n; });
            for (var j = 0; j + 1 < ks.length; j++) {
                try {
                    if (TL.easePair(p, ks[j], ks[j + 1], x1, y1, x2, y2)) pairs++;
                } catch (eP) {} // e.g. Source Text keys cannot be eased
            }
        }
        if (!pairs) return TL.err("Select at least two keyframes in the timeline.");
        return TL.ok({ pairs: pairs });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ================================================================== */
/* MOTION TOOLS                                                         */
/* ================================================================== */

TL.selectedLayers = function (comp) {
    var sel = comp.selectedLayers, out = [];
    for (var i = 0; i < sel.length; i++) out.push(sel[i]);
    out.sort(function (a, b) { return a.index - b.index; });
    return out;
};

/* ---------- Anchor point: move to a corner / edge / centre of the content, layer stays in place ---------- */

TL.setAnchor = function (fx, fy) {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var layers = TL.selectedLayers(comp);
    if (!layers.length) return TL.err("Select layers in the timeline.");

    app.beginUndoGroup("Text Library: Anchor Point");
    try {
        var done = 0, skipped = 0;
        for (var i = 0; i < layers.length; i++) {
            var l = layers[i];
            var tr = l.property("ADBE Transform Group");
            var ap = tr ? tr.property("ADBE Anchor Point") : null;
            if (!ap || !l.sourceRectAtTime || ap.numKeys > 0) { skipped++; continue; } // camera/light or animated anchor
            var r;
            try { r = l.sourceRectAtTime(comp.time, false); } catch (eR) { skipped++; continue; }
            if (!r || (r.width === 0 && r.height === 0)) { skipped++; continue; }

            var oldA = ap.value;
            var nx = r.left + fx * r.width, ny = r.top + fy * r.height;
            var dX = nx - oldA[0], dY = ny - oldA[1];

            // the same offset in parent space (scale, then rotation), so the content doesn't move
            var sc = tr.property("ADBE Scale").value;
            var rot = tr.property("ADBE Rotate Z").value * Math.PI / 180;
            var sx = dX * sc[0] / 100, sy = dY * sc[1] / 100;
            var px = sx * Math.cos(rot) - sy * Math.sin(rot);
            var py = sx * Math.sin(rot) + sy * Math.cos(rot);

            TL.withUnlocked(l, function () {
                var a = oldA.slice(0);
                a[0] = nx; a[1] = ny;
                ap.setValue(a);
                TL.shiftPos(l, px, py);
            });
            done++;
        }
        if (!done) return TL.err("Anchor could not be moved (animated anchor, camera/light or empty layer).");
        return TL.ok({ done: done, skipped: skipped });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ---------- Elastic / Bounce expressions ---------- */

/* Slider controls added to the layer - the expressions read them, so the motion can be tuned in Effect Controls. */
TL.MOTION_SLIDERS = {
    elastic: [["Elastic Amplitude", 6], ["Elastic Frequency", 3], ["Elastic Decay", 6]],
    bounce: [["Bounce Elasticity", 55], ["Bounce Gravity", 5000], ["Bounce Max Bounces", 6]]
};

TL.EXPR = {
    elastic: [
        "// Text Library - Elastic",
        "// Tune it in Effect Controls: Elastic Amplitude / Frequency / Decay",
        "var amp = effect(\"Elastic Amplitude\")(1) / 100;",
        "var freq = effect(\"Elastic Frequency\")(1);",
        "var decay = effect(\"Elastic Decay\")(1);",
        "var out = value;",
        "if (numKeys > 1) {",
        "  var k = nearestKey(time).index;",
        "  if (key(k).time > time) k--;",
        "  if (k > 0 && time > key(k).time) {",
        "    var t = time - key(k).time;",
        "    var v = velocityAtTime(key(k).time - thisComp.frameDuration / 10);",
        "    out = value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);",
        "  }",
        "}",
        "out;"
    ].join("\n"),
    bounce: [
        "// Text Library - Bounce",
        "// Tune it in Effect Controls: Bounce Elasticity / Gravity / Max Bounces",
        "var e = effect(\"Bounce Elasticity\")(1) / 100;",
        "var g = Math.max(1, effect(\"Bounce Gravity\")(1));",
        "var nMax = Math.round(effect(\"Bounce Max Bounces\")(1));",
        "var out = value;",
        "if (numKeys > 1) {",
        "  var k = nearestKey(time).index;",
        "  if (key(k).time > time) k--;",
        "  if (k > 0 && time > key(k).time) {",
        "    var v = -velocityAtTime(key(k).time - 0.001) * e;",
        "    var vl = (v instanceof Array) ? length(v) : Math.abs(v);",
        "    if (vl > 0) {",
        "      var u = (v instanceof Array) ? normalize(v) : (v < 0 ? -1 : 1);",
        "      var t = time - key(k).time, segDur = 2 * vl / g, tCur = 0, tNext = segDur, n = 1;",
        "      while (tNext < t && n <= nMax) { vl *= e; segDur *= e; tCur = tNext; tNext += segDur; n++; }",
        "      if (n <= nMax) { var d = t - tCur; out = value + u * d * (vl - g * d / 2); }",
        "    }",
        "  }",
        "}",
        "out;"
    ].join("\n")
};

/* Applies to the selected keyframed properties; if none are selected, to every keyframed transform property of the selected layers. */
TL.addMotionExpression = function (kind) {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var expr = TL.EXPR[kind];
    if (!expr) return TL.err("Unknown expression: " + kind);

    var targets = [], i, p;
    var props = comp.selectedProperties;
    for (i = 0; i < props.length; i++) {
        p = props[i];
        if (p.propertyType === PropertyType.PROPERTY && p.canSetExpression && p.numKeys > 1) targets.push(p);
    }
    if (!targets.length) {
        var layers = TL.selectedLayers(comp);
        for (i = 0; i < layers.length; i++) {
            var tr = layers[i].property("ADBE Transform Group");
            if (!tr) continue;
            for (var j = 1; j <= tr.numProperties; j++) {
                p = tr.property(j);
                if (p && p.propertyType === PropertyType.PROPERTY && p.canSetExpression && p.numKeys > 1) targets.push(p);
            }
        }
    }
    if (!targets.length) return TL.err("Select a property (or layer) with at least 2 keyframes.");

    // Adding effects invalidates property references, so remember each target as layer + index path first.
    var refs = [];
    for (i = 0; i < targets.length; i++) {
        var path = [], q = targets[i];
        while (q.propertyDepth > 0) { path.unshift(q.propertyIndex); q = q.parentProperty; }
        refs.push({ layer: q, path: path });
    }

    app.beginUndoGroup("Text Library: " + kind);
    try {
        var sliders = TL.MOTION_SLIDERS[kind], done = {};
        for (i = 0; i < refs.length; i++) {
            var layer = refs[i].layer;
            if (done[layer.index]) continue;
            done[layer.index] = true;
            for (var s = 0; s < sliders.length; s++) {
                var fxGroup = layer.property("ADBE Effect Parade");
                if (fxGroup.property(sliders[s][0])) continue; // already there - keep the user's values
                var fx = fxGroup.addProperty("ADBE Slider Control");
                fx.name = sliders[s][0];
                fx.property(1).setValue(sliders[s][1]);
            }
        }
        var count = 0;
        for (i = 0; i < refs.length; i++) {
            var prop = TL.resolve(refs[i].layer, refs[i].path);
            if (!prop) continue;
            prop.expression = expr;
            prop.expressionEnabled = true;
            count++;
        }
        return TL.ok({ count: count });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ---------- Sequence: stagger layers in time ---------- */

/*
 * offsetFrames: frames between neighbouring layers; step: how many times that offset is applied per click;
 * reverse: bottom layer first. Layer i moves by i * offset * step frames, and every call adds to it
 * (offset 4, step 5 -> 0, 20, 40, 60 frames; click again -> 0, 40, 80, 120).
 */
TL.sequenceLayers = function (offsetFrames, step, reverse) {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var layers = TL.selectedLayers(comp);
    if (layers.length < 2) return TL.err("Select at least 2 layers.");
    step = Math.max(1, Math.round(step));
    if (reverse) layers.reverse();

    app.beginUndoGroup("Text Library: Sequence Layers");
    try {
        for (var i = 0; i < layers.length; i++) {
            (function (l, shift) {
                if (shift) TL.withUnlocked(l, function () { l.startTime += shift; });
            })(layers[i], i * offsetFrames * step * comp.frameDuration);
        }
        return TL.ok({ count: layers.length });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ---------- Move: offset transforms of the selected layers without adding keyframes ---------- */

/*
 * Apply fn to keyframe values or the static value - never adds a key.
 * onlySel: change only the selected keyframes (a property without selected keys is left alone).
 * Without onlySel every keyframe changes, so the whole animation shifts.
 * Returns the number of changed values.
 */
TL.offsetProp = function (p, fn, onlySel) {
    if (onlySel) {
        var sk = p.selectedKeys || [];
        for (var s = 0; s < sk.length; s++) p.setValueAtKey(sk[s], fn(p.keyValue(sk[s])));
        return sk.length;
    }
    if (p.numKeys > 0) {
        for (var k = 1; k <= p.numKeys; k++) p.setValueAtKey(k, fn(p.keyValue(k)));
        return p.numKeys;
    }
    p.setValue(fn(p.value));
    return 1;
};

/* Transform properties Move can touch (separated X/Y/Z position included). */
TL.moveProps = function (tr) {
    var names = ["ADBE Position", "ADBE Position_0", "ADBE Position_1", "ADBE Position_2", "ADBE Rotate Z", "ADBE Scale", "ADBE Opacity"];
    var out = [];
    for (var i = 0; i < names.length; i++) {
        var p = tr.property(names[i]);
        if (p) out.push(p);
    }
    return out;
};

TL.hasSelectedKeys = function (layer) {
    var tr = layer.property("ADBE Transform Group");
    if (!tr) return false;
    var list = TL.moveProps(tr);
    for (var i = 0; i < list.length; i++) {
        try { if (list[i].selectedKeys && list[i].selectedKeys.length) return true; } catch (e) {}
    }
    return false;
};

/* Selected layers plus the layers whose keyframes / properties are selected. */
TL.moveTargets = function (comp) {
    var out = TL.selectedLayers(comp), seen = {}, i;
    for (i = 0; i < out.length; i++) seen[out[i].index] = 1;
    var props = comp.selectedProperties || [];
    for (i = 0; i < props.length; i++) {
        try {
            var l = props[i].propertyGroup(props[i].propertyDepth);
            if (l && !seen[l.index]) { seen[l.index] = 1; out.push(l); }
        } catch (e) {}
    }
    return out;
};

/*
 * kind: "pos" (a, b, c = dx, dy, dz px) | "rot" (a = degrees) | "scale" (a = percent points) | "opacity" (a = percent points)
 * If any transform keyframe is selected, only the selected keyframes change; otherwise whole layers move.
 * Z only moves 3D layers. Scale keeps the sign of flipped axes.
 */
TL.moveLayers = function (kind, a, b, c) {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var layers = TL.moveTargets(comp);
    if (!layers.length) return TL.err("Select layers or keyframes in the timeline.");
    a = +a || 0; b = +b || 0; c = +c || 0;

    var onlySel = false, i;
    for (i = 0; i < layers.length && !onlySel; i++) onlySel = TL.hasSelectedKeys(layers[i]);

    app.beginUndoGroup("Text Library: Move");
    try {
        var done = 0, keys = 0;
        for (i = 0; i < layers.length; i++) {
            var l = layers[i], tr = l.property("ADBE Transform Group"), n = 0;
            if (!tr) continue;
            TL.withUnlocked(l, function () {
                var is3D = false;
                try { is3D = !!l.threeDLayer || l instanceof CameraLayer || l instanceof LightLayer; } catch (e3) {}

                if (kind === "pos") {
                    var dz = is3D ? c : 0;
                    if (!a && !b && !dz) return;
                    var pos = tr.property("ADBE Position");
                    if (pos.dimensionsSeparated) {
                        var d = [a, b, dz];
                        for (var j = 0; j < 3; j++) {
                            var sp = tr.property("ADBE Position_" + j);
                            if (!d[j] || !sp) continue;
                            n += (function (dd) { return TL.offsetProp(sp, function (v) { return v + dd; }, onlySel); })(d[j]);
                        }
                    } else {
                        n += TL.offsetProp(pos, function (v) {
                            v = v.slice(0); v[0] += a; v[1] += b;
                            if (v.length > 2) v[2] += dz;
                            return v;
                        }, onlySel);
                    }
                } else if (kind === "rot") {
                    var rz = tr.property("ADBE Rotate Z");
                    if (rz) n += TL.offsetProp(rz, function (v) { return v + a; }, onlySel);
                } else if (kind === "scale") {
                    var sc = tr.property("ADBE Scale");
                    if (sc) n += TL.offsetProp(sc, function (v) {
                        v = v.slice(0);
                        for (var k = 0; k < v.length; k++) v[k] += v[k] < 0 ? -a : a;
                        return v;
                    }, onlySel);
                } else if (kind === "opacity") {
                    var op = tr.property("ADBE Opacity");
                    if (op) n += TL.offsetProp(op, function (v) { return Math.max(0, Math.min(100, v + a)); }, onlySel);
                }
            });
            if (n) { done++; keys += n; }
        }
        if (!done) {
            if (kind === "pos" && !a && !b) return TL.err("Depth only moves 3D layers.");
            if (onlySel) return TL.err("No selected keyframes on this property - select its keyframes, or deselect all keyframes to move whole layers.");
            return TL.err("Nothing to move on the selected layers.");
        }
        return TL.ok({ done: done, keys: onlySel ? keys : 0, selection: onlySel });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ---------- Extract: pull the layers of a precomp out into the current comp ---------- */

TL.extractPrecomp = function () {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var sel = TL.selectedLayers(comp);
    if (sel.length !== 1 || !(sel[0].source instanceof CompItem)) return TL.err("Select one precomp layer to extract.");
    var pre = sel[0], inner = pre.source;
    if (pre.stretch !== 100) return TL.err("Time-stretched precomps can't be extracted.");
    if (pre.timeRemapEnabled) return TL.err("Precomps with time remapping can't be extracted.");

    app.beginUndoGroup("Text Library: Extract Precomp");
    try {
        // a null with the precomp layer's transform: its layer space equals the precomp's comp space
        var nul = comp.layers.addNull(comp.duration);
        nul.name = pre.name + " (extracted)";
        var ptr = pre.property("ADBE Transform Group"), ntr = nul.property("ADBE Transform Group");
        var names = ["ADBE Anchor Point", "ADBE Position", "ADBE Scale", "ADBE Rotate Z"];
        for (var n = 0; n < names.length; n++) {
            var sp = ptr.property(names[n]), dp = ntr.property(names[n]);
            try {
                if (sp.numKeys > 0) {
                    for (var k = 1; k <= sp.numKeys; k++) dp.setValueAtTime(sp.keyTime(k), sp.keyValue(k));
                } else {
                    dp.setValue(sp.value);
                }
            } catch (eT) {}
        }
        if (pre.parent) nul.parent = pre.parent;
        nul.moveBefore(pre);
        nul.enabled = false;

        // copy layers top to bottom, each lands right above the precomp layer -> original order kept
        var map = {}, copies = [], i;
        for (i = 1; i <= inner.numLayers; i++) {
            var src = inner.layer(i);
            src.copyToComp(comp);
            var c = comp.layer(1);
            c.moveBefore(pre);
            TL.withUnlocked(c, function () { c.startTime += pre.startTime; });
            map[src.index] = c;
            copies.push({ src: src, copy: c });
        }
        // rebuild parenting without moving anything
        for (i = 0; i < copies.length; i++) {
            var p = copies[i].src.parent;
            var target = p ? map[p.index] : nul;
            try { copies[i].copy.setParentWithJump(target); } catch (eP) { copies[i].copy.parent = target; }
        }
        pre.remove();
        return TL.ok({ count: copies.length });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ---------- Merge: combine selected shape layers into one ---------- */

TL.mergeShapes = function () {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var all = TL.selectedLayers(comp), layers = [], i;
    for (i = 0; i < all.length; i++) if (all[i] instanceof ShapeLayer) layers.push(all[i]);
    if (layers.length < 2) return TL.err("Select at least 2 shape layers.");

    app.beginUndoGroup("Text Library: Merge Shapes");
    try {
        // target layer space == comp space, so each group can carry its source layer's transform
        var dst = comp.layers.addShape();
        dst.name = "Merged Shapes";
        var dtr = dst.property("ADBE Transform Group");
        dtr.property("ADBE Anchor Point").setValue([0, 0]);
        dtr.property("ADBE Position").setValue([0, 0]);

        var ctx = { srcStart: 0, dstIn: 0, dstOut: 0, reverse: false, center: [comp.width / 2, comp.height / 2] };
        var inP = layers[0].inPoint, outP = layers[0].outPoint, skippedParent = 0;
        var TRANSFORM = [
            ["ADBE Anchor Point", "ADBE Vector Anchor"],
            ["ADBE Position", "ADBE Vector Position"],
            ["ADBE Scale", "ADBE Vector Scale"],
            ["ADBE Rotate Z", "ADBE Vector Rotation"],
            ["ADBE Opacity", "ADBE Vector Group Opacity"]
        ];

        for (i = 0; i < layers.length; i++) {
            var src = layers[i];
            if (src.parent) skippedParent++;
            inP = Math.min(inP, src.inPoint);
            outP = Math.max(outP, src.outPoint);

            var root = dst.property("ADBE Root Vectors Group");
            var g = root.addProperty("ADBE Vector Group");
            g.name = src.name;
            var gi = g.propertyIndex;
            TL.copyGroup(src.property("ADBE Root Vectors Group"), dst,
                ["ADBE Root Vectors Group", gi, "ADBE Vectors Group"], ctx, {});

            var str = src.property("ADBE Transform Group");
            for (var t = 0; t < TRANSFORM.length; t++) {
                var sp = str.property(TRANSFORM[t][0]);
                var dp = TL.resolve(dst, ["ADBE Root Vectors Group", gi, "ADBE Vector Transform Group", TRANSFORM[t][1]]);
                if (!dp) continue;
                try {
                    if (sp.numKeys > 0) {
                        for (var k = 1; k <= sp.numKeys; k++) {
                            var v = sp.keyValue(k);
                            if (v instanceof Array && v.length > 2) v = [v[0], v[1]];
                            dp.setValueAtTime(sp.keyTime(k), v);
                        }
                    } else {
                        var sv = sp.value;
                        if (sv instanceof Array && sv.length > 2) sv = [sv[0], sv[1]];
                        dp.setValue(sv);
                    }
                } catch (eT) {}
            }
        }
        dst.inPoint = inP;
        dst.outPoint = outP;
        dst.moveBefore(layers[0]);
        for (i = layers.length - 1; i >= 0; i--) layers[i].remove();
        return TL.ok({ count: layers.length, parented: skippedParent });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ---------- Add Null: at the centre of the selection, parented ---------- */

TL.addNullParent = function () {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var layers = TL.selectedLayers(comp);

    app.beginUndoGroup("Text Library: Add Null");
    try {
        var name = TL.nextName(comp, "Null");
        var nul = comp.layers.addNull(comp.duration);
        nul.name = name;
        if (!layers.length) return TL.ok({ name: name, count: 0 });

        // centre of the unparented selected layers (their positions are in comp space)
        var sx = 0, sy = 0, n = 0, i;
        for (i = 0; i < layers.length; i++) {
            if (layers[i].parent) continue;
            var tr = layers[i].property("ADBE Transform Group");
            if (!tr) continue;
            var pos = tr.property("ADBE Position").value;
            sx += pos[0]; sy += pos[1]; n++;
        }
        var ntr = nul.property("ADBE Transform Group");
        if (n) ntr.property("ADBE Position").setValue([sx / n, sy / n]);
        ntr.property("ADBE Anchor Point").setValue([50, 50]);
        nul.moveBefore(layers[0]);

        var parented = 0;
        for (i = 0; i < layers.length; i++) {
            var l = layers[i];
            if (l.parent && TL.indexOfLayer(layers, l.parent) >= 0) continue; // keep chains inside the selection
            TL.withUnlocked(l, function () { l.parent = nul; }); // .parent keeps the layer where it is
            parented++;
        }
        for (i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        nul.selected = true;
        return TL.ok({ name: name, count: parented });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

TL.indexOfLayer = function (arr, layer) {
    for (var i = 0; i < arr.length; i++) if (arr[i].index === layer.index) return i;
    return -1;
};

/* ---------- Convert to Shape: text and Illustrator/vector layers ---------- */

TL.menuCommand = function (name, fallbackId) {
    var id = 0;
    try { id = app.findMenuCommandId(name); } catch (e) {}
    return id || fallbackId;
};

TL.convertToShape = function () {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var layers = TL.selectedLayers(comp), texts = [], vectors = [], i;
    for (i = 0; i < layers.length; i++) {
        var l = layers[i];
        if (TL.isTextLayer(l)) texts.push(l);
        else if (l.source instanceof FootageItem && l.source.file && /\.(ai|eps|pdf)$/i.test(l.source.file.name)) vectors.push(l);
    }
    if (!texts.length && !vectors.length) return TL.err("Select text layers or Illustrator (.ai/.eps/.pdf) layers.");

    var only = function (list) {
        for (var j = 1; j <= comp.numLayers; j++) comp.layer(j).selected = false;
        for (var m = 0; m < list.length; m++) list[m].selected = true;
    };

    app.beginUndoGroup("Text Library: Convert to Shape");
    try {
        comp.openInViewer(); // the menu commands act on the active viewer
        if (texts.length) {
            only(texts);
            app.executeCommand(TL.menuCommand("Create Shapes from Text", 3781));
        }
        if (vectors.length) {
            only(vectors);
            app.executeCommand(TL.menuCommand("Create Shapes from Vector Layer", 3973));
        }
        return TL.ok({ count: texts.length + vectors.length });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

TL.pickFolder = function (startPath) {
    var f = new Folder(startPath || Folder.myDocuments.fsName);
    var r = f.selectDlg("Choose the library folder");
    return r ? TL.ok({ path: r.fsName }) : TL.ok({ path: null });
};

TL.revealFolder = function (path) {
    var f = new Folder(path);
    if (!f.exists) f.create();
    f.execute();
    return TL.ok({});
};

/* ------------------------------------------------------------------ */
/* TOOLS: Carousel - same rig layout as SaaSor v2.2                    */
/* ------------------------------------------------------------------ */

/*
 * Circle / Path / Vision: a "<Shape> Control\u2726" shape layer holds the sliders, a guide solid
 * "Path Carousel" holds the path as Mask 1, and every card runs along it (pointOnPath).
 * Vision also tilts the ring in 3D: the cards are parented to a 3D null rotated by X / Y slider.
 * Orbit: a 3D null "Orbit Control\u2726" holds the sliders; the cards sit on a sphere and face the camera.
 * The panel (js/tools.js) sends the shape, slider names + values and the preset path.
 */
TL.CAROUSEL_TAG = "// Text Library carousel";
TL.CAROUSEL_SHAPES = { 1: "Circle", 2: "Path", 3: "Vision", 4: "Orbit" };
TL.CAROUSEL_PATH_COLOR = [0.18, 0.4, 0.95];

TL.carouselShapeOf = function (layer) {
    var m = layer.name.match(/^(Circle|Path|Vision|Orbit) Control\u2726/);
    if (!m) return 0;
    var fx = layer.property("ADBE Effect Parade");
    if (!fx || !fx.numProperties) return 0;
    for (var k in TL.CAROUSEL_SHAPES) if (TL.CAROUSEL_SHAPES[k] === m[1]) return +k;
    return 0;
};

TL.isCarouselCtrl = function (layer) { return TL.carouselShapeOf(layer) > 0; };

// any layer with a transform except cameras and lights. Shape / text layers fail "instanceof AVLayer" in ExtendScript.
TL.isCardLayer = function (l) {
    return !(l instanceof CameraLayer) && !(l instanceof LightLayer) && !!l.property("ADBE Transform Group");
};

TL.findLayerByName = function (comp, name) {
    for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === name) return comp.layer(i);
    return null;
};

TL.unusedName = function (comp, base) {
    if (!TL.findLayerByName(comp, base)) return base;
    for (var n = 2; ; n++) if (!TL.findLayerByName(comp, base + " " + n)) return base + " " + n;
};

// names written into a card's expressions: [control, path layer, vision null] (from the header line)
TL.carouselRefs = function (layer) {
    var tr = layer.property("ADBE Transform Group");
    var p = tr ? tr.property("ADBE Position") : null;
    if (!p || !p.expressionEnabled || p.expression.indexOf(TL.CAROUSEL_TAG) !== 0) return null;
    var m = p.expression.match(/^\/\/ Text Library carousel (\{[^\n]*\})/);
    if (!m) return null;
    try { return eval("(" + m[1] + ")"); } catch (e) { return null; }
};

TL.carouselCtrlOf = function (comp, layer) {
    var refs = TL.carouselRefs(layer), l = refs ? TL.findLayerByName(comp, refs.ctrl) : null;
    return (l && TL.isCarouselCtrl(l)) ? l : null;
};

TL.carouselValues = function (ctrl) {
    var out = {}, fx = ctrl.property("ADBE Effect Parade");
    for (var i = 1; i <= fx.numProperties; i++) out[fx.property(i).name] = fx.property(i).property(1).value;
    return out;
};

TL.layerCard = function (comp, l) {
    var w = 0, h = 0;
    try {
        var r = l.sourceRectAtTime(comp.time, false);
        w = r.width;
        h = r.height;
    } catch (e) {}
    return { name: l.name, label: l.label, w: w, h: h, index: l.index };
};

/*
 * What the Carousel tool works on: the selected layers, and the control layer they belong to.
 * A selected control layer alone loads the cards it drives.
 */
TL.carouselInfo = function () {
    var comp = TL.activeComp();
    if (!comp) return TL.ok({ comp: null, layers: [], ctrl: null });
    try {
        var sel = TL.selectedLayers(comp), layers = [], ctrl = null, i, refs = null;
        for (i = 0; i < sel.length; i++) {
            if (TL.isCarouselCtrl(sel[i])) { if (!ctrl) ctrl = sel[i]; }
            else if (TL.isCardLayer(sel[i])) layers.push(sel[i]);
        }
        if (!ctrl && layers.length) ctrl = TL.carouselCtrlOf(comp, layers[0]);
        // the Path Carousel solid (or Vision null) selected - e.g. while reshaping the mask
        if (!ctrl && layers.length) {
            for (i = 1; i <= comp.numLayers && !ctrl; i++) {
                var rf = TL.carouselRefs(comp.layer(i));
                if (!rf) continue;
                for (var s2 = 0; s2 < layers.length; s2++) {
                    if (layers[s2].name === rf.path || layers[s2].name === rf.nul) { ctrl = TL.findLayerByName(comp, rf.ctrl); break; }
                }
            }
            if (ctrl && !TL.isCarouselCtrl(ctrl)) ctrl = null;
        }
        if (ctrl) {
            var driven = [];
            for (i = 1; i <= comp.numLayers; i++) {
                var l = comp.layer(i);
                if (l !== ctrl && TL.isCardLayer(l) && TL.carouselCtrlOf(comp, l) === ctrl) {
                    driven.push(l);
                    if (!refs) refs = TL.carouselRefs(l);
                }
            }
            if (driven.length) layers = driven;
        }
        var path = null;
        if (refs && refs.path) {
            var pl = TL.findLayerByName(comp, refs.path);
            var m = pl ? pl.property("ADBE Mask Parade") : null;
            if (m && m.numProperties) {
                var sh = m.property(1).property("ADBE Mask Shape").value;
                path = { closed: sh.closed, v: sh.vertices, i: sh.inTangents, o: sh.outTangents };
            }
        }
        var cards = [];
        for (i = 0; i < layers.length; i++) cards.push(TL.layerCard(comp, layers[i]));
        return TL.ok({
            comp: { name: comp.name, w: comp.width, h: comp.height, fps: comp.frameRate, time: comp.time },
            layers: cards,
            ctrl: ctrl ? ctrl.name : null,
            shape: ctrl ? TL.carouselShapeOf(ctrl) : 0,
            values: ctrl ? TL.carouselValues(ctrl) : null,
            path: path
        });
    } catch (e) {
        return TL.errFromException(e);
    }
};

/* ---------- expressions ---------- */

TL.carouselHead = function (refs) {
    return TL.CAROUSEL_TAG + " " + TL.str(refs) + "\n";
};

// shared start of the path-based card expressions: where this card is on the path (pct 0..1)
TL.carouselPathCore = function (refs, idx, n) {
    return "var ctrl   = thisComp.layer(" + TL.quote(refs.ctrl) + ");\n" +
        "var spd    = ctrl.effect(\"Speed\")(1) / 1000;\n" +
        "var spc    = ctrl.effect(\"Spacing\")(1) / 100;\n" +
        "var phase  = ctrl.effect(\"Phase Offset\")(1) / 100;\n" +
        "var manual = ctrl.effect(\"Move Carousel\")(1) / 100;\n" +
        "var n      = " + n + ";\n" +
        "var idx    = " + idx + ";\n" +
        "var off    = (idx / n) * spc + phase;\n" +
        "var pct    = ((time * spd) + off + manual) % 1;\n" +
        "if (pct < 0) pct += 1;\n" +
        "var mp     = thisComp.layer(" + TL.quote(refs.path) + ").mask(1).maskPath;\n";
};

TL.carouselPathExpr = {
    position:
        "var p = mp.pointOnPath(pct);\n" +
        "value.length > 2 ? [p[0], p[1], 0] : [p[0], p[1]];",
    // size follows the card's place on screen, measured along the Depth Angle direction
    scale:
        "var globalScale = ctrl.effect(\"Global Scale\")(1);\n" +
        "var depth       = ctrl.effect(\"Scale Depth\")(1);\n" +
        "var scaleMin    = ctrl.effect(\"Scale Min\")(1);\n" +
        "var dAngRad     = ctrl.effect(\"Depth Angle\")(1) * (Math.PI / 180);\n" +
        "var pos    = mp.pointOnPath(pct);\n" +
        "var compCX = thisComp.width  / 2;\n" +
        "var compCY = thisComp.height / 2;\n" +
        "var projected = (pos[0] - compCX) * Math.sin(dAngRad) + (pos[1] - compCY) * Math.cos(dAngRad);\n" +
        "var maxDist   = Math.sqrt(compCX * compCX + compCY * compCY);\n" +
        "var norm      = (projected / maxDist + 1) / 2;\n" +
        "var depthScale = linear(norm, 0, 1, scaleMin, 100);\n" +
        "var mixedScale = linear(depth / 100, 0, 1, 100, depthScale);\n" +
        "var s = mixedScale * (globalScale / 100);\n" +
        "value.length > 2 ? [s, s, s] : [s, s];",
    rotation:
        "var tang  = mp.tangentOnPath(pct);\n" +
        "Math.atan2(tang[1], tang[0]) * (180 / Math.PI) * ctrl.effect(\"Rotation Follow\")(1);"
};

// Vision: cards turn away from the camera the further they are from the comp centre
TL.carouselVisionRotY = function (refs) {
    return "var maxRot = thisComp.layer(" + TL.quote(refs.ctrl) + ").effect(\"3D Y Angle\")(1);\n" +
        "var worldPos = toComp(anchorPoint);\n" +
        "var centerX = thisComp.width / 2;\n" +
        "var rot = ease(Math.abs(worldPos[0] - centerX), 0, thisComp.width * (700 / 1920), 0, maxRot);\n" +
        "(worldPos[0] < centerX) ? rot : -rot;";
};

// Orbit: golden-angle sphere; Element Count between whole numbers blends two layouts
TL.carouselOrbitExpr = function (refs) {
    var c = "var ctrl = thisComp.layer(" + TL.quote(refs.ctrl) + ");\n";
    return {
        position: c +
            "var r = ctrl.effect(\"Radius\")(1);\n" +
            "var rawCnt = Math.max(1, ctrl.effect(\"Element Count\")(1));\n" +
            "var off = ctrl.effect(\"Offset\")(1);\n" +
            "var rx = degreesToRadians(ctrl.effect(\"Rotation X\")(1) + ctrl.transform.xRotation);\n" +
            "var ry = degreesToRadians(ctrl.effect(\"Rotation Y\")(1) + ctrl.transform.yRotation);\n" +
            "var rz = degreesToRadians(ctrl.effect(\"Rotation Z\")(1) + ctrl.transform.zRotation);\n" +
            "function getP(cnt) {\n" +
            "  var i = ((index - 0.5 + off) % cnt + cnt) % cnt;\n" +
            "  var ga = Math.PI * (3 - Math.sqrt(5));\n" +
            "  var inc = Math.acos(1 - 2 * (i / cnt)), azi = ga * i;\n" +
            "  return [Math.sin(inc) * Math.cos(azi), Math.cos(inc), Math.sin(inc) * Math.sin(azi)] * r;\n" +
            "}\n" +
            "var c1 = Math.floor(rawCnt);\n" +
            "var p = getP(c1) + (getP(c1 + 1) - getP(c1)) * (rawCnt % 1);\n" +
            "p = [p[0], p[1] * Math.cos(rx) - p[2] * Math.sin(rx), p[1] * Math.sin(rx) + p[2] * Math.cos(rx)];\n" +
            "p = [p[0] * Math.cos(ry) + p[2] * Math.sin(ry), p[1], -p[0] * Math.sin(ry) + p[2] * Math.cos(ry)];\n" +
            "p = [p[0] * Math.cos(rz) - p[1] * Math.sin(rz), p[0] * Math.sin(rz) + p[1] * Math.cos(rz), p[2]];\n" +
            "p *= 1 + (index % 2) * 0.01;\n" +
            "p + ctrl.position + (value - [thisComp.width / 2, thisComp.height / 2, 0]);",
        scale: c +
            "var cam = thisComp.activeCamera;\n" +
            "if (!cam) cam = thisComp.layer(1);\n" +
            "var minS = ctrl.effect(\"Scale Min\")(1), maxS = ctrl.effect(\"Scale Max\")(1);\n" +
            "var boost = ctrl.effect(\"Perspective Boost\")(1), r = ctrl.effect(\"Radius\")(1);\n" +
            "if (cam) {\n" +
            "  var d = length(toWorld(anchorPoint), cam.toWorld([0, 0, 0]));\n" +
            "  var cd = length(ctrl.toWorld([0, 0, 0]), cam.toWorld([0, 0, 0]));\n" +
            "  var t = clamp(linear(d, cd - r, cd + r, 0, 1), 0, 1);\n" +
            "  value * (linear(boost, 0, 100, 100, linear(t, 0, 1, maxS, minS)) / 100);\n" +
            "} else { value; }",
        orientation:
            "var cam = thisComp.activeCamera;\n" +
            "if (cam) {\n" +
            "  var pos = toWorld(anchorPoint), cp = cam.toWorld([0, 0, 0]);\n" +
            "  var o = lookAt(pos, cp);\n" +
            "  dot(normalize(cp - pos), normalize(cam.toWorldVec([0, 0, 1]))) < 0 ? o + [0, 180, 0] : o;\n" +
            "} else { value; }",
        opacity: c +
            "index <= Math.floor(ctrl.effect(\"Element Count\")(1)) ? value : 0;"
    };
};

/* ---------- building the rig ---------- */

TL.carouselAddSliders = function (layer, names, values) {
    var fx = layer.property("ADBE Effect Parade");
    for (var i = 0; i < names.length; i++) {
        var e = fx.addProperty("ADBE Slider Control");
        e.name = names[i];
        fx.property(names[i]).property(1).setValue(values[i]);
    }
};

TL.setExpr = function (prop, expr) { prop.expression = expr; };

/*
 * spec: {shape: 1..4, names: [slider names], values: [numbers], path: {v, i, o, closed} (not for Orbit)}
 */
TL.carouselApply = function (spec) {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var sel = TL.selectedLayers(comp), cards = [], i;
    for (i = 0; i < sel.length; i++) if (TL.isCardLayer(sel[i]) && !TL.isCarouselCtrl(sel[i])) cards.push(sel[i]);
    if (cards.length < 2) return TL.err("Select at least 2 layers for the carousel.");
    var shape = TL.CAROUSEL_SHAPES[spec.shape];
    if (!shape) return TL.err("Unknown shape.");

    app.beginUndoGroup("Text Library: Carousel " + shape);
    try {
        var refs = { ctrl: TL.unusedName(comp, shape + " Control\u2726") }, pathLayer = null, nul = null, ctrl;
        var n = cards.length, top = cards[0];

        if (shape === "Orbit") {
            // a style made with its own camera (spec.camera > 0) gets one if the comp has none
            var hasCam = false;
            for (i = 1; i <= comp.numLayers; i++) if (comp.layer(i) instanceof CameraLayer) hasCam = true;
            if (spec.camera > 0 && !hasCam) {
                var cam = comp.layers.addCamera(TL.unusedName(comp, "Orbit Camera"), [comp.width / 2, comp.height / 2]);
                cam.property("ADBE Camera Options Group").property("ADBE Camera Zoom").setValue(spec.camera);
                cam.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([comp.width / 2, comp.height / 2, 0]);
                cam.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2, -spec.camera]);
                cam.moveToEnd(); // card expressions use their layer index - keep them right under the control
                refs.cam = cam.name;
            }
            ctrl = comp.layers.addNull(comp.duration);
            ctrl.name = refs.ctrl;
            ctrl.threeDLayer = true;
            ctrl.label = 1;
            var otr = ctrl.property("ADBE Transform Group");
            otr.property("ADBE Anchor Point").setValue([0, 0, 0]);
            var cp = spec.ctrlPos || [comp.width / 2, comp.height / 2]; // where the sphere sits (style preset)
            otr.property("ADBE Position").setValue([cp[0], cp[1], 0]);
            otr.property("ADBE Opacity").setValue(0);
            TL.carouselAddSliders(ctrl, spec.names, spec.values);
            ctrl.moveToBeginning(); // the card expressions count on their layer index, like SaaSor
        } else {
            refs.path = TL.unusedName(comp, "Path Carousel");
            pathLayer = comp.layers.addSolid(TL.CAROUSEL_PATH_COLOR, refs.path, comp.width, comp.height, comp.pixelAspect, comp.duration);
            pathLayer.guideLayer = true;
            pathLayer.label = 1;
            pathLayer.enabled = false; // the solid would cover the cards in the viewer; pointOnPath still reads its mask
            var mask = pathLayer.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
            mask.maskMode = MaskMode.NONE;
            var sh = new Shape();
            sh.vertices = spec.path.v;
            sh.inTangents = spec.path.i;
            sh.outTangents = spec.path.o;
            sh.closed = !!spec.path.closed;
            mask.property("ADBE Mask Shape").setValue(sh);
            pathLayer.moveBefore(top);

            if (shape === "Vision") {
                refs.nul = TL.unusedName(comp, "Vision Null");
                nul = comp.layers.addNull(comp.duration);
                nul.name = refs.nul;
                nul.threeDLayer = true;
                nul.label = 1;
                var ntr = nul.property("ADBE Transform Group");
                ntr.property("ADBE Anchor Point").setValue([comp.width / 2, comp.height / 2, 0]);
                var no = spec.nullOff || [0, 0, 0]; // the style's null offset from the comp centre
                ntr.property("ADBE Position").setValue([comp.width / 2 + no[0], comp.height / 2 + no[1], no[2]]);
                ntr.property("ADBE Opacity").setValue(0);
                nul.moveBefore(pathLayer);
            }

            ctrl = comp.layers.addShape();
            ctrl.name = refs.ctrl;
            ctrl.label = 8;
            ctrl.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
            TL.carouselAddSliders(ctrl, spec.names, spec.values);
            ctrl.moveBefore(nul || pathLayer);

            if (nul) {
                var ctl = "thisComp.layer(" + TL.quote(refs.ctrl) + ")";
                TL.setExpr(nul.property("ADBE Transform Group").property("ADBE Rotate X"), ctl + ".effect(\"X slider\")(1);");
                TL.setExpr(nul.property("ADBE Transform Group").property("ADBE Rotate Y"), ctl + ".effect(\"Y slider\")(1);");
            }
        }

        var head = TL.carouselHead(refs), orbit = shape === "Orbit" ? TL.carouselOrbitExpr(refs) : null;
        for (i = 0; i < n; i++) {
            (function (l, idx) {
                TL.withUnlocked(l, function () {
                    TL.writeMark(l, TL.CAROUSEL_MARK, TL.carouselSnapshot(l)); // for Remove
                    var tr = l.property("ADBE Transform Group"), pos = tr.property("ADBE Position");
                    if (pos.dimensionsSeparated) pos.dimensionsSeparated = false;
                    if (orbit) {
                        l.threeDLayer = true;
                        pos.setValue([comp.width / 2, comp.height / 2, 0]);
                        TL.setExpr(pos, head + orbit.position);
                        TL.setExpr(tr.property("ADBE Scale"), head + orbit.scale);
                        TL.setExpr(tr.property("ADBE Orientation"), head + orbit.orientation);
                        TL.setExpr(tr.property("ADBE Opacity"), head + orbit.opacity);
                        return;
                    }
                    if (nul) {
                        l.threeDLayer = true;
                        // parenting to the tilted null makes AE counter-rotate the card; keep its own orientation
                        var ori = tr.property("ADBE Orientation"), keepOri = ori.value;
                        l.parent = nul;
                        if (!ori.numKeys) ori.setValue(keepOri);
                        l.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST; // cards face the camera, not the tilted ring
                        TL.setExpr(tr.property("ADBE Rotate Y"), head + TL.carouselVisionRotY(refs));
                    }
                    var core = head + TL.carouselPathCore(refs, idx, n);
                    TL.setExpr(pos, core + TL.carouselPathExpr.position);
                    TL.setExpr(tr.property("ADBE Scale"), core + TL.carouselPathExpr.scale);
                    TL.setExpr(tr.property("ADBE Rotate Z"), core + TL.carouselPathExpr.rotation);
                });
            })(cards[i], i);
        }
        for (i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        ctrl.selected = true; // keeps the panel linked to the new rig
        return TL.ok({ ctrl: ctrl.name, count: n });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ---------- Remove: cards go back to how they were before Create ---------- */

TL.CAROUSEL_MARK = "TLCarousel";
TL.CAROUSEL_PROPS = ["ADBE Position", "ADBE Scale", "ADBE Rotate Z", "ADBE Rotate Y", "ADBE Orientation", "ADBE Opacity"];

// everything Create changes on a card: 3D, parent, auto-orient, separated position, transform values and expressions
TL.carouselSnapshot = function (l) {
    var tr = l.property("ADBE Transform Group"), pos = tr.property("ADBE Position");
    var s = { threeD: l.threeDLayer, parent: l.parent ? l.parent.name : "", autoOrient: l.autoOrient, sep: pos.dimensionsSeparated, props: {} };
    var names = TL.CAROUSEL_PROPS.concat(pos.dimensionsSeparated ? ["ADBE Position_0", "ADBE Position_1", "ADBE Position_2"] : []);
    for (var i = 0; i < names.length; i++) {
        var p = tr.property(names[i]);
        if (!p) continue;
        try {
            s.props[names[i]] = { v: p.numKeys ? null : p.value, e: p.expression, on: p.expressionEnabled };
        } catch (e) {} // e.g. Y Rotation of a 2D layer
    }
    return s;
};

TL.carouselRestore = function (comp, l, s) {
    var tr = l.property("ADBE Transform Group"), k, p, d;
    for (k = 0; k < TL.CAROUSEL_PROPS.length; k++) {
        p = tr.property(TL.CAROUSEL_PROPS[k]);
        try { if (p && p.expression) p.expression = ""; } catch (e) {}
    }
    var par = s.parent ? TL.findLayerByName(comp, s.parent) : null;
    l.parent = (par && par !== l) ? par : null;
    l.autoOrient = s.autoOrient;
    l.threeDLayer = s.threeD;
    if (s.sep) tr.property("ADBE Position").dimensionsSeparated = true;
    // values after parent / 3D: both of those rewrite the transform values
    for (var name in s.props) {
        if (!s.props.hasOwnProperty(name)) continue;
        p = tr.property(name);
        d = s.props[name];
        if (!p) continue;
        try {
            if (d.v !== null && !p.numKeys && !(p.dimensionsSeparated)) p.setValue(d.v);
            if (d.e) { p.expression = d.e; p.expressionEnabled = d.on; }
        } catch (e2) {}
    }
    TL.writeMark(l, TL.CAROUSEL_MARK, null);
};

// A card without a saved state (rig made before Remove existed): back to a plain layer in the comp centre
TL.carouselResetCard = function (comp, l, refs) {
    var tr = l.property("ADBE Transform Group"), k, p;
    for (k = 0; k < TL.CAROUSEL_PROPS.length; k++) {
        p = tr.property(TL.CAROUSEL_PROPS[k]);
        try { if (p && p.expression && p.expression.indexOf(TL.CAROUSEL_TAG) === 0) p.expression = ""; } catch (e) {} // only our own expressions
    }
    if (l.parent && refs && l.parent.name === refs.nul) l.parent = null;
    l.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
    var defaults = [
        ["ADBE Position", l.threeDLayer ? [comp.width / 2, comp.height / 2, 0] : [comp.width / 2, comp.height / 2]],
        ["ADBE Scale", l.threeDLayer ? [100, 100, 100] : [100, 100]],
        ["ADBE Rotate Z", 0], ["ADBE Rotate Y", 0], ["ADBE Orientation", [0, 0, 0]], ["ADBE Opacity", 100]
    ];
    for (k = 0; k < defaults.length; k++) {
        p = tr.property(defaults[k][0]);
        try { if (p && !p.numKeys && !p.dimensionsSeparated) p.setValue(defaults[k][1]); } catch (e2) {}
    }
};

// Remove a carousel: its control, path solid and null. Cards created by this version go back to their
// state before Create; older ones keep their layers where they are and lose the expressions.
// the carousel a selected layer belongs to: its Control, one of its cards, its Path Carousel solid or Vision null
TL.carouselFromSelection = function (comp) {
    var sel = TL.selectedLayers(comp), i, s;
    for (s = 0; s < sel.length; s++) {
        if (TL.isCarouselCtrl(sel[s])) return sel[s];
        var c = TL.carouselCtrlOf(comp, sel[s]);
        if (c) return c;
    }
    for (i = 1; i <= comp.numLayers; i++) {
        var rf = TL.carouselRefs(comp.layer(i));
        if (!rf) continue;
        for (s = 0; s < sel.length; s++) {
            if (sel[s].name === rf.path || sel[s].name === rf.nul) {
                var ctrl = TL.findLayerByName(comp, rf.ctrl);
                if (ctrl && TL.isCarouselCtrl(ctrl)) return ctrl;
            }
        }
    }
    return null;
};

// cheap check for the panel (polled while the Tools tab is open): is a carousel selected?
TL.carouselSelected = function () {
    var comp = TL.activeComp();
    if (!comp) return TL.ok({ ctrl: null });
    try {
        var ctrl = TL.carouselFromSelection(comp);
        return TL.ok({ ctrl: ctrl ? ctrl.name : null, shape: ctrl ? TL.carouselShapeOf(ctrl) : 0 });
    } catch (e) {
        return TL.ok({ ctrl: null });
    }
};

// Remove: control, path solid and null go; every card stays, stacked in the comp centre (100%, no rotation)
TL.carouselDelete = function (ctrlName) {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var ctrl = TL.carouselFromSelection(comp);
    if (!ctrl && ctrlName) ctrl = TL.findLayerByName(comp, ctrlName);
    if (!ctrl || !TL.isCarouselCtrl(ctrl)) return TL.err("Click a carousel layer in AE (a card, its Control or Path Carousel) to remove it.");

    app.beginUndoGroup("Text Library: Delete Carousel");
    try {
        var refs = null, count = 0, i, PROPS = ["ADBE Position", "ADBE Scale", "ADBE Rotate Z", "ADBE Rotate Y", "ADBE Orientation", "ADBE Opacity"];
        for (i = comp.numLayers; i >= 1; i--) {
            var l = comp.layer(i);
            if (l === ctrl || TL.carouselCtrlOf(comp, l) !== ctrl) continue;
            refs = refs || TL.carouselRefs(l);
            TL.withUnlocked(l, function () {
                // saved state brings back 3D / parent / auto-orient; the card then goes to the centre
                var snap = TL.readMark(l, TL.CAROUSEL_MARK);
                if (snap) TL.carouselRestore(comp, l, snap);
                TL.carouselResetCard(comp, l, refs);
            });
            count++;
        }
        var extra = refs ? [refs.path, refs.nul, refs.cam] : []; // cam: only a camera Create added
        for (i = 0; i < extra.length; i++) {
            var x = extra[i] ? TL.findLayerByName(comp, extra[i]) : null;
            if (x) x.remove();
        }
        var name = ctrl.name;
        ctrl.remove();
        return TL.ok({ ctrl: name, count: count });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

// Push panel values to an existing control layer. Keyframed sliders are left alone.
TL.carouselSet = function (ctrlName, values) {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var ctrl = TL.findLayerByName(comp, ctrlName);
    if (!ctrl || !TL.isCarouselCtrl(ctrl)) return TL.err("\"" + ctrlName + "\" was not found in the active comp.");
    app.beginUndoGroup("Text Library: Carousel Controls");
    try {
        var fx = ctrl.property("ADBE Effect Parade"), skipped = 0;
        for (var k in values) {
            if (!values.hasOwnProperty(k)) continue;
            var e = fx.property(k);
            if (!e) continue;
            var p = e.property(1);
            if (p.numKeys > 0) { skipped++; continue; }
            p.setValue(values[k]);
        }
        return TL.ok({ skipped: skipped });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

/* ------------------------------------------------------------------ */
/* PixelateClick: the user's "Scene 2" reveal rig, rebuilt on any layer */
/* ------------------------------------------------------------------ */

TL.PX_COMP = "PixelateClick reveal";
TL.PX_SIZE = 2400;        // square precomp so the noise ring is not clipped
TL.PX_MASK_END = 1050.75; // reveal circle radius at the end in the original (732 / 2 * 287.091%)

// two keys with the original eases: ease out 33% on the first, full ease in on the second
// (reverse: the same curve played backwards - full ease out on the first, 33% ease in on the second)
TL.pxKeys = function (prop, t1, v1, t2, v2, reverse) {
    prop.setValueAtTime(t1, v1);
    prop.setValueAtTime(t2, v2);
    var n = prop.keyInTemporalEase(1).length, a = [], b = [], c = [], d = [];
    var e1 = reverse ? 100 : 33.33, e2 = reverse ? 33.33 : 100;
    for (var i = 0; i < n; i++) {
        a.push(new KeyframeEase(0, 33.33)); b.push(new KeyframeEase(0, e1));
        c.push(new KeyframeEase(0, e2)); d.push(new KeyframeEase(0, 16.67));
    }
    prop.setTemporalEaseAtKey(prop.nearestKeyIndex(t1), a, b);
    prop.setTemporalEaseAtKey(prop.nearestKeyIndex(t2), c, d);
};

// place a noise precomp layer: plays its first `dur` seconds from t0 + start, or backwards
// (time remap) so the whole reveal runs in reverse inside [t0, t0 + 1.75];
// sc stretches it all in time (Duration / 1.75)
TL.pxTiming = function (L, t0, start, dur, reverse, sc) {
    if (!reverse) {
        L.stretch = 100 * sc;
        L.startTime = t0 + start * sc;
        L.outPoint = t0 + (start + dur) * sc;
        return;
    }
    var a = t0 + (1.75 - start - dur) * sc, b = t0 + (1.75 - start) * sc;
    L.startTime = a;
    L.timeRemapEnabled = true;
    var tr = L.property("ADBE Time Remapping");
    // AE adds keys at the in / out point; removing every key would switch time remap off,
    // so the new keys go in first and the old ones are removed after
    tr.setValueAtTime(a, dur);
    tr.setValueAtTime(b, 0);
    for (var i = tr.numKeys; i >= 1; i--) {
        var kt = tr.keyTime(i);
        if (Math.abs(kt - a) > 1e-4 && Math.abs(kt - b) > 1e-4) tr.removeKey(i);
    }
    L.inPoint = a;
    L.outPoint = b;
};

TL.pxEllipse = function (layer, size) {
    var g = layer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
    g.name = "Ellipse 1";
    var v = g.property("ADBE Vectors Group");
    v.addProperty("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size").setValue([size, size]);
    return v;
};

// Deep Glow when it is installed, otherwise the built-in Glow; amount in % (100 = original, 0 = no glow)
TL.pxGlow = function (layer, amount) {
    if (amount <= 0) return "";
    var fx = layer.property("ADBE Effect Parade");
    if (fx.canAddProperty("PEDG")) {
        // Exposure is in stops: twice the glow = one stop more
        fx.addProperty("PEDG").property("PEDG-0002").setValue(0.11 + Math.log(amount / 100) / Math.LN2);
        return "Deep Glow";
    }
    fx.addProperty("ADBE Glo2").property("ADBE Glo2-0004").setValue(amount / 100); // Glow Intensity
    return "Glow";
};

// wave settings from the panel, clamped; every value is % of the original rig except dur (seconds)
TL.pxOptions = function (o) {
    o = o || {};
    var num = function (v, d, lo, hi) { v = Number(v); return isNaN(v) ? d : Math.max(lo, Math.min(hi, v)); };
    return {
        mode: (o.mode === "out" || o.mode === "static") ? o.mode : "in",
        auto: !!o.auto,
        pixel: Math.round(num(o.pixel, 100, 1, 1000)),
        dur: num(o.dur, 1.75, 0.2, 20),
        width: Math.round(num(o.width, 100, 10, 500)),
        lead: Math.round(num(o.lead, 100, 30, 300)),
        tail: Math.round(num(o.tail, 100, 10, 300)),
        soft: Math.round(num(o.soft, 100, 0, 400)),
        glow: Math.round(num(o.glow, 100, 0, 400)),
        edges: Math.round(num(o.edges, 100, 0, 100)),
        lines: Math.round(num(o.lines, 100, 0, 500)),
        speed: Math.round(num(o.speed, 100, 0, 500))
    };
};

/*
 * Line width of the grid (Reveal edges). Find Edges draws ~1 px lines in the reveal precomp, so on screen
 * they are usually 1 px or thinner already: below 100 % they fade in step with the width (a sub-pixel
 * line can only get fainter), above 100 % Minimax grows them inside the precomp, keeping the original look.
 */
TL.pxLineWidth = function (E, o) {
    if (o.lines < 100) {
        E.property("ADBE Transform Group").property("ADBE Opacity").setValue(o.edges * o.lines / 100);
    } else if (o.lines >= 150) {
        var mm = E.property("ADBE Effect Parade").addProperty("ADBE Minimax");
        mm.property("ADBE Minimax-0001").setValue(2);                                  // Operation: Maximum (bright lines grow)
        mm.property("ADBE Minimax-0002").setValue(Math.round((o.lines / 100 - 1) / 2)); // Radius, px of the precomp
    }
};

// parenting keeps the layer where it was on screen by changing its scale / rotation - the rig needs them at rest
TL.pxParent = function (layer, parent) {
    layer.parent = parent;
    var t = layer.property("ADBE Transform Group");
    t.property("ADBE Scale").setValue([100, 100, 100]);
    var rot = layer.threeDLayer ? ["ADBE Rotate X", "ADBE Rotate Y", "ADBE Rotate Z"] : ["ADBE Rotate Z"];
    for (var i = 0; i < rot.length; i++) t.property(rot[i]).setValue(0);
    if (layer.threeDLayer) t.property("ADBE Orientation").setValue([0, 0, 0]);
};

TL.pxTritone = function (layer, hi, mid) {
    var t = layer.property("ADBE Effect Parade").addProperty("ADBE Tritone");
    t.property("ADBE Tritone-0001").setValue(hi);
    t.property("ADBE Tritone-0002").setValue(mid);
};

// "Scene 1 reveal": block noise seen through a growing, blurred green ring - made once per set of
// wave settings (pixel size, width, lead, tail, softness, noise speed), e.g. "PixelateClick reveal p60 w150"
TL.pxRevealComp = function (o) {
    var root = TL.getProjectFolder(TL.PROJECT_FOLDER);
    var keys = [["p", o.pixel], ["w", o.width], ["l", o.lead], ["t", o.tail], ["s", o.soft], ["n", o.speed]], tag = "";
    for (var i = 0; i < keys.length; i++) if (keys[i][1] !== 100) tag += " " + keys[i][0] + keys[i][1];
    var name = TL.PX_COMP + tag;
    var c = TL.findCompIn(root, name);
    if (c) return c;
    var S = TL.PX_SIZE;
    c = app.project.items.addComp(name, S, S, 1, 3.5, 60);
    c.parentFolder = root;

    var solid = c.layers.addSolid([1, 1, 1], "White solid", S, S, 1, 3.5);
    var n = solid.property("ADBE Effect Parade").addProperty("ADBE Fractal Noise");
    n.property("ADBE Fractal Noise-0001").setValue(11);
    n.property("ADBE Fractal Noise-0002").setValue(1);
    n.property("ADBE Fractal Noise-0004").setValue(110);
    n.property("ADBE Fractal Noise-0005").setValue(5);
    n.property("ADBE Fractal Noise-0015").setValue(1);
    n.property("ADBE Fractal Noise-0010").setValue(o.pixel); // Scale: the size of the blocks (and so of the edge grid)
    n.property("ADBE Fractal Noise-0023").expression = "time*" + (2 * o.speed); // 200 / s originally

    var ring = c.layers.addShape();
    ring.name = "Shape Layer-Stroke";
    var st = TL.pxEllipse(ring, 792).addProperty("ADBE Vector Graphic - Stroke");
    st.property("ADBE Vector Stroke Color").setValue([0, 1, 0.0706, 1]);
    st.property("ADBE Vector Stroke Width").setValue(295 * o.width / 100);
    if (o.soft > 0) ring.property("ADBE Effect Parade").addProperty("ADBE Box Blur2").property("ADBE Box Blur2-0001").setValue(50 * o.soft / 100);
    var tr = ring.property("ADBE Transform Group");
    tr.property("ADBE Position").setValue([S / 2, S / 2]);
    var end = 424 * o.lead / 100;
    TL.pxKeys(tr.property("ADBE Scale"), 0, [0, 0, 100], 1.683, [end, end, 100]);
    // Tail: how long the wave takes to fade out at the end (0.5 s originally)
    TL.pxKeys(tr.property("ADBE Opacity"), Math.max(0.02, 1.683 - 0.5 * o.tail / 100), 100, 1.683, 0);
    solid.setTrackMatte(ring, TrackMatteType.ALPHA);
    ring.enabled = false;
    return c;
};

// full brightness, a little more saturation so the blocks read as colour; null for black / grey (keep the aqua)
TL.pxNormColor = function (c) {
    if (!c) return null;
    var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
    if (mx < 0.02 || mx - mn < 0.04) return null;
    var out = [];
    for (var k = 0; k < 3; k++) out.push(Math.max(0, Math.min(1, ((c[k] - mn) * 1.15 + mn * 0.85) / mx)));
    return out;
};

// most vivid of some colours: saturation x brightness
TL.pxVivid = function (list) {
    var best = null, score = -1;
    for (var i = 0; i < list.length; i++) {
        var c = list[i], mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), s = (mx - mn) * mx;
        if (s > score) { score = s; best = c; }
    }
    return best;
};

// shape / text layers: their fill and stroke colours (sampleImage does not work on them - it stops the script)
TL.pxVectorColors = function (T, t) {
    var out = [];
    if (T instanceof TextLayer) {
        try {
            var doc = T.property("ADBE Text Properties").property("ADBE Text Document").valueAtTime(t, false);
            if (doc.applyFill) out.push(doc.fillColor);
            if (doc.applyStroke) out.push(doc.strokeColor);
        } catch (e) {}
        return out;
    }
    var walk = function (g) {
        for (var i = 1; i <= g.numProperties; i++) {
            var p = g.property(i);
            if (p.enabled === false) continue;
            var mn = p.matchName;
            if (mn === "ADBE Vector Graphic - Fill") out.push(p.property("ADBE Vector Fill Color").valueAtTime(t, false));
            else if (mn === "ADBE Vector Graphic - Stroke") out.push(p.property("ADBE Vector Stroke Color").valueAtTime(t, false));
            else if (p.propertyType !== PropertyType.PROPERTY) walk(p);
        }
    };
    walk(T.property("ADBE Root Vectors Group"));
    return out;
};

// Auto color: the most vivid colour of the layer - shape / text from their colours, anything else
// from its pixels (10 x 10 areas, sampled by an expression on a temporary null)
TL.pxAutoColor = function (comp, T, t) {
    if (T instanceof ShapeLayer || T instanceof TextLayer) return TL.pxNormColor(TL.pxVivid(TL.pxVectorColors(T, t)));
    var items = app.project.numItems;
    var tmp = comp.layers.addNull();
    var newSolid = app.project.numItems > items; // AE may reuse an existing null solid - that one stays
    try {
        var p = tmp.property("ADBE Effect Parade").addProperty("ADBE Color Control").property(1);
        p.expression = [
            "var L = thisComp.layer(" + T.index + "), t = " + t + ";",
            "var r = L.sourceRectAtTime(t, false), n = 10, best = [0, 0, 0, 1], score = -1;",
            "for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {",
            "  var c = L.sampleImage([r.left + (i + .5) * r.width / n, r.top + (j + .5) * r.height / n], [r.width / n / 2, r.height / n / 2], true, t);",
            "  if (c[3] < .5) continue;",
            "  var mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]), s = (mx - mn) * mx;",
            "  if (s > score) { score = s; best = c; }",
            "}",
            "best;"
        ].join("\n");
        return TL.pxNormColor(p.valueAtTime(t, false));
    } catch (e) {
        return null;
    } finally {
        var solid = tmp.source;
        tmp.remove();
        try { if (newSolid && solid && solid.usedIn.length === 0) solid.remove(); } catch (eS) {}
    }
};

// the rig's aqua colours re-tinted: every colour keeps its brightness, the hue comes from c
TL.pxTint = function (col, c) {
    if (!c) return col;
    var f = Math.max(col[0], col[1], col[2]);
    return [c[0] * f, c[1] * f, c[2] * f, 1];
};

TL.pxIsReveal = function (L) {
    return !!(L && L.source && L.source instanceof CompItem && L.source.name.indexOf(TL.PX_COMP) === 0);
};

// the layer the effect is on, from that layer itself or any of its rig layers
TL.pxTarget = function (comp, L) {
    if (TL.pxIsReveal(L)) {
        while (L.parent && TL.pxIsReveal(L.parent)) L = L.parent;
        return L.parent || null;
    }
    if (L.name === "Ui reveal layer") {
        for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).trackMatteLayer === L) return comp.layer(i);
        return null;
    }
    var m = L.trackMatteLayer;
    if (m && m.name === "Ui reveal layer") return L;
    // Static has no matte: the layer is the parent of the Reveal layer
    for (var j = 1; j <= comp.numLayers; j++) if (comp.layer(j).parent === L && TL.pxIsReveal(comp.layer(j))) return L;
    return null;
};

// take the rig off T: its Reveal layers and matte are deleted, T goes back to static without a matte
TL.pxStrip = function (comp, T, used) {
    var M = T.trackMatteLayer, kill = [], j;
    for (j = 1; j <= comp.numLayers; j++) {
        var L = comp.layer(j);
        if (TL.pxIsReveal(L) && TL.pxTarget(comp, L) === T) kill.push(L);
    }
    try { T.removeTrackMatte(); } catch (eM) { T.trackMatteType = TrackMatteType.NO_TRACK_MATTE; }
    if (M && M.name === "Ui reveal layer") kill.push(M);
    for (j = 0; j < kill.length; j++) {
        if (kill[j].source) used.push(kill[j].source);
        kill[j].remove();
    }
    T.enabled = true;
    TL.writeMark(T, "TLPX", null);
};

// the noise precomps go too once nothing uses them
TL.pxCleanComps = function (comps) {
    for (var i = 0; i < comps.length; i++) {
        try {
            if (comps[i].usedIn.length !== 0) continue;
            var solids = [];
            for (var j = 1; j <= comps[i].numLayers; j++) if (comps[i].layer(j).source) solids.push(comps[i].layer(j).source);
            comps[i].remove();
            for (j = 0; j < solids.length; j++) if (solids[j].usedIn.length === 0) solids[j].remove(); // its "White solid" item
        } catch (e) {} // already removed
    }
};

TL.pixelateRemove = function () {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var sel = comp.selectedLayers, targets = [], i, j;
    for (i = 0; i < sel.length; i++) {
        var T = TL.pxTarget(comp, sel[i]);
        if (!T) continue;
        for (j = 0; j < targets.length; j++) if (targets[j] === T) break;
        if (j === targets.length) targets.push(T);
    }
    if (!targets.length) return TL.err("Select a layer with PixelateClick (or one of its Reveal layers).");

    app.beginUndoGroup("Text Library: Remove PixelateClick");
    try {
        var used = [];
        for (i = 0; i < targets.length; i++) {
            TL.pxStrip(comp, targets[i], used);
            targets[i].selected = true;
        }
        TL.pxCleanComps(used);
        return TL.ok({ count: targets.length });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

// fx, fy: where the reveal starts, 0..1 across the layer (0,0 = top left); opts: see TL.pxOptions -
// mode "in" (appear), "out" (disappear - the appear played backwards) or "static" (always visible),
// auto: tint the effect with the layer's most vivid colour instead of aqua, plus the wave settings
TL.pixelateAdd = function (fx, fy, opts) {
    var o = TL.pxOptions(opts), mode = o.mode, reverse = mode === "out";
    var upd = !!(opts && opts.update); // live update from the panel: rebuild the existing rigs with new settings
    var sc = o.dur / 1.75, D = o.dur;
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");

    var targets = [], i, j, L;
    for (i = 0; i < comp.selectedLayers.length; i++) {
        L = comp.selectedLayers[i];
        L = TL.pxTarget(comp, L) || L; // a selected Reveal layer stands for the layer it is on
        if (TL.pxIsReveal(L) || L.name === "Ui reveal layer") continue;
        if (upd && TL.pxTarget(comp, L) !== L) continue; // update: only layers that have the effect
        if (!(L instanceof AVLayer || L instanceof ShapeLayer || L instanceof TextLayer)) continue;
        for (j = 0; j < targets.length; j++) if (targets[j] === L) break;
        if (j === targets.length) targets.push(L);
    }

    var marks = [];
    for (i = 0; i < targets.length; i++) marks.push(TL.readMark(targets[i], "TLPX"));
    app.beginUndoGroup(upd ? "Text Library: PixelateClick update" : "Text Library: PixelateClick");
    try {
        // adding again replaces the old rig (e.g. to change the pixel size)
        var old = [];
        for (i = 0; i < targets.length; i++) if (TL.pxTarget(comp, targets[i]) === targets[i]) TL.pxStrip(comp, targets[i], old);
        TL.pxCleanComps(old);

        // nothing selected in the comp: bring in what is selected in the Project panel
        if (upd && !targets.length) return TL.ok({ count: 0 });
        if (!targets.length) {
            var sel = app.project.selection;
            for (i = 0; i < sel.length; i++) {
                var it = sel[i];
                if (it === comp || !(it instanceof FootageItem || it instanceof CompItem) || !it.hasVideo) continue;
                L = comp.layers.add(it);
                L.startTime = comp.time;
                targets.push(L);
            }
        }
        if (!targets.length) return TL.err("Select a layer in the comp, or an image / item in the Project panel.");

        var src = TL.pxRevealComp(o), S = TL.PX_SIZE, glow = "", colors = [];
        var ALPHA = TrackMatteType.ALPHA;
        var edges = [ // two glowing edge passes, one frame before and three frames after the reveal
            { start: -0.0167, dur: 1.7, hi: [0, 0.2784, 0.249, 1], mid: [0, 0.6706, 0.5996, 1] },
            { start: 0.05, dur: 1.783, hi: [0, 0.4, 0.3576, 1], mid: [0.0982, 0.2235, 0.2103, 1] }
        ];
        for (i = 0; i < targets.length; i++) {
            var T = targets[i];
            var mk = upd ? marks[i] : null; // update: same start time and colour as when it was added
            var t0 = mk && mk.t0 !== undefined ? mk.t0 : Math.max(comp.time, T.inPoint);
            var tint = !o.auto ? null : (mk && mk.tint ? mk.tint : TL.pxAutoColor(comp, T, t0));
            colors.push(tint);
            var r = T.sourceRectAtTime(t0, false);
            var ox = r.left + fx * r.width, oy = r.top + fy * r.height;
            var R = 0, cs = [[r.left, r.top], [r.left + r.width, r.top], [r.left, r.top + r.height], [r.left + r.width, r.top + r.height]];
            for (j = 0; j < 4; j++) R = Math.max(R, Math.sqrt(Math.pow(cs[j][0] - ox, 2) + Math.pow(cs[j][1] - oy, 2)));
            var k = Math.max(R, 1) * 1.1 / TL.PX_MASK_END; // the circle reaches the farthest corner
            var is3D = T.threeDLayer;
            var pos = is3D ? [ox, oy, 0] : [ox, oy];

            // matte: blurred white circle growing from the chosen point (Disappear: shrinking back to it;
            // Static: no matte, the layer stays at full opacity and only the noise ring runs over it)
            var M = null;
            if (mode !== "static") {
                M = comp.layers.addShape();
                M.name = "Ui reveal layer";
                M.label = 8;
                TL.pxEllipse(M, 732).addProperty("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue([1, 1, 1, 1]);
                if (o.soft > 0) M.property("ADBE Effect Parade").addProperty("ADBE Box Blur2").property("ADBE Box Blur2-0001").setValue(43 * o.soft / 100);
                M.threeDLayer = is3D;
                M.moveBefore(T);
                TL.pxParent(M, T);
                M.property("ADBE Transform Group").property("ADBE Position").setValue(pos);
                var none = [0, 0, 100], full = [287.091 * k, 287.091 * k, 100];
                TL.pxKeys(M.property("ADBE Transform Group").property("ADBE Scale"), t0, reverse ? full : none, t0 + D, reverse ? none : full, reverse);
                M.inPoint = T.inPoint;
                M.outPoint = T.outPoint;
                T.setTrackMatte(M, ALPHA);
            }

            // the noise ring on top of the design
            var RV = comp.layers.add(src);
            RV.name = "Reveal";
            RV.label = 9;
            RV.threeDLayer = is3D;
            RV.moveBefore(M || T);
            TL.pxParent(RV, T);
            RV.property("ADBE Transform Group").property("ADBE Position").setValue(pos);
            RV.property("ADBE Transform Group").property("ADBE Scale").setValue([98.98 * k, 98.98 * k, 98.98 * k]);
            TL.pxTiming(RV, t0, 0, 1.75, reverse, sc);
            TL.pxTritone(RV, [0, 0, 0, 1], TL.pxTint([0, 1, 0.8941, 1], tint));
            glow = TL.pxGlow(RV, o.glow);
            RV.setTrackMatte(T, ALPHA);

            var above = RV;
            for (j = o.edges > 0 && o.lines > 0 ? edges.length - 1 : -1; j >= 0; j--) {
                var e = edges[j], E = comp.layers.add(src);
                E.name = "Reveal edges";
                E.label = 9;
                E.threeDLayer = is3D;
                E.moveBefore(above);
                E.blendingMode = BlendingMode.ADD;
                TL.pxParent(E, RV);
                E.property("ADBE Transform Group").property("ADBE Position").setValue(is3D ? [S / 2, S / 2, 0] : [S / 2, S / 2]);
                TL.pxTiming(E, t0, e.start, e.dur, reverse, sc);
                E.property("ADBE Transform Group").property("ADBE Opacity").setValue(o.edges);
                TL.pxTritone(E, TL.pxTint(e.hi, tint), TL.pxTint(e.mid, tint));
                TL.pxGlow(E, o.glow);
                E.property("ADBE Effect Parade").addProperty("ADBE Find Edges").property("ADBE Find Edges-0001").setValue(1);
                TL.pxLineWidth(E, o);
                E.setTrackMatte(T, ALPHA);
                above = E;
            }
            if (M) M.enabled = false;
            T.enabled = true;
            TL.writeMark(T, "TLPX", { t0: t0, tint: tint }); // live updates rebuild the rig from here
        }

        for (i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        for (i = 0; i < targets.length; i++) targets[i].selected = true;
        return TL.ok({ count: targets.length, glow: glow, colors: colors });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};
/* ------------------------------------------------------------------ */
/* Progressive Blur: Compound Blur driven by a gradient map, per layer  */
/* ------------------------------------------------------------------ */

// Each rig on layer T (a layer can have several - e.g. one from the left, one from the right):
// "PB Start n" / "PB End n" nulls parented to T, a hidden "PB Map n" layer of a precomp the size of T's
// pixel buffer with a Gradient Ramp (black = sharp, white = full blur) whose points follow the nulls,
// and a Compound Blur "Progressive Blur n" on T reading that map. The first rig has no number.
TL.PB_FX = "Progressive Blur";
TL.PB_HANDLE_RE = /^PB (Start|End)( \d+)? - /;

// where effects on T read a point: shape / text layers work in a comp-sized buffer in comp coordinates
// (checked by render), footage / precomps in their own layer space - a handle parented to T is already there
TL.pbPointExpr = function (T, compName, handleName) {
    var L = "var L = comp(" + TL.quote(compName) + ").layer(" + TL.quote(handleName) + ");\n";
    return (T instanceof ShapeLayer || T instanceof TextLayer) ? L + "L.toComp(L.anchorPoint);" : L + "L.transform.position;";
};

// the rig number of a Progressive Blur effect or a PB layer name (1 when it has none)
TL.pbNum = function (name) {
    var m = /^(?:Progressive Blur|PB (?:Start|End|Map))( (\d+))?( - |$)/.exec(name);
    return m && m[2] ? parseInt(m[2], 10) : 1;
};
TL.pbSuffix = function (n) { return n > 1 ? " " + n : ""; };

TL.pbEffects = function (T) {
    var out = [], fx = T.property("ADBE Effect Parade");
    if (!fx) return out;
    for (var i = 1; i <= fx.numProperties; i++) {
        var e = fx.property(i);
        if (e.matchName === "ADBE Compound Blur" && /^Progressive Blur( \d+)?$/.test(e.name)) out.push(e);
    }
    return out;
};

// which rigs a selected layer stands for: the layer itself = all its rigs, a handle / map = just that rig
TL.pbPick = function (comp, L) {
    var all = TL.pbEffects(L);
    if (all.length) return { T: L, effects: all };
    if (L.parent && TL.PB_HANDLE_RE.test(L.name)) {
        var n = TL.pbNum(L.name), list = TL.pbEffects(L.parent);
        for (var i = 0; i < list.length; i++) if (TL.pbNum(list[i].name) === n) return { T: L.parent, effects: [list[i]] };
        return null;
    }
    for (var j = 1; j <= comp.numLayers; j++) {
        var es = TL.pbEffects(comp.layer(j));
        for (var k = 0; k < es.length; k++) {
            if (es[k].property("ADBE Compound Blur-0001").value === L.index) return { T: comp.layer(j), effects: [es[k]] };
        }
    }
    return null;
};

// take one rig off T: its effect, map layer (+ precomp and solid) and handles
TL.pbStripOne = function (comp, T, e) {
    var n = TL.pbNum(e.name), mapIdx = e.property("ADBE Compound Blur-0001").value, kill = [], i;
    for (i = 1; i <= comp.numLayers; i++) {
        var L = comp.layer(i);
        if (L.index === mapIdx || (L.parent === T && TL.PB_HANDLE_RE.test(L.name) && TL.pbNum(L.name) === n)) kill.push(L);
    }
    e.remove();
    for (i = 0; i < kill.length; i++) {
        var src = kill[i].source;
        kill[i].remove();
        try {
            if (src && src.usedIn.length === 0) {
                if (src instanceof CompItem) {
                    var inner = [];
                    for (var j = 1; j <= src.numLayers; j++) if (src.layer(j).source) inner.push(src.layer(j).source);
                    src.remove();
                    for (j = 0; j < inner.length; j++) if (inner[j].usedIn.length === 0) inner[j].remove();
                } else {
                    src.remove(); // the null's solid
                }
            }
        } catch (eS) {}
    }
};

// a layer name not used yet in the comp (the ramp expressions find the handles by name)
TL.pbFreeName = function (comp, base) {
    var name = base, k = 2, taken = function (s) {
        for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === s) return true;
        return false;
    };
    while (taken(name)) name = base + " #" + (k++);
    return name;
};

TL.pbHandle = function (comp, T, name, pos) {
    var n = comp.layers.addNull(comp.duration);
    n.name = TL.pbFreeName(comp, name);
    n.label = 2;
    n.moveBefore(T);
    n.parent = T;
    var t = n.property("ADBE Transform Group");
    t.property("ADBE Scale").setValue([100, 100, 100]); // parenting rescales to keep the look - not needed here
    t.property("ADBE Rotate Z").setValue(0);
    t.property("ADBE Position").setValue(pos);
    n.inPoint = T.inPoint;
    n.outPoint = T.outPoint;
    return n;
};

// start / end: 0..1 across the layer's visible content (0,0 = top left); blur: maximum blur in px.
// A layer that already has a Progressive Blur gets one more (Progressive Blur 2, 3, ...).
TL.progressiveBlurAdd = function (start, end, blur) {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    blur = Math.max(0, Math.min(500, Number(blur) || 0));

    var targets = [], i, j, L, p;
    for (i = 0; i < comp.selectedLayers.length; i++) {
        L = comp.selectedLayers[i];
        p = TL.pbPick(comp, L);
        if (p) L = p.T; // a selected handle / map stands for the layer it belongs to
        if (/^PB (Start|End|Map)/.test(L.name)) continue;
        if (!(L instanceof AVLayer || L instanceof ShapeLayer || L instanceof TextLayer)) continue; // not subclasses in ExtendScript
        for (j = 0; j < targets.length; j++) if (targets[j] === L) break;
        if (j === targets.length) targets.push(L);
    }

    app.beginUndoGroup("Text Library: Progressive Blur");
    try {
        // nothing selected in the comp: bring in what is selected in the Project panel
        if (!targets.length) {
            var sel = app.project.selection;
            for (i = 0; i < sel.length; i++) {
                var it = sel[i];
                if (it === comp || !(it instanceof FootageItem || it instanceof CompItem) || !it.hasVideo) continue;
                L = comp.layers.add(it);
                L.startTime = comp.time;
                targets.push(L);
            }
        }
        if (!targets.length) return TL.err("Select a layer in the comp, or an image / item in the Project panel.");

        var root = TL.getProjectFolder(TL.PROJECT_FOLDER), nums = [];
        for (i = 0; i < targets.length; i++) {
            var T = targets[i];
            // the next free rig number on this layer
            var used = {}, have = TL.pbEffects(T), n = 1;
            for (j = 0; j < have.length; j++) used[TL.pbNum(have[j].name)] = true;
            while (used[n]) n++;
            nums.push(n);

            var r = T.sourceRectAtTime(Math.max(comp.time, T.inPoint), false);
            var at = function (f) { return [r.left + f[0] * r.width, r.top + f[1] * r.height]; };
            var tag = TL.pbSuffix(n) + " - " + T.name;
            var hs = TL.pbHandle(comp, T, "PB Start" + tag, at(start));
            var he = TL.pbHandle(comp, T, "PB End" + tag, at(end));

            // the map: T's buffer size, ramp points follow the handles
            var W = Math.max(4, Math.round(T.width)), H = Math.max(4, Math.round(T.height));
            var mc = app.project.items.addComp("PB Map" + tag, W, H, 1, Math.max(comp.duration, 1), comp.frameRate);
            mc.parentFolder = root;
            var g = mc.layers.addSolid([0, 0, 0], "Gradient", W, H, 1, mc.duration);
            var ramp = g.property("ADBE Effect Parade").addProperty("ADBE Ramp");
            ramp.property("ADBE Ramp-0001").expression = TL.pbPointExpr(T, comp.name, hs.name);
            ramp.property("ADBE Ramp-0003").expression = TL.pbPointExpr(T, comp.name, he.name);

            var mapName = TL.pbFreeName(comp, "PB Map" + tag); // before adding: the new layer takes the comp's name
            var M = comp.layers.add(mc);
            M.name = mapName;
            M.label = 15;
            M.moveAfter(T);
            M.enabled = false;

            var cb = T.property("ADBE Effect Parade").addProperty("ADBE Compound Blur");
            cb.name = TL.PB_FX + TL.pbSuffix(n);
            cb.property("ADBE Compound Blur-0001").setValue(M.index);
            cb.property("ADBE Compound Blur-0002").setValue(blur);
        }

        for (i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        for (i = 0; i < targets.length; i++) targets[i].selected = true;
        return TL.ok({ count: targets.length, nums: nums });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
};

// the layer selected: all its blurs go; a PB Start / End / Map layer selected: only that blur goes
TL.progressiveBlurRemove = function () {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var sel = comp.selectedLayers, picks = [], i, j, k;
    for (i = 0; i < sel.length; i++) {
        var p = TL.pbPick(comp, sel[i]);
        if (p) picks.push(p);
    }
    if (!picks.length) return TL.err("Select a layer with Progressive Blur (or its PB Start / End / Map layer).");
    app.beginUndoGroup("Text Library: Remove Progressive Blur");
    try {
        var done = [], layers = [];
        for (i = 0; i < picks.length; i++) {
            for (j = 0; j < picks[i].effects.length; j++) {
                var e = picks[i].effects[j], key = picks[i].T.index + ":" + e.name;
                for (k = 0; k < done.length; k++) if (done[k] === key) break;
                if (k < done.length) continue; // start and end of the same blur both selected
                done.push(key);
                // after other rigs are removed the effect object may be stale: find it again by name
                var list = TL.pbEffects(picks[i].T), live = null;
                for (k = 0; k < list.length; k++) if (list[k].name === key.split(":")[1]) live = list[k];
                if (live) TL.pbStripOne(comp, picks[i].T, live);
            }
            layers.push(picks[i].T);
        }
        for (i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        for (i = 0; i < layers.length; i++) layers[i].selected = true;
        return TL.ok({ count: done.length });
    } catch (e2) {
        return TL.errFromException(e2);
    } finally {
        app.endUndoGroup();
    }
};
