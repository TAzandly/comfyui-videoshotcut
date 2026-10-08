import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const PREVIEW_H = 160;
const TIMELINE_H = 56;
const CONTROLS_H = 28;
const WIDGET_H = PREVIEW_H + TIMELINE_H + CONTROLS_H + 44;
const MARKER_HIT_PX = 8;
const PLAYHEAD_HIT_PX = 10;
const ZOOM_MIN = 1;
const ZOOM_MAX = 64;
const MARKER_COLOR = "#f0a040";
const PLAYHEAD_COLOR = "#ffffff";
const TRACK_BG = "#1a1a1a";
const TRACK_FILL = "#2a2a2a";

function btnStyle() {
    // Use div[role=button] styles — native <button> inherits Comfy primary blue.
    return [
        "box-sizing:border-box",
        "display:inline-flex",
        "align-items:center",
        "justify-content:center",
        "height:24px",
        "min-width:28px",
        "padding:0 6px",
        "border:1px solid #555",
        "border-radius:3px",
        "background:#2a2a2a",
        "color:#eee",
        "cursor:pointer",
        "font:12px/1 sans-serif",
        "user-select:none",
        "-webkit-user-select:none",
    ].join(";");
}

function makeBtn(label, title) {
    const el = document.createElement("div");
    el.setAttribute("role", "button");
    el.tabIndex = 0;
    el.textContent = label;
    if (title) el.title = title;
    el.style.cssText = btnStyle();
    Object.defineProperty(el, "disabled", {
        get() {
            return el.dataset.disabled === "1";
        },
        set(v) {
            const on = !!v;
            el.dataset.disabled = on ? "1" : "0";
            el.style.opacity = on ? "0.4" : "1";
            el.style.pointerEvents = on ? "none" : "auto";
            el.tabIndex = on ? -1 : 0;
        },
    });
    el.addEventListener("keydown", (e) => {
        if (el.disabled) return;
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            el.click();
        }
    });
    return el;
}

function chainCallback(object, property, callback) {
    if (!object) return;
    if (property in object && object[property]) {
        const orig = object[property];
        object[property] = function () {
            const r = orig.apply(this, arguments);
            return callback.apply(this, arguments) ?? r;
        };
    } else {
        object[property] = callback;
    }
}

function hideWidget(w) {
    if (!w) return;
    w.hidden = true;
    w.type = "converted-widget";
    if (!w.options) w.options = {};
    w.options.hidden = true;
    w.computeSize = () => [0, -4];
    if (typeof w.computeLayoutSize === "function") {
        w.computeLayoutSize = () => ({ minHeight: 0, minWidth: 0 });
    }
    if (w.element) w.element.style.display = "none";
}

/** Hide Comfy's built-in combo video-preview; keep only our timeline preview. */
function suppressBuiltinVideoPreview(node) {
    const neutralize = (w) => {
        if (!w) return;
        hideWidget(w);
        w.width = undefined;
        w.computeLayoutSize = () => ({ minHeight: 0, maxHeight: 0, minWidth: 0 });
        w.computeSize = () => [0, -4];
        w.isVisible = () => false;
        if (w.element) {
            w.element.style.cssText =
                "display:none!important;width:0!important;height:0!important;overflow:hidden;margin:0;padding:0;";
        }
    };
    const hide = () => {
        for (const w of [...(node.widgets || [])]) {
            if (w?.name === "video-preview") neutralize(w);
        }
        if (node.videoContainer) {
            node.videoContainer.style.cssText =
                "display:none!important;height:0!important;width:0!important;max-width:0!important;overflow:hidden;margin:0;padding:0;pointer-events:none;position:absolute;opacity:0;";
            node.videoContainer.replaceChildren();
        }
        // Builtin preview sets node.previewMediaType = "video"; clear so nothing else styles it.
        if (node.previewMediaType === "video") node.previewMediaType = undefined;
    };
    if (!node._vscPreviewPatch && typeof node.addDOMWidget === "function") {
        node._vscPreviewPatch = true;
        const orig = node.addDOMWidget.bind(node);
        node.addDOMWidget = function (name, type, element, options) {
            const w = orig(name, type, element, options);
            if (name === "video-preview") {
                neutralize(w);
                queueMicrotask(hide);
            }
            return w;
        };
    }
    hide();
    requestAnimationFrame(hide);
    setTimeout(hide, 0);
    setTimeout(hide, 50);
    setTimeout(hide, 200);
}

async function apiFetch(path, options = {}) {
    if (typeof api.fetchApi === "function") {
        return api.fetchApi(path, options);
    }
    const url = typeof api.apiURL === "function" ? api.apiURL(path) : path;
    return fetch(url, options);
}

function viewUrlForInput(path) {
    // Comfy /view: filename may include subfolder as "sub/file.mp4"
    const name = String(path || "").replace(/\\/g, "/");
    const q = new URLSearchParams({ filename: name, type: "input" });
    if (typeof api.apiURL === "function") {
        return api.apiURL(`/view?${q}`);
    }
    return `/view?${q}`;
}

function emptyState() {
    return { version: 1, fps: 0, total_frames: 0, points: [] };
}

function parseState(raw) {
    try {
        const data = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {});
        const total = Math.max(0, Math.floor(Number(data.total_frames) || 0));
        const fps = Number(data.fps) || 0;
        const points = Array.isArray(data.points)
            ? [...new Set(data.points.map((p) => Math.floor(Number(p))).filter((p) => p > 0 && (total <= 0 || p < total)))].sort((a, b) => a - b)
            : [];
        return { version: 1, fps, total_frames: total, points };
    } catch {
        return emptyState();
    }
}

