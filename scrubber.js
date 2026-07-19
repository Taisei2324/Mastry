/* =============================================================================
 * MASTRY — scrubber.js  ·  Station 2 (scroll-scrub canvas engine)
 * -----------------------------------------------------------------------------
 * Vanilla JS, dependency-free, no build step, works from file:// (images loaded
 * via new Image(), never fetch). Drives an Apple-product-page-style hero: a tall
 * pinned section scrubs through a sequence of rendered frames drawn cover-fit to
 * a <canvas>.
 *
 * Public surface (the ONLY global): window.MastryScrubber
 *   window.MastryScrubber.init({ canvas, manifest, scrollEl,
 *                                onReady, onProgress, onLoadProgress })
 *   window.MastryScrubber.destroy()   // bonus: tears down the active instance
 *
 * See CONTRACT 2 in SPEC.md. The page owns the DOM; the engine only reads
 * geometry (getBoundingClientRect) and paints — it never creates or styles DOM.
 *
 * Internally composed of three parts, kept in one closure so nothing leaks:
 *   §1  canvas helpers   — HiDPI backing-store sizing + cover-fit draw math
 *   §2  frame store      — priority-window preloader / decode manager
 *   §3  core engine      — tier select, scroll→progress→frame, rAF dirty loop,
 *                          reduced-motion branch, wiring + public API
 * ========================================================================== */
