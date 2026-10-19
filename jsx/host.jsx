/*
 * Text Library - After Effects host script (ExtendScript / ES3)
 * Every public function returns a JSON string: {ok:true,...} or {ok:false,error:"..."}
 */

var TL = TL || {};

TL.PREVIEW_FPS = 15;
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

        var target, start, end;
        if (type === "simple") {
            target = tempComp = proj.items.addComp(TL.PRESET_COMP, comp.width, comp.height, comp.pixelAspect, comp.duration, comp.frameRate);
            target.bgColor = [0, 0, 0];
            srcLayer.copyToComp(target);
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
            target = comp;
            start = comp.workAreaStart;
            end = comp.workAreaStart + comp.workAreaDuration;
        }
        if (end - start > TL.PREVIEW_MAX_SEC) end = start + TL.PREVIEW_MAX_SEC;
        if (end <= start) end = start + 1 / TL.PREVIEW_FPS;

        var oldRes = target.resolutionFactor;
        var f = Math.max(1, Math.ceil(target.width / TL.PREVIEW_MAX_WIDTH));
        target.resolutionFactor = [f, f];

        var count = Math.max(1, Math.floor((end - start) * TL.PREVIEW_FPS));
        for (var i = 0; i < count; i++) {
            var name = String(i + 1);
            while (name.length < 4) name = "0" + name;
            target.saveFrameToPng(start + i / TL.PREVIEW_FPS, new File(framesFolder.fsName + "/" + name + ".png"));
        }

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
                if (r && cur[i] !== undefined) a[i] = a[i] * cur[i] / r;
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
        try { dp.setValue(sp.value); } catch (eV) {}
    }

    if (hasExpr) {
        try {
            if (rec && dp.expression === "") rec.push({ p: path, e: 1 });
            dp.expression = sp.expression;
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
            var added = dg.addProperty(sp.matchName);
            if (!added) continue;
            childKey = added.propertyIndex;
            try { added.name = sp.name + (ctx.label && TL.TAG_PARENTS[dg.matchName] ? TL.tag(ctx.label) : ""); } catch (eN) {}
            if (dg.matchName === "ADBE Effect Parade" && ctx.record) ctx.record.fx.push({ mn: sp.matchName, n: sp.name });
            try { added.enabled = sp.enabled; } catch (eEn) {}
            if (sp.matchName === "ADBE Mask Atom") TL.copyMaskAttrs(sp, added);
            if (sp.matchName === "ADBE Text Animator") TL.clearAnimator(dstLayer, dPath.concat([childKey]));
        } else {
            if (!dg.property(sp.matchName)) continue;
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

    try { if (src.threeDLayer && !dst.threeDLayer) dst.threeDLayer = true; } catch (e1) {}
    try { if (src.threeDPerChar && TL.isTextLayer(dst)) dst.threeDPerChar = true; } catch (e2) {}
    try { if (src.motionBlur) dst.motionBlur = true; } catch (e3) {}

    if (TL.isTextLayer(src) && TL.isTextLayer(dst)) {
        var st = src.property("ADBE Text Properties");
        part("Text options", function () {
            TL.copyGroup(st.property("ADBE Text More Options"), dst, ["ADBE Text Properties", "ADBE Text More Options"], ctx, { record: true });
        });
        part("Text animators", function () {
            TL.copyGroup(st.property("ADBE Text Animators"), dst, ["ADBE Text Properties", "ADBE Text Animators"], ctx, {});
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
        TL.writeMark(dst, "TLA", data);
    }

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

/* Remove everything a preset added to the selected layers (both In and Out). */
TL.removePreset = function (label) {
    var comp = TL.activeComp();
    if (!comp) return TL.err("No active composition.");
    var sel = comp.selectedLayers, layers = [], i;
    for (i = 0; i < sel.length; i++) layers.push(sel[i]);
    if (!layers.length) return TL.err("Select the layers to remove \"" + label + "\" from.");

    var suffix = TL.tag(label);
    // Effect Parade stays in the list for effects tagged by the previous panel version
    var parades = [["ADBE Text Properties", "ADBE Text Animators"], ["ADBE Effect Parade"], ["ADBE Mask Parade"]];
    var tol = comp.frameDuration / 2;

    app.beginUndoGroup("Text Library: Remove Animation");
    try {
        var removed = 0, touched = 0;
        for (i = 0; i < layers.length; i++) {
            var layer = layers[i], before = removed, p, k, j;

            // 1) tagged groups: animators, effects, masks
            for (p = 0; p < parades.length; p++) {
                var g = TL.resolve(layer, parades[p]);
                if (!g) continue;
                for (j = g.numProperties; j >= 1; j--) {
                    var item = TL.resolve(layer, parades[p]).property(j); // re-resolve: remove() invalidates refs
                    var n = item ? item.name : "";
                    if (n.length >= suffix.length && n.substr(n.length - suffix.length) === suffix) {
                        item.remove();
                        removed++;
                    }
                }
            }

            // 2) keyframes / expressions added to existing properties
            var data = TL.readMark(layer, "TLA");
            var recs = data && data[label];
            if (recs instanceof Array) {
                var restore = [];
                for (var r = 0; r < recs.length; r++) {
                    // effects added by this preset: remove the last matching one (same name + type) for each record
                    var fx = recs[r].fx || [];
                    for (k = fx.length - 1; k >= 0; k--) {
                        var parade = layer.property("ADBE Effect Parade");
                        for (j = parade.numProperties; j >= 1; j--) {
                            var ef = layer.property("ADBE Effect Parade").property(j);
                            if (ef && ef.matchName === fx[k].mn && ef.name === fx[k].n) { ef.remove(); removed++; break; }
                        }
                    }
                    var keys = recs[r].keys || [];
                    for (k = 0; k < keys.length; k++) {
                        var e = keys[k], prop = TL.resolve(layer, e.p);
                        if (!prop) continue;
                        if (e.e) { try { prop.expression = ""; removed++; } catch (eE) {} }
                        if (e.t) {
                            for (j = 0; j < e.t.length; j++) {
                                try {
                                    if (prop.numKeys === 0) break;
                                    var idx = prop.nearestKeyIndex(e.t[j]);
                                    if (Math.abs(prop.keyTime(idx) - e.t[j]) <= tol) { prop.removeKey(idx); removed++; }
                                } catch (eK) {}
                            }
                        }
                        if (!e.h && e.o !== null && e.o !== undefined) restore.push(e);
                    }
                }
                // put back the static values the property had before the preset was applied
                for (k = 0; k < restore.length; k++) {
                    try {
                        var rp = TL.resolve(layer, restore[k].p);
                        if (rp && rp.numKeys === 0) rp.setValue(restore[k].o);
                    } catch (eS) {}
                }
                delete data[label];
                var left = false;
                for (var key in data) if (data.hasOwnProperty(key)) { left = true; break; }
                TL.writeMark(layer, "TLA", left ? data : null);
            }
            if (removed > before) touched++;
        }
        if (!removed) return TL.err("Nothing from \"" + label + "\" was found on the selected layers.");
        return TL.ok({ layers: touched });
    } catch (e) {
        return TL.errFromException(e);
    } finally {
        app.endUndoGroup();
    }
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
 * offsetFrames: frames between steps; step: how many layers share a step; reverse: bottom layer first.
 * Each call pushes the layers further (cumulative): click twice with offset 2 -> 0, 4, 8 ... frames.
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
            })(layers[i], Math.floor(i / step) * offsetFrames * comp.frameDuration);
        }
        return TL.ok({ count: layers.length });
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