function serializeState(state) {
    return JSON.stringify({
        version: 1,
        fps: state.fps || 0,
        total_frames: state.total_frames || 0,
        points: [...state.points].sort((a, b) => a - b),
    });
}

function findWidget(node, name) {
    return node.widgets?.find((w) => w.name === name);
}

function hasVideoLink(node) {
    const input = node.inputs?.find((i) => i.name === "video");
    return !!(input && input.link != null);
}

function closeMenus() {
    document.querySelectorAll(".vsc-ctx").forEach((el) => el.remove());
}

function showContextMenu(event, items) {
    closeMenus();
    const menu = document.createElement("div");
    menu.className = "vsc-ctx";
    menu.style.cssText = [
        "position:fixed",
        `left:${event.clientX}px`,
        `top:${event.clientY}px`,
        "z-index:10000",
        "background:#222",
        "border:1px solid #555",
        "border-radius:4px",
        "padding:4px 0",
        "min-width:180px",
        "box-shadow:0 4px 16px rgba(0,0,0,0.45)",
        "font:12px/1.4 sans-serif",
        "color:#ddd",
        "user-select:none",
    ].join(";");

    const addItem = (parent, item) => {
        if (item === null) {
            const hr = document.createElement("div");
            hr.style.cssText = "height:1px;background:#444;margin:4px 0";
            parent.appendChild(hr);
            return;
        }
        const row = document.createElement("div");
        row.textContent = item.label + (item.submenu ? " ▸" : "");
        row.style.cssText = "padding:6px 14px;cursor:pointer;white-space:nowrap";
        row.addEventListener("mouseenter", () => {
            row.style.background = "#3a3a3a";
            parent.querySelectorAll(".vsc-sub").forEach((s) => s.remove());
            if (item.submenu) {
                const sub = document.createElement("div");
                sub.className = "vsc-sub";
                sub.style.cssText = [
                    "position:absolute",
                    "left:100%",
                    "top:0",
                    "background:#222",
                    "border:1px solid #555",
                    "border-radius:4px",
                    "padding:4px 0",
                    "min-width:120px",
                    "box-shadow:0 4px 16px rgba(0,0,0,0.45)",
                ].join(";");
                row.style.position = "relative";
                for (const subItem of item.submenu) addItem(sub, subItem);
                row.appendChild(sub);
            }
        });
        row.addEventListener("mouseleave", () => {
            row.style.background = "transparent";
        });
        if (!item.submenu) {
            row.addEventListener("click", (e) => {
                e.stopPropagation();
                closeMenus();
                item.action?.();
            });
        }
        parent.appendChild(row);
    };

    for (const item of items) addItem(menu, item);
    document.body.appendChild(menu);

    const onDoc = (e) => {
        if (!menu.contains(e.target)) {
            closeMenus();
            document.removeEventListener("mousedown", onDoc, true);
        }
    };
    setTimeout(() => document.addEventListener("mousedown", onDoc, true), 0);
}