(function () {
  'use strict';

  /* ===========================================================================
   * §1  CANVAS HELPERS  —  HiDPI backing-store sizing + cover-fit draw math
   *     Pure/DOM functions, no shared state, safe to call every animation frame.
   * ========================================================================= */

  /* coverRect(imgW, imgH, areaW, areaH) -> { sx, sy, sw, sh, dx, dy, dw, dh }
   * PURE math. CSS `background-size: cover` via the SOURCE-CROP form: dest is
   * always the full area (0,0,areaW,areaH); we crop a centered rectangle out of
   * the SOURCE whose aspect matches the area, so sw/sh === areaW/areaH and there
   * is no squish (a circle stays a circle). Source-crop never paints off-canvas.
   * Rounding: intentionally NOT floored/ceiled — exact floats keep the sampled
   * aspect exact (the whole point of "no squish"); drawImage samples fractional
   * source rects fine and drawCover enables high-quality smoothing. */
  function coverRect(imgW, imgH, areaW, areaH) {
    // Any non-finite/<=0 input -> all-zero rect. drawImage is a silent no-op on a
    // zero source size, so this never throws even if a caller skips the guard.
    if (!isFinite(imgW) || !isFinite(imgH) || !isFinite(areaW) || !isFinite(areaH) ||
        imgW <= 0 || imgH <= 0 || areaW <= 0 || areaH <= 0) {
      return { sx: 0, sy: 0, sw: 0, sh: 0, dx: 0, dy: 0, dw: 0, dh: 0 };
    }

    var imgAspect = imgW / imgH;
    var areaAspect = areaW / areaH;
    var sx, sy, sw, sh;

    if (imgAspect > areaAspect) {
      // Wide image into a relatively tall/narrow area: keep FULL height, crop
      // left/right, center horizontally. sw/sh === areaAspect exactly.
      sh = imgH;
      sw = imgH * areaAspect;
      sy = 0;
      sx = (imgW - sw) / 2;
    } else if (imgAspect < areaAspect) {
      // Tall image into a relatively wide area: keep FULL width, crop top/bottom,
      // center vertically. Mirror of the case above.
      sw = imgW;
      sh = imgW / areaAspect;
      sx = 0;
      sy = (imgH - sh) / 2;
    } else {
      // Aspects match — use the whole image, no crop.
      sx = 0; sy = 0; sw = imgW; sh = imgH;
    }

    return { sx: sx, sy: sy, sw: sw, sh: sh, dx: 0, dy: 0, dw: areaW, dh: areaH };
  }

  /* sizeCanvas(canvas, dprCap) -> { w, h, dpr, cssW, cssH, changed }
   * Sizes the backing store (canvas.width/height, device px) to CSS size × dpr,
   * dpr capped at dprCap (default 2). Only writes width/height when they change —
   * assigning them clears the buffer, an avoidable flash. If the element has zero
   * CSS size (not laid out yet), it does NOT zero the backing store; it returns
   * changed:false so the caller can defer and retry (guard against init-before-layout). */
  function sizeCanvas(canvas, dprCap) {
    var cap = (typeof dprCap === 'number' && isFinite(dprCap) && dprCap > 0) ? dprCap : 2;

    var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
    var cssW = (rect && rect.width) ? rect.width : (canvas.clientWidth || 0);
    var cssH = (rect && rect.height) ? rect.height : (canvas.clientHeight || 0);

    var dpr = Math.min(window.devicePixelRatio || 1, cap);
    if (!isFinite(dpr) || dpr < 1) dpr = 1;

    if (cssW <= 0 || cssH <= 0) {
      // Not laid out yet — report current dims, don't destroy the buffer.
      return { w: canvas.width, h: canvas.height, dpr: dpr, cssW: cssW, cssH: cssH, changed: false };
    }

    var w = Math.round(cssW * dpr);
    var h = Math.round(cssH * dpr);

    var changed = false;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      changed = true;
    }
    return { w: w, h: h, dpr: dpr, cssW: cssW, cssH: cssH, changed: changed };
  }

  /* drawCover(ctx, img, targetW, targetH) -> boolean
   * Paints img cover-fit into a backing store of targetW×targetH DEVICE px
   * (pass canvas.width/height, not CSS size — we draw in device space, no scale).
   * Never clears: cover-fit paints every pixel, so a pre-clear is redundant and
   * would flash blank between an old frame and a not-yet-ready new one. If the
   * image is missing/undecoded or the target is degenerate, returns false and
   * touches nothing — the previous frame stays on screen (no white flash). */
  function drawCover(ctx, img, targetW, targetH) {
    if (!ctx || !img) return false;

    // naturalWidth/Height is 0 until an <img> has decoded (or on error); fall
    // back to width/height for ImageBitmap/canvas-like sources.
    var natW = img.naturalWidth || img.width || 0;
    var natH = img.naturalHeight || img.height || 0;
    if (natW <= 0 || natH <= 0) return false;
    if (!isFinite(targetW) || !isFinite(targetH) || targetW <= 0 || targetH <= 0) return false;

    var r = coverRect(natW, natH, targetW, targetH);
    if (r.sw <= 0 || r.sh <= 0 || r.dw <= 0 || r.dh <= 0) return false;

    // Premium downscaling: frames are usually higher-res than their display area.
    ctx.imageSmoothingEnabled = true;
    try { if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high'; } catch (e) { /* unsupported */ }

    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
    return true;
  }


  /* ===========================================================================
   * §2  FRAME STORE  —  priority-window preloader / decode manager
   *     Owns the image cache + scheduling ONLY. One scheduler, one global
   *     concurrency cap. Prefers img.decode() before marking a frame ready.
   * ========================================================================= */

  function createFrameStore(opts) {
    opts = opts || {};

    // ---- config ----
    var base = String(opts.base || '');
    var ext = String(opts.ext || '');
    var pad = opts.pad == null ? 0 : (opts.pad | 0);
    var count = Math.max(0, opts.count | 0);                          // 0 = valid empty store
    var concurrency = Math.min(8, Math.max(1, opts.concurrency == null ? 6 : (opts.concurrency | 0)));
    var windowRadius = Math.max(0, opts.window == null ? 60 : (opts.window | 0));
    var onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    var onReadyFrame = typeof opts.onReadyFrame === 'function' ? opts.onReadyFrame : null;

    var MAX_RETRIES = 2;                                              // total attempts = 1 + 2 retries

    // ---- per-frame state, 1-indexed (index 0 unused; keeps 1-based math clean) ----
    var STATE_IDLE = 0, STATE_LOADING = 1, STATE_READY = 2, STATE_FAILED = 3;
    var state = new Uint8Array(count + 1);                            // ~0.5KB for 505; all IDLE
    var imgs = new Array(count + 1);
    for (var _i = 0; _i <= count; _i++) imgs[_i] = null;

    // ---- scheduler bookkeeping ----
    var inFlightImgs = new Map();                                     // i -> loading Image (for destroy/abort)
    var inFlightCount = 0;                                            // occupied concurrency slots
    var readyCount = 0;                                               // cumulative ready == loadedCount()
    var focusCenter = count > 0 ? 1 : 0;                             // priority center, set by focus()
    var destroyed = false;
    var pumpScheduled = false;                                        // microtask coalescing for focus()-spam
    var pinned = new Set();                                           // ensure()'d frames, FIFO top priority
    var ensureResolvers = new Map();                                 // i -> { resolve, reject }
    var ensureCache = new Map();                                     // i -> shared Promise

    function clampFrame(i) { i = i | 0; return i < 1 ? 1 : (i > count ? count : i); }
    function frameUrl(i) { return base + String(i).padStart(pad, '0') + '.' + ext; }

    // Coalesce bursts of focus()/ensure() into one pump per microtask tick.
    function schedulePump() {
      if (destroyed || pumpScheduled) return;
      pumpScheduled = true;
      Promise.resolve().then(function () { pumpScheduled = false; pump(); });
    }

    // Fill every free slot with the next-highest-priority idle frame.
    function pump() {
      if (destroyed) return;
      while (inFlightCount < concurrency) {
        var next = pickNext();
        if (next === 0) break;
        startLoad(next);
      }
    }

    // Priority: (1) pinned/ensure()'d frames, FIFO; (2) within ±windowRadius of
    // focusCenter, filling outward; (3) everything else outward (background fill,
    // so the whole sequence eventually loads for smooth seeking anywhere).
    function pickNext() {
      if (count <= 0) return 0;

      for (var pi of pinned) {
        if (state[pi] === STATE_IDLE) return pi;
      }

      var c = focusCenter, lo = 1, hi = count;

      for (var off = 0; off <= windowRadius; off++) {
        var a = c + off;
        if (a <= hi && state[a] === STATE_IDLE) return a;
        if (off > 0) {
          var b = c - off;
          if (b >= lo && state[b] === STATE_IDLE) return b;
        }
      }

      var maxOff = Math.max(c - lo, hi - c);
      for (var off2 = windowRadius + 1; off2 <= maxOff; off2++) {
        var a2 = c + off2;
        if (a2 <= hi && state[a2] === STATE_IDLE) return a2;
        var b2 = c - off2;
        if (b2 >= lo && state[b2] === STATE_IDLE) return b2;
      }
      return 0;                                                       // fully scheduled
    }

    function startLoad(i) {
      state[i] = STATE_LOADING;
      inFlightCount++;                                                // the ONE place a slot is claimed
      attemptLoad(i, 0);
    }

    // Retries reuse the same concurrency slot (inFlightCount only moves in
    // startLoad and the two terminal outcomes), so the cap is a hard ceiling.
    function attemptLoad(i, attempt) {
      if (destroyed) return;

      var img = new Image();
      img.decoding = 'async';
      inFlightImgs.set(i, img);

      img.onerror = function () {
        img.onload = img.onerror = null;
        inFlightImgs.delete(i);
        if (attempt < MAX_RETRIES) attemptLoad(i, attempt + 1);
        else failLoad(i);
      };

      img.onload = function () {
        // Bytes in — prefer a full decode() before "ready" so the first draw
        // never pays decode cost on the main thread (no jank, no white flash).
        // decode() may reject for some browsers/formats; per spec that is NOT a
        // failure — onload already proves the image is usable, so we fall through
        // to ready whether decode() resolves or rejects.
        if (typeof img.decode === 'function') img.decode().then(onDecodeSettled, onDecodeSettled);
        else onDecodeSettled();
      };

      function onDecodeSettled() {
        img.onload = img.onerror = null;
        inFlightImgs.delete(i);
        finishLoad(i, img);
      }

      img.src = frameUrl(i);
    }

    function finishLoad(i, img) {
      if (destroyed) return;
      state[i] = STATE_READY;
      imgs[i] = img;
      inFlightCount--;
      readyCount++;
      pinned.delete(i);

      if (onReadyFrame) onReadyFrame(i);
      if (onProgress) onProgress(readyCount, count);                 // once per frame, monotonic

      settleEnsure(i, null, img);
      schedulePump();                                                 // a slot freed — keep the pipe full
    }

    function failLoad(i) {
      if (destroyed) return;
      state[i] = STATE_FAILED;                                        // terminal: pickNext never picks it -> no deadlock
      inFlightCount--;
      pinned.delete(i);
      settleEnsure(i, new Error('frame ' + i + ' failed: ' + frameUrl(i)), null);
      schedulePump();
    }

    function settleEnsure(i, err, img) {
      var r = ensureResolvers.get(i);
      if (!r) return;
      ensureResolvers.delete(i);
      ensureCache.delete(i);
      if (err) r.reject(err); else r.resolve(img);
    }

    // ---- public store API ----
    function get(i) {
      if (destroyed || count <= 0) return null;
      i = clampFrame(i);
      return state[i] === STATE_READY ? imgs[i] : null;
    }
    function isReady(i) {
      if (destroyed || count <= 0) return false;
      i = clampFrame(i);
      return state[i] === STATE_READY;
    }
    // Bounded outward scan for the nearest ready frame — used to avoid white
    // flashes when the exact target isn't decoded yet. Cheap once the window
    // around i has filled (the common scroll-scrub case).
    function nearestReady(i) {
      if (destroyed || count <= 0) return null;
      i = clampFrame(i);
      if (state[i] === STATE_READY) return imgs[i];
      var maxOff = Math.max(i - 1, count - i);
      for (var off = 1; off <= maxOff; off++) {
        var a = i + off;
        if (a <= count && state[a] === STATE_READY) return imgs[a];
        var b = i - off;
        if (b >= 1 && state[b] === STATE_READY) return imgs[b];
      }
      return null;
    }
    // Called every scroll/rAF tick — deliberately cheap (clamp + int write +
    // coalesced pump). No allocation, no scan.
    function focus(i) {
      if (destroyed || count <= 0) return;
      focusCenter = clampFrame(i);
      schedulePump();
    }
    // Promise<Image> resolving when frame i is decoded. Jumps the queue (top
    // priority) but still obeys the global concurrency cap. Shared per index.
    function ensure(i) {
      if (destroyed) return Promise.reject(new Error('FrameStore: destroyed'));
      if (count <= 0) return Promise.reject(new Error('FrameStore: empty'));
      i = clampFrame(i);
      if (state[i] === STATE_READY) return Promise.resolve(imgs[i]);
      if (state[i] === STATE_FAILED) return Promise.reject(new Error('frame ' + i + ' failed'));
      var cached = ensureCache.get(i);
      if (cached) return cached;
      var p = new Promise(function (resolve, reject) { ensureResolvers.set(i, { resolve: resolve, reject: reject }); });
      ensureCache.set(i, p);
      pinned.add(i);
      schedulePump();
      return p;
    }
    function loadedCount() { return readyCount; }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      inFlightImgs.forEach(function (img) { img.onload = null; img.onerror = null; img.src = ''; }); // best-effort abort
      inFlightImgs.clear();
      pinned.clear();
      ensureResolvers.forEach(function (r) { r.reject(new Error('FrameStore: destroyed')); });
      ensureResolvers.clear();
      ensureCache.clear();
      for (var i = 0; i <= count; i++) imgs[i] = null;
      state.fill(STATE_IDLE);
      inFlightCount = 0;
      readyCount = 0;
      pumpScheduled = false;
    }

    return {
      total: count,
      get: get, isReady: isReady, nearestReady: nearestReady,
      focus: focus, ensure: ensure, loadedCount: loadedCount, destroy: destroy
    };
  }


  /* ===========================================================================
   * §3  CORE ENGINE  —  tier select, scroll→progress→frame, rAF dirty loop,
   *                     reduced-motion branch, wiring, public API
   * ========================================================================= */

  var win = window;
  var DPR_CAP = 2;
  var SCROLL_OPTS = { passive: true };                                // reused ref for add/removeEventListener
  var RO = (typeof win.ResizeObserver === 'function') ? win.ResizeObserver : null;

  function noop() {}
  // Host callbacks are wrapped so a throw in page code can never break the engine.
  function safeCall(fn) {
    if (typeof fn !== 'function') return;
    try { fn.apply(null, Array.prototype.slice.call(arguments, 1)); } catch (e) { /* swallow */ }
  }
  function mmMatches(q) {
    try { return !!(win.matchMedia && win.matchMedia(q).matches); } catch (e) { return false; }
  }
  function nonEmptyStr(s) { return typeof s === 'string' && s.length > 0; }

  var activeInstance = null;                                          // only one engine at a time

  function init(opts) {
    opts = opts || {};
    destroy();                                                        // clean re-init: tear down any prior instance

    var canvas = opts.canvas;
    var manifest = opts.manifest;
    var scrollEl = opts.scrollEl;
    var onReady = opts.onReady;
    var onProgress = opts.onProgress;
    var onLoadProgress = opts.onLoadProgress;

    // Hard guards — if we can't possibly run, still let the page proceed.
    if (!canvas || !canvas.getContext || !manifest) { safeCall(onReady); return; }
    var ctx = canvas.getContext('2d');
    if (!ctx) { safeCall(onReady); return; }

    var count = Math.max(0, manifest.count | 0);
    var ext = nonEmptyStr(manifest.ext) ? manifest.ext : 'webp';
    var pad = manifest.pad == null ? 4 : (manifest.pad | 0);

    // No frames at all: nothing to render, but don't hang the page.
    if (count <= 0) { safeCall(onLoadProgress, 0, 0); safeCall(onReady); return; }

    // ---- environment / mode ----
    var reduced = mmMatches('(prefers-reduced-motion: reduce)');
    var noScroll = !scrollEl || !scrollEl.getBoundingClientRect;      // can't scrub without a driver
    var still = reduced || noScroll;                                  // "paint one representative frame" mode

    // ---- tier selection (mobile vs desktop) ----
    // Prefer mobile only if the manifest declares a mobile tier AND the viewport
    // is small. If the mobile dir/frames turn out to be missing at load time we
    // fall back to desktop (handled in the load callbacks below).
    var hasMobile = nonEmptyStr(manifest.baseM);
    var hasDesktop = nonEmptyStr(manifest.base);
    var smallViewport = mmMatches('(max-width:760px)') || (win.innerWidth || 9999) <= 760;
    var tier = (hasMobile && smallViewport) ? 'mobile' : 'desktop';
    function baseFor(t) { return t === 'mobile' ? String(manifest.baseM || '') : String(manifest.base || ''); }
    function frameUrl(t, i) { return baseFor(t) + String(i).padStart(pad, '0') + '.' + ext; }
    function canFallback(t) { return t === 'mobile' && hasDesktop; }

    // ---- instance handle ----
    var inst = { destroyed: false, teardown: noop };
    activeInstance = inst;

    // ---- shared render state ----
    var store = null;
    var ctxCanvas = canvas;
    var readyFired = false;
    var triedFallback = false;
    var shownImg = null;                                             // Image currently on canvas (dedupe + resize redraw)
    var ro = null;

    function fireReady() { if (readyFired || inst.destroyed) return; readyFired = true; safeCall(onReady); }

    /* ---------------- reduced-motion / no-scroll: single still frame ----------------
     * Representative frame = the last frame (count) — the bottle at rest on the
     * Greek limestone ledge, i.e. the finished product. Loaded directly (no store,
     * so we never download all 505 for a static hero). Redraws on resize so it
     * stays cover-fit correct through rotation, but binds NO scroll scrubbing. */
    function startStill(t) {
      var rep = count;                                                // ~last Greek frame
      safeCall(onLoadProgress, 0, 1);
      loadOne(frameUrl(t, rep)).then(function (img) {
        if (inst.destroyed) return;
        shownImg = img;
        paintStill();
        safeCall(onLoadProgress, 1, 1);
        safeCall(onProgress, 1, rep);                                 // onProgress may be called once
        fireReady();
      }, function () {
        if (inst.destroyed) return;
        if (canFallback(t) && !triedFallback) { triedFallback = true; startStill('desktop'); return; }
        fireReady();                                                  // couldn't load; still let the page proceed
      });
    }
    function paintStill() {
      if (inst.destroyed || !shownImg) return;
      sizeCanvas(ctxCanvas, DPR_CAP);                                 // (re)size backing store, then repaint in-frame
      drawCover(ctx, shownImg, ctxCanvas.width, ctxCanvas.height);
    }

    // Tiny standalone loader for the still path (decode-before-ready, file://-safe).
    function loadOne(url) {
      return new Promise(function (resolve, reject) {
        var im = new Image();
        im.decoding = 'async';
        im.onload = function () {
          if (typeof im.decode === 'function') im.decode().then(function () { resolve(im); }, function () { resolve(im); });
          else resolve(im);
        };
        im.onerror = function () { reject(new Error('load failed: ' + url)); };
        im.src = url;
      });
    }

    /* ---------------- normal scrubbing path ---------------- */

    // rAF dirty-flag loop state
    var dirty = true;                                                 // force first paint
    var rafPending = false;
    var rafId = 0;
    var needResize = true;                                            // force first sizing
    var renderedFrame = -1;                                          // exact frame currently painted (-1 = none)
    var lastReportedFrame = -1, lastReportedP = -1;
    var layoutRetries = 0;

    // progress: p=0 when scrollEl top hits viewport top, p=1 when its bottom hits
    // viewport bottom (progress through the pinned region). Clamped; div-by-zero safe.
    function computeProgress() {
      var rect = scrollEl.getBoundingClientRect();
      var vh = win.innerHeight || document.documentElement.clientHeight || 0;
      var travel = rect.height - vh;                                  // scrollable distance while pinned
      if (!(travel > 0)) return 0;                                    // degenerate section -> guard
      var p = (0 - rect.top) / travel;
      return p < 0 ? 0 : (p > 1 ? 1 : p);
    }
    // p -> frame index 1..count with rounding (p=0 -> 1, p=1 -> count).
    function mapFrame(p) {
      if (count <= 1) return 1;
      var f = 1 + Math.round(p * (count - 1));
      return f < 1 ? 1 : (f > count ? count : f);
    }

    function requestTick() {
      if (inst.destroyed) return;
      dirty = true;
      if (!rafPending) { rafPending = true; rafId = win.requestAnimationFrame(onRaf); }
    }

    // One rAF consumes the dirty flag; multiple scroll/resize/decode events between
    // frames collapse into a single redraw. Never draws the same image twice.
    function onRaf() {
      rafPending = false;
      if (inst.destroyed) return;
      if (!dirty && !needResize) return;
      dirty = false;

      if (needResize) {
        var s = sizeCanvas(ctxCanvas, DPR_CAP);
        if (s.cssW <= 0 || s.cssH <= 0) {
          // Not laid out yet (init-before-layout). Retry a bounded number of
          // frames; ResizeObserver/resize will also re-kick us once sized.
          needResize = true;
          if (layoutRetries++ < 240) { rafPending = true; rafId = win.requestAnimationFrame(onRaf); }
          return;
        }
        layoutRetries = 0;
        needResize = false;
        if (s.changed) { shownImg = null; renderedFrame = -1; }       // buffer cleared by resize -> force repaint
      }

      var p = computeProgress();
      var target = mapFrame(p);
      store.focus(target);                                            // steer the preloader window

      var img = store.get(target);
      var exact = !!img;
      if (!img) img = store.nearestReady(target);                     // no white flash: draw nearest decoded

      if (img && (img !== shownImg || (exact && renderedFrame !== target))) {
        if (drawCover(ctx, img, ctxCanvas.width, ctxCanvas.height)) {
          shownImg = img;
          renderedFrame = exact ? target : -1;                        // only "settle" on the exact frame, so a
        }                                                             // later decode upgrades nearest -> exact
      }

      if (target !== lastReportedFrame || p !== lastReportedP) {
        lastReportedFrame = target; lastReportedP = p;
        safeCall(onProgress, p, target);
      }
    }

    function buildStore(t) {
      return createFrameStore({
        base: baseFor(t), ext: ext, pad: pad, count: count,
        concurrency: 6, window: 100,
        onProgress: function (loaded, total) { if (!inst.destroyed) safeCall(onLoadProgress, loaded, total); },
        onReadyFrame: function () { if (!inst.destroyed) requestTick(); } // a frame decoded -> maybe upgrade paint
      });
    }

    function startScrub(t) {
      if (store) { store.destroy(); store = null; }
      store = buildStore(t);
      tier = t;
      var thisStore = store;                                          // guard against stale callbacks after fallback

      // Early paint: load frame 1 first and draw it ASAP.
      store.ensure(1).then(function () {
        if (inst.destroyed || store !== thisStore) return;
        requestTick();
      }, function () {
        if (inst.destroyed || store !== thisStore) return;
        if (canFallback(t) && !triedFallback) { triedFallback = true; startScrub('desktop'); }
        // else frame 1 failed on desktop too — critical settle below still fires onReady
      });

      // Critical set for onReady = frame 1 + a few early frames. Resilient: each
      // ensure is caught so onReady fires even if a frame or two fail to decode.
      var K = Math.min(count, 12);
      var crit = [];
      for (var k = 1; k <= K; k++) crit.push(store.ensure(k).catch(noop));
      Promise.all(crit).then(function () {
        if (inst.destroyed || store !== thisStore) return;            // don't fire ready for a superseded tier
        fireReady();
      });
    }

    /* ---------------- listeners + teardown ---------------- */

    function onScroll() { requestTick(); }
    function onResize() {
      needResize = true;
      if (still) paintStill();                                        // still mode: resize keeps the frame cover-fit
      else requestTick();
    }

    inst.teardown = function () {
      inst.destroyed = true;
      if (rafId) { try { win.cancelAnimationFrame(rafId); } catch (e) {} rafId = 0; }
      win.removeEventListener('scroll', onScroll, SCROLL_OPTS);
      win.removeEventListener('resize', onResize);
      win.removeEventListener('orientationchange', onResize);
      if (ro) { try { ro.disconnect(); } catch (e) {} ro = null; }
      if (store) { try { store.destroy(); } catch (e) {} store = null; }
    };

    // ---- go ----
    win.addEventListener('resize', onResize);
    win.addEventListener('orientationchange', onResize);
    if (RO) { try { ro = new RO(onResize); ro.observe(canvas); } catch (e) { ro = null; } }

    if (still) {
      // Reduced-motion / no-scroll: no scroll binding, no rAF loop — one still frame.
      startStill(tier);
    } else {
      win.addEventListener('scroll', onScroll, SCROLL_OPTS);
      startScrub(tier);
      requestTick();                                                  // kick first sizing + paint attempt
    }
  }

  function destroy() {
    if (activeInstance) { try { activeInstance.teardown(); } catch (e) {} activeInstance = null; }
  }

  // The ONE global. Nothing else leaks from this closure.
  win.MastryScrubber = { init: init, destroy: destroy };
})();