function createTimelineUI(node) {
    const root = document.createElement("div");
    root.className = "vsc-root";
    root.style.cssText = "display:flex;flex-direction:column;gap:6px;width:100%;max-width:100%;min-width:0;box-sizing:border-box;padding:2px 0;color:#ccc;font:11px/1.3 sans-serif;overflow:hidden;background:transparent;filter:none;";

    const note = document.createElement("div");
    note.style.cssText = "display:none;color:#c9a060;padding:0 2px;";
    note.textContent = "Timeline preview uses video_file selection (Queue still works with VIDEO).";
    root.appendChild(note);

    const previewWrap = document.createElement("div");
    previewWrap.style.cssText = `height:${PREVIEW_H}px;width:100%;max-width:100%;min-width:0;background:#111;border:1px solid #333;border-radius:3px;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;box-sizing:border-box;`;

    const video = document.createElement("video");
    video.muted = false;
    video.volume = 1;
    video.playsInline = true;
    video.preload = "auto";
    video.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;display:none;background:#000;";

    const img = document.createElement("img");
    img.alt = "frame preview";
    img.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;display:none;";

    const placeholder = document.createElement("div");
    placeholder.textContent = "No preview";
    placeholder.style.cssText = "color:#666;";
    previewWrap.append(video, img, placeholder);
    root.appendChild(previewWrap);

    const controls = document.createElement("div");
    controls.style.cssText = `height:${CONTROLS_H}px;display:flex;align-items:center;gap:6px;padding:0 2px;min-width:0;width:100%;box-sizing:border-box;flex-wrap:nowrap;overflow:hidden;`;

    const playBtn = makeBtn("▶", "Play / Pause");
    playBtn.style.width = "32px";

    const zoomOutBtn = makeBtn("−", "Zoom out (or mouse wheel)");
    const zoomInBtn = makeBtn("+", "Zoom in (or mouse wheel)");
    const zoomFitBtn = makeBtn("Fit", "Fit entire timeline");

    const zoomLabel = document.createElement("span");
    zoomLabel.style.cssText = "color:#777;min-width:36px;flex-shrink:0;";
    zoomLabel.textContent = "1×";

    const delBtn = makeBtn("Delete", "Delete selected cut point");
    delBtn.style.display = "none";
    delBtn.style.background = "#5a2a2a";
    delBtn.style.borderColor = "#844";
    delBtn.disabled = true;

    const selLabel = document.createElement("span");
    selLabel.style.cssText = "color:#f0a040;min-width:0;display:none;";

    const meta = document.createElement("div");
    meta.style.cssText = "flex:1 1 auto;display:flex;justify-content:flex-end;align-items:center;gap:10px;color:#888;min-width:0;overflow:hidden;white-space:nowrap;";
    meta.innerHTML = '<span style="overflow:hidden;text-overflow:ellipsis"></span><span style="flex-shrink:0"></span>';
    meta.children[0].textContent = "frame —";
    meta.children[1].textContent = "— / —";

    controls.append(playBtn, zoomOutBtn, zoomInBtn, zoomFitBtn, zoomLabel, delBtn, selLabel, meta);
    root.appendChild(controls);

    const canvas = document.createElement("canvas");
    canvas.height = TIMELINE_H;
    canvas.style.cssText = `width:100%;height:${TIMELINE_H}px;display:block;cursor:default;border:1px solid #333;border-radius:3px;background:${TRACK_BG};touch-action:none;`;
    root.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    const state = {
        fps: 0,
        total_frames: 0,
        points: [],
        playhead: 0,
        path: null,
        blobUrl: null,
        useVideo: false,
        playing: false,
        raf: 0,
        drag: null, // { type: "playhead"|"marker"|"pan", index?, lastX? }
        seekingVideo: false,
        zoom: 1,
        viewStart: 0, // first visible frame when zoomed
        source_fps: 0,
        frameCache: new Map(), // key -> blobUrl
        previewTimer: null,
        previewSeq: 0,
        selectedMarker: -1, // index in points[], -1 = none
    };

    function splitWidget() {
        return findWidget(node, "split_points");
    }

    function videoWidget() {
        return findWidget(node, "video_file");
    }

    function fpsWidget() {
        return findWidget(node, "fps");
    }

    function getFpsOverride() {
        const v = Number(fpsWidget()?.value);
        return Number.isFinite(v) && v > 0 ? v : 0;
    }

    function writeSplitPoints() {
        const w = splitWidget();
        if (!w) return;
        w.value = serializeState(state);
        w.callback?.(w.value);
    }

    function readSplitPoints() {
        const parsed = parseState(splitWidget()?.value);
        state.fps = parsed.fps;
        state.total_frames = parsed.total_frames;
        state.points = parsed.points;
        if (state.total_frames > 0) {
            state.playhead = Math.min(state.playhead, state.total_frames - 1);
        }
    }

    function updateNote() {
        const vf = videoWidget()?.value;
        const show = (!vf || vf === "none") && hasVideoLink(node);
        note.style.display = show ? "block" : "none";
    }

    function updateMeta() {
        const total = state.total_frames || 0;
        const fps = state.fps || 0;
        const t = fps > 0 ? (state.playhead / fps).toFixed(2) + "s" : "—";
        const dur = fps > 0 && total > 0 ? (total / fps).toFixed(2) + "s" : "—";
        meta.children[0].textContent = `frame ${state.playhead}` + (fps ? ` @ ${fps.toFixed(2)}fps` : "");
        meta.children[1].textContent = `${t} / ${dur} · ${state.points.length} cut${state.points.length === 1 ? "" : "s"}`;
        playBtn.textContent = state.playing ? "⏸" : "▶";
        playBtn.disabled = !state.path || state.total_frames <= 0;
        zoomLabel.textContent = `${state.zoom.toFixed(state.zoom >= 10 ? 0 : 1)}×`;
        zoomOutBtn.disabled = state.zoom <= ZOOM_MIN;
        zoomInBtn.disabled = state.zoom >= ZOOM_MAX;

        const sel = state.selectedMarker;
        const hasSel = sel >= 0 && sel < state.points.length;
        delBtn.style.display = hasSel ? "inline-flex" : "none";
        delBtn.disabled = !hasSel;
        selLabel.style.display = hasSel ? "inline" : "none";
        if (hasSel) {
            selLabel.textContent = `#${sel + 1} @f${state.points[sel]}`;
        }
    }

    function selectMarker(index) {
        if (index < 0 || index >= state.points.length) {
            state.selectedMarker = -1;
        } else {
            state.selectedMarker = index;
        }
        updateMeta();
        draw();
    }

    function clearMarkerSelection() {
        if (state.selectedMarker < 0) return;
        state.selectedMarker = -1;
        updateMeta();
        draw();
    }

    function visibleSpan() {
        const total = Math.max(1, state.total_frames || 1);
        return Math.max(1, total / Math.max(ZOOM_MIN, state.zoom));
    }

    function clampView() {
        const total = Math.max(1, state.total_frames || 1);
        const span = visibleSpan();
        const maxStart = Math.max(0, total - span);
        state.viewStart = Math.max(0, Math.min(maxStart, state.viewStart));
    }

    function zoomAt(factor, anchorFrame) {
        const total = Math.max(1, state.total_frames || 1);
        const oldSpan = visibleSpan();
        const anchor = Number.isFinite(anchorFrame) ? anchorFrame : state.viewStart + oldSpan / 2;
        const rel = oldSpan > 0 ? (anchor - state.viewStart) / oldSpan : 0.5;
        state.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, state.zoom * factor));
        const newSpan = visibleSpan();
        state.viewStart = anchor - rel * newSpan;
        clampView();
        draw();
    }

    function panByFrames(deltaFrames) {
        state.viewStart += deltaFrames;
        clampView();
        draw();
    }

    function ensurePlayheadVisible() {
        const span = visibleSpan();
        if (state.playhead < state.viewStart) {
            state.viewStart = state.playhead;
        } else if (state.playhead > state.viewStart + span - 1) {
            state.viewStart = state.playhead - span + 1;
        }
        clampView();
    }

    function showPlaceholder(text) {
        placeholder.textContent = text;
        placeholder.style.display = "block";
        video.style.display = "none";
        img.style.display = "none";
    }

    function showVideoEl() {
        placeholder.style.display = "none";
        img.style.display = "none";
        video.style.display = "block";
        state.useVideo = true;
    }

    function frameToTime(frame) {
        const fps = state.fps > 0 ? state.fps : 30;
        return Math.max(0, frame / fps);
    }

    function timeToFrame(t) {
        const fps = state.fps > 0 ? state.fps : 30;
        const total = Math.max(1, state.total_frames || 1);
        return Math.max(0, Math.min(total - 1, Math.round(t * fps)));
    }

    function syncVideoToPlayhead() {
        if (!state.useVideo || !state.path) return;
        const target = frameToTime(state.playhead);
        // Avoid feedback loops while user/video is seeking
        if (Math.abs((video.currentTime || 0) - target) > 1 / Math.max(state.fps, 1)) {
            state.seekingVideo = true;
            try {
                video.currentTime = target;
            } catch {
                /* ignore */
            }
        }
    }

    function stopPlayback() {
        state.playing = false;
        if (state.raf) {
            cancelAnimationFrame(state.raf);
            state.raf = 0;
        }
        try { video.pause(); } catch { /* ignore */ }
        updateMeta();
        // Snap still to exact frame (HTML5 currentTime is not frame-accurate).
        if (state.path) loadJpegPreview(state.playhead, true);
    }

    function tickPlayback() {
        if (!state.playing) return;
        if (state.useVideo && !video.paused && !video.ended) {
            if (!state.seekingVideo && !state.drag) {
                state.playhead = timeToFrame(video.currentTime || 0);
                draw();
            }
            if (video.ended || state.playhead >= Math.max(0, state.total_frames - 1)) {
                stopPlayback();
                state.playhead = Math.max(0, state.total_frames - 1);
                draw();
                return;
            }
            state.raf = requestAnimationFrame(tickPlayback);
            return;
        }
        // Fallback: step frames without HTML5 video
        const fps = state.fps > 0 ? state.fps : 24;
        state._lastTick = state._lastTick || performance.now();
        const now = performance.now();
        const dt = (now - state._lastTick) / 1000;
        if (dt >= 1 / fps) {
            state._lastTick = now;
            if (state.playhead >= state.total_frames - 1) {
                stopPlayback();
                return;
            }
            state.playhead += 1;
            draw();
            loadJpegPreview(state.playhead);
        }
        state.raf = requestAnimationFrame(tickPlayback);
    }

    async function togglePlay() {
        if (!state.path || state.total_frames <= 0) return;
        if (state.playing) {
            stopPlayback();
            return;
        }
        state.playing = true;
        updateMeta();
        if (state.useVideo) {
            syncVideoToPlayhead();
            video.muted = false;
            video.volume = 1;
            video.style.display = "block";
            img.style.display = "none";
            placeholder.style.display = "none";
            try {
                await video.play();
            } catch (err) {
                console.warn("videoshotcut play:", err);
                stopPlayback();
                return;
            }
        } else {
            state._lastTick = performance.now();
        }
        state.raf = requestAnimationFrame(tickPlayback);
    }

    function showAccurateStill() {
        // Prefer exact JPEG over HTML5 video pixels (browser seek is not frame-accurate).
        if (img.getAttribute("src")) {
            img.style.display = "block";
            if (!state.playing) video.style.display = "none";
            placeholder.style.display = "none";
        }
    }

    function cacheKey(frameIndex) {
        return `${state.path}|${state.fps}|${frameIndex}`;
    }

    function clearFrameCache() {
        for (const url of state.frameCache.values()) {
            try { URL.revokeObjectURL(url); } catch { /* ignore */ }
        }
        state.frameCache.clear();
    }

    async function loadJpegPreview(frameIndex, immediate = false) {
        if (!state.path) return;
        clearTimeout(state.previewTimer);
        const run = async () => {
            const seq = ++state.previewSeq;
            const key = cacheKey(frameIndex);
            if (state.frameCache.has(key)) {
                if (seq !== state.previewSeq) return;
                img.src = state.frameCache.get(key);
                showAccurateStill();
                return;
            }
            const q = new URLSearchParams({
                path: state.path,
                frame_index: String(frameIndex),
                fps: String(getFpsOverride() || state.fps || 0),
            });
            try {
                const res = await apiFetch(`/videoshotcut/frame?${q}`);
                if (!res.ok) throw new Error(await res.text());
                const blob = await res.blob();
                if (seq !== state.previewSeq) return;
                const url = URL.createObjectURL(blob);
                // Bound cache size
                if (state.frameCache.size > 80) {
                    const first = state.frameCache.keys().next().value;
                    const old = state.frameCache.get(first);
                    state.frameCache.delete(first);
                    try { URL.revokeObjectURL(old); } catch { /* ignore */ }
                }
                state.frameCache.set(key, url);
                img.src = url;
                showAccurateStill();
            } catch (err) {
                if (seq !== state.previewSeq) return;
                placeholder.textContent = "Preview failed";
                placeholder.style.display = "block";
                console.warn("videoshotcut preview:", err);
            }
        };
        if (immediate) await run();
        else state.previewTimer = setTimeout(run, 100);
    }

    function attachVideoSource(path) {
        return new Promise((resolve) => {
            const url = viewUrlForInput(path);
            let settled = false;
            const done = (ok) => {
                if (settled) return;
                settled = true;
                video.removeEventListener("loadeddata", onOk);
                video.removeEventListener("error", onErr);
                resolve(ok);
            };
            const onOk = () => done(true);
            const onErr = () => done(false);
            video.addEventListener("loadeddata", onOk);
            video.addEventListener("error", onErr);
            video.src = url;
            video.load();
            // Safety timeout
            setTimeout(() => done(video.readyState >= 2), 4000);
        });
    }

    video.addEventListener("seeked", () => {
        state.seekingVideo = false;
    });

    function logicalWidth() {
        return Math.max(1, Math.floor(canvas.clientWidth || root.clientWidth || 280));
    }

    function syncCanvasSize() {
        // Keep CSS width:100% — do NOT pin style.width to px (that breaks layout / zoom).
        const cssW = logicalWidth();
        const cssH = TIMELINE_H;
        // Only OS DPR. Do not multiply by Comfy graph CSS scale (parent already scales the DOM).
        const ratio = Math.max(1, window.devicePixelRatio || 1);
        const bw = Math.max(1, Math.round(cssW * ratio));
        const bh = Math.max(1, Math.round(cssH * ratio));
        if (canvas.width !== bw || canvas.height !== bh) {
            canvas.width = bw;
            canvas.height = bh;
        }
        // Draw in CSS pixel space; backing store is HiDPI.
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.imageSmoothingEnabled = false;
    }

    function crispX(x) {
        // Align 2px strokes to device pixels for sharper markers.
        return Math.round(x) + 0.5;
    }

    function frameFromX(x) {
        const total = Math.max(1, state.total_frames || 1);
        const span = visibleSpan();
        const w = logicalWidth();
        const t = Math.max(0, Math.min(1, x / w));
        const frame = Math.floor(state.viewStart + t * span);
        return Math.max(0, Math.min(total - 1, frame));
    }

    function xFromFrame(frame) {
        const span = visibleSpan();
        const w = logicalWidth();
        return ((frame - state.viewStart + 0.5) / span) * w;
    }

    function localXY(e) {
        const rect = canvas.getBoundingClientRect();
        const w = logicalWidth();
        const h = TIMELINE_H;
        return {
            x: (e.clientX - rect.left) * (w / Math.max(1, rect.width)),
            y: (e.clientY - rect.top) * (h / Math.max(1, rect.height)),
        };
    }

    function hitPlayhead(x, y) {
        // Grab white handle in the top band only — avoids fighting markers on the track.
        if (y > 18) return false;
        return Math.abs(xFromFrame(state.playhead) - x) <= PLAYHEAD_HIT_PX;
    }

    function hitMarker(x, y) {
        // Markers grabbed on orange handle / upper half; track body prefers playhead scrub.
        if (y > 28) return -1;
        let best = -1;
        let bestDist = MARKER_HIT_PX + 1;
        for (let i = 0; i < state.points.length; i++) {
            const d = Math.abs(xFromFrame(state.points[i]) - x);
            if (d < bestDist) {
                bestDist = d;
                best = i;
            }
        }
        return best;
    }

    function markerClampRange(index) {
        const total = state.total_frames || 0;
        const lo = index > 0 ? state.points[index - 1] + 1 : 1;
        const hi = index < state.points.length - 1 ? state.points[index + 1] - 1 : Math.max(1, total - 1);
        return { lo, hi: Math.max(lo, hi) };
    }

    function draw() {
        syncCanvasSize();
        clampView();
        const w = logicalWidth();
        const h = TIMELINE_H;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = TRACK_BG;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = TRACK_FILL;
        ctx.fillRect(0, 16, w, h - 26);

        if (state.total_frames > 1) {
            const span = visibleSpan();
            const viewEnd = state.viewStart + span;

            // Time ticks in visible range
            if (state.fps > 0) {
                const step = Math.max(1, Math.round(state.fps / Math.max(1, Math.min(4, state.zoom))));
                ctx.strokeStyle = "#3a3a3a";
                ctx.lineWidth = 1;
                const first = Math.ceil(state.viewStart / step) * step;
                for (let f = first; f < viewEnd; f += step) {
                    const x = crispX(xFromFrame(f));
                    if (x < 0 || x > w) continue;
                    ctx.beginPath();
                    ctx.moveTo(x, 20);
                    ctx.lineTo(x, h - 14);
                    ctx.stroke();
                }
            }

            // Split markers with index labels (1-based)
            for (let i = 0; i < state.points.length; i++) {
                const p = state.points[i];
                if (p < state.viewStart - 1 || p > viewEnd + 1) continue;
                const x = crispX(xFromFrame(p));
                const selected = i === state.selectedMarker;
                const color = selected ? "#6ec8ff" : MARKER_COLOR;
                if (selected) {
                    ctx.strokeStyle = "#6ec8ff";
                    ctx.lineWidth = 4;
                    ctx.globalAlpha = 0.35;
                    ctx.beginPath();
                    ctx.moveTo(x, 12);
                    ctx.lineTo(x, h - 6);
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                }
                ctx.strokeStyle = color;
                ctx.lineWidth = selected ? 3 : 2;
                ctx.lineCap = "butt";
                ctx.beginPath();
                ctx.moveTo(x, 14);
                ctx.lineTo(x, h - 8);
                ctx.stroke();
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(x, 14);
                ctx.lineTo(x - (selected ? 6 : 5), 4);
                ctx.lineTo(x + (selected ? 6 : 5), 4);
                ctx.closePath();
                ctx.fill();
                // Crisp label with dark outline — numbers always 1..N after sort
                const label = String(i + 1);
                ctx.font = selected ? "bold 12px sans-serif" : "bold 11px sans-serif";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.lineWidth = 3;
                ctx.strokeStyle = "#111";
                ctx.strokeText(label, x, 9);
                ctx.fillStyle = selected ? "#dff4ff" : "#ffe0a8";
                ctx.fillText(label, x, 9);
                ctx.font = "bold 10px sans-serif";
                ctx.textBaseline = "top";
                ctx.strokeStyle = "#111";
                ctx.strokeText(label, x, h - 12);
                ctx.fillStyle = color;
                ctx.fillText(label, x, h - 12);
            }

            // Playhead on top
            const px = crispX(xFromFrame(state.playhead));
            if (px >= -4 && px <= w + 4) {
                ctx.strokeStyle = PLAYHEAD_COLOR;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(px, 2);
                ctx.lineTo(px, h - 4);
                ctx.stroke();
                ctx.fillStyle = PLAYHEAD_COLOR;
                ctx.beginPath();
                ctx.moveTo(px, 2);
                ctx.lineTo(px - 6, 13);
                ctx.lineTo(px + 6, 13);
                ctx.closePath();
                ctx.fill();
            }
        } else {
            ctx.fillStyle = "#555";
            ctx.font = "11px sans-serif";
            ctx.fillText("Select a video_file to load timeline", 10, h / 2 + 3);
        }
        updateMeta();
    }

    function normalizePoints() {
        const total = state.total_frames || 0;
        state.points = [...new Set(state.points.map((p) => Math.floor(p)).filter((p) => p > 0 && (total <= 0 || p < total)))].sort((a, b) => a - b);
    }

    function addCutAt(frame) {
        const total = state.total_frames || 0;
        const f = Math.floor(frame);
        if (total <= 0 || f <= 0 || f >= total) return;
        if (!state.points.includes(f)) {
            state.points.push(f);
        }
        // Always re-sort then reassign 1..N labels via draw(); select the inserted cut.
        normalizePoints();
        state.selectedMarker = state.points.indexOf(f);
        writeSplitPoints();
        state.playhead = f;
        syncVideoToPlayhead();
        loadJpegPreview(f, true);
        draw();
    }

    function deleteMarkerAt(index) {
        if (index < 0 || index >= state.points.length) return;
        state.points.splice(index, 1);
        // Keep selection on the next marker, or clear; numbers redraw as 1..N
        if (state.points.length === 0) {
            state.selectedMarker = -1;
        } else if (index >= state.points.length) {
            state.selectedMarker = state.points.length - 1;
        } else {
            state.selectedMarker = index;
        }
        writeSplitPoints();
        draw();
    }

    function deleteSelectedMarker() {
        if (state.selectedMarker < 0) return;
        deleteMarkerAt(state.selectedMarker);
    }

    function clearCuts() {
        state.points = [];
        state.selectedMarker = -1;
        writeSplitPoints();
        draw();
    }

    async function applyDetectResult(data) {
        state.fps = data.fps ?? state.fps;
        state.total_frames = data.total_frames ?? state.total_frames;
        state.points = Array.isArray(data.points) ? data.points.map((p) => Math.floor(p)) : [];
        state.selectedMarker = -1;
        normalizePoints();
        writeSplitPoints();
        draw();
        syncVideoToPlayhead();
        loadJpegPreview(state.playhead, true);
    }

    async function detectScenes(sensitivity) {
        if (!state.path) return;
        try {
            const res = await apiFetch("/videoshotcut/detect/scenes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    path: state.path,
                    sensitivity,
                    fps: getFpsOverride(),
                }),
            });
            if (!res.ok) throw new Error(await res.text());
            await applyDetectResult(await res.json());
        } catch (err) {
            console.warn("videoshotcut detect scenes:", err);
            alert("Scene detect failed: " + (err?.message || err));
        }
    }

    async function detectInterval(intervalSec) {
        if (!state.path) return;
        try {
            const res = await apiFetch("/videoshotcut/detect/interval", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    path: state.path,
                    interval_sec: intervalSec,
                    fps: getFpsOverride(),
                }),
            });
            if (!res.ok) throw new Error(await res.text());
            await applyDetectResult(await res.json());
        } catch (err) {
            console.warn("videoshotcut detect interval:", err);
            alert("Interval split failed: " + (err?.message || err));
        }
    }

    async function loadVideo(path) {
        stopPlayback();
        state.path = path && path !== "none" ? path : null;
        state.useVideo = false;
        state.zoom = 1;
        state.viewStart = 0;
        clearFrameCache();
        updateNote();
        if (state.blobUrl) {
            URL.revokeObjectURL(state.blobUrl);
            state.blobUrl = null;
        }
        video.removeAttribute("src");
        video.load();

        if (!state.path) {
            state.total_frames = 0;
            state.fps = 0;
            state.source_fps = 0;
            showPlaceholder("No preview");
            draw();
            return;
        }
        showPlaceholder("Loading…");
        try {
            const q = new URLSearchParams({
                path: state.path,
                fps: String(getFpsOverride()),
            });
            const res = await apiFetch(`/videoshotcut/info?${q}`);
            if (!res.ok) throw new Error(await res.text());
            const info = await res.json();
            readSplitPoints();
            state.fps = info.fps || 0;
            state.source_fps = info.source_fps || info.fps || 0;
            state.total_frames = info.total_frames || 0;
            normalizePoints();
            writeSplitPoints();
            state.playhead = Math.min(state.playhead, Math.max(0, state.total_frames - 1));

            const ok = await attachVideoSource(state.path);
            state.useVideo = !!ok;
            // Always show frame-accurate still for the playhead (not HTML5 pixels).
            await loadJpegPreview(state.playhead, true);
            draw();
        } catch (err) {
            console.warn("videoshotcut info:", err);
            showPlaceholder("Failed to load video info");
            draw();
        }
    }

    function localX(e) {
        return localXY(e).x;
    }

    canvas.tabIndex = 0; // allow Delete key when timeline focused
    canvas.style.outline = "none";

    playBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePlay();
    });

    delBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        deleteSelectedMarker();
        canvas.focus();
    });

    root.addEventListener("keydown", (e) => {
        if (e.key === "Delete" || e.key === "Backspace") {
            if (state.selectedMarker >= 0) {
                e.preventDefault();
                e.stopPropagation();
                deleteSelectedMarker();
            }
        } else if (e.key === "Escape") {
            clearMarkerSelection();
        }
    });

    zoomInBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        zoomAt(1.5, state.playhead);
        ensurePlayheadVisible();
        draw();
    });
    zoomOutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        zoomAt(1 / 1.5, state.playhead);
        draw();
    });
    zoomFitBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.zoom = 1;
        state.viewStart = 0;
        draw();
    });

    canvas.addEventListener("wheel", (e) => {
        if (state.total_frames <= 0) return;
        e.preventDefault();
        e.stopPropagation();
        const { x } = localXY(e);
        const anchor = frameFromX(x);
        const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25;
        zoomAt(factor, anchor);
    }, { passive: false });

    canvas.addEventListener("pointerdown", (e) => {
        if (state.total_frames <= 0) return;
        // Middle button or Alt+left: pan when zoomed
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            canvas.setPointerCapture(e.pointerId);
            state.drag = { type: "pan", lastX: localXY(e).x };
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (e.button !== 0) return;
        if (state.playing) stopPlayback();
        canvas.setPointerCapture(e.pointerId);
        const { x, y } = localXY(e);

        // Priority: playhead handle > marker handle > scrub playhead on track
        if (hitPlayhead(x, y)) {
            clearMarkerSelection();
            state.drag = { type: "playhead", startX: x, moved: false };
            state.playhead = frameFromX(x);
            syncVideoToPlayhead();
            loadJpegPreview(state.playhead);
        } else {
            const mi = hitMarker(x, y);
            if (mi >= 0) {
                // Select + optionally drag; do not move playhead with marker
                selectMarker(mi);
                state.drag = { type: "marker", index: mi, startX: x, moved: false };
            } else {
                clearMarkerSelection();
                state.drag = { type: "playhead", startX: x, moved: false };
                state.playhead = frameFromX(x);
                syncVideoToPlayhead();
                loadJpegPreview(state.playhead);
            }
        }
        canvas.focus();
        draw();
        e.preventDefault();
        e.stopPropagation();
    });

    canvas.addEventListener("pointermove", (e) => {
        const { x, y } = localXY(e);
        if (!state.drag) {
            if (hitPlayhead(x, y)) canvas.style.cursor = "ew-resize";
            else if (hitMarker(x, y) >= 0) canvas.style.cursor = "pointer";
            else if (state.zoom > 1) canvas.style.cursor = "grab";
            else canvas.style.cursor = "pointer";
            return;
        }
        if (state.drag.type === "pan") {
            const dx = x - state.drag.lastX;
            state.drag.lastX = x;
            const span = visibleSpan();
            const w = logicalWidth();
            panByFrames(-(dx / w) * span);
            return;
        }
        if (Math.abs(x - (state.drag.startX || x)) > 2) {
            state.drag.moved = true;
        }
        const frame = frameFromX(x);
        if (state.drag.type === "marker") {
            const idx = state.drag.index;
            if (idx < 0 || idx >= state.points.length) return;
            const { lo, hi } = markerClampRange(idx);
            // Clamp between neighbors — never cross other splits; keep index stable
            state.points[idx] = Math.max(lo, Math.min(hi, frame));
            state.selectedMarker = idx;
            writeSplitPoints();
        } else if (state.drag.type === "playhead") {
            state.playhead = frame;
            // Auto-pan when scrubbing near edges while zoomed
            if (state.zoom > 1) {
                const span = visibleSpan();
                const margin = Math.max(1, span * 0.08);
                if (state.playhead < state.viewStart + margin) {
                    state.viewStart = state.playhead - margin;
                    clampView();
                } else if (state.playhead > state.viewStart + span - margin) {
                    state.viewStart = state.playhead - span + margin;
                    clampView();
                }
            }
            syncVideoToPlayhead();
            loadJpegPreview(state.playhead);
        }
        draw();
        e.preventDefault();
        e.stopPropagation();
    });

    const endDrag = (e) => {
        if (!state.drag) return;
        if (state.drag.type === "marker") {
            const kept = state.points[state.drag.index];
            normalizePoints();
            const newIdx = state.points.indexOf(kept);
            state.selectedMarker = newIdx >= 0 ? newIdx : -1;
            writeSplitPoints();
        } else if (state.drag.type === "playhead") {
            loadJpegPreview(state.playhead, true);
        }
        state.drag = null;
        if (e?.pointerId != null) {
            try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        }
        draw();
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    canvas.addEventListener("dblclick", (e) => {
        if (state.total_frames <= 0) return;
        e.preventDefault();
        e.stopPropagation();
        addCutAt(frameFromX(localX(e)));
    });

    canvas.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const { x, y } = localXY(e);
        const mi = hitMarker(x, y);
        const items = [
            {
                label: "Split at playhead",
                action: () => addCutAt(state.playhead),
            },
            null,
            {
                label: "Auto scene split",
                submenu: [
                    { label: "Low", action: () => detectScenes("low") },
                    { label: "Medium", action: () => detectScenes("medium") },
                    { label: "High", action: () => detectScenes("high") },
                ],
            },
            {
                label: "Split by fixed duration",
                action: () => {
                    const raw = prompt("Split every N seconds:", "5");
                    if (raw == null) return;
                    const sec = Number(raw);
                    if (!(sec > 0)) {
                        alert("Enter a positive number of seconds");
                        return;
                    }
                    detectInterval(sec);
                },
            },
            { label: "Clear all splits", action: () => clearCuts() },
        ];
        if (mi >= 0) {
            items.push(null);
            items.push({
                label: `Select and delete #${mi + 1}`,
                action: () => {
                    selectMarker(mi);
                    deleteMarkerAt(mi);
                },
            });
            items.push({
                label: `Select cut #${mi + 1}`,
                action: () => selectMarker(mi),
            });
        }
        showContextMenu(e, items);
    });

    for (const el of [root, canvas, previewWrap, controls, playBtn, zoomInBtn, zoomOutBtn, zoomFitBtn, delBtn]) {
        el.addEventListener("pointerdown", (e) => e.stopPropagation());
        el.addEventListener("mousedown", (e) => e.stopPropagation());
    }

    const resizeObs = typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => draw())
        : null;
    resizeObs?.observe(root);

    chainCallback(node, "onConnectionsChange", function () {
        updateNote();
    });

    return {
        root,
        draw,
        loadVideo,
        readSplitPoints,
        refreshFromWidgets() {
            readSplitPoints();
            const vf = videoWidget()?.value;
            loadVideo(vf);
        },
        dispose() {
            state.playing = false;
            if (state.raf) cancelAnimationFrame(state.raf);
            clearTimeout(state.previewTimer);
            resizeObs?.disconnect();
            clearFrameCache();
            if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);
            video.removeAttribute("src");
            closeMenus();
        },
    };
}

app.registerExtension({
    name: "comfyui.videoshotcut",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== "VideoShotCut") return;

        chainCallback(nodeType.prototype, "onNodeCreated", function () {
            const node = this;
            hideWidget(findWidget(node, "split_points"));
            suppressBuiltinVideoPreview(node);

            const ui = createTimelineUI(node);
            node._videoshotcut = ui;

            // Height via options so DomWidgetImpl keeps minWidth:0 (full node width).
            // Do NOT set minWidth — that was pinning the preview to a narrow left column.
            ui.root.style.setProperty("--comfy-widget-min-height", `${WIDGET_H}px`);
            ui.root.style.setProperty("--comfy-widget-height", `${WIDGET_H}px`);
            const domWidget = node.addDOMWidget("videoshotcut_timeline", "timeline", ui.root, {
                serialize: false,
                hideOnZoom: false,
                canvasOnly: true,
                getMinHeight: () => WIDGET_H,
                getHeight: () => WIDGET_H,
            });
            domWidget.computeSize = function (width) {
                return [width, WIDGET_H];
            };
            // Always use node width; a stale widget.width shrinks the preview after moves.
            delete domWidget.width;
            chainCallback(node, "onResize", function () {
                delete domWidget.width;
            });

            const vf = findWidget(node, "video_file");
            if (vf) {
                chainCallback(vf, "callback", function (value) {
                    ui.loadVideo(value);
                    suppressBuiltinVideoPreview(node);
                });
            }
            const fpsW = findWidget(node, "fps");
            if (fpsW) {
                chainCallback(fpsW, "callback", function () {
                    // Rebuild timeline at new working fps
                    ui.refreshFromWidgets();
                });
            }

            setTimeout(() => {
                suppressBuiltinVideoPreview(node);
                ui.refreshFromWidgets();
            }, 0);
        });

        chainCallback(nodeType.prototype, "onConfigure", function () {
            const ui = this._videoshotcut;
            if (!ui) return;
            hideWidget(findWidget(this, "split_points"));
            suppressBuiltinVideoPreview(this);
            setTimeout(() => {
                suppressBuiltinVideoPreview(this);
                ui.refreshFromWidgets();
            }, 0);
        });

        chainCallback(nodeType.prototype, "onRemoved", function () {
            this._videoshotcut?.dispose?.();
            this._videoshotcut = null;
        });
    },
});
