/* MASTRY — interactions */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── loader ──
     YouTube-style: reveal the hero as soon as its FIRST frames are decoded
     (scrubber onReady, below) and keep buffering the rest in the background — we
     do NOT wait on window 'load' (all 505 frames + every image), which used to
     keep the splash up for seconds. A short minimum keeps the wordmark from
     flashing; a hard cap never traps the visitor. */
  var loader = document.getElementById("loader");
  var loaderDone = false;
  var loaderStart = Date.now();
  /* Set by the scrubber's onReady (below): the hero canvas holds real painted
     frames, so the splash bottle has a live target to fly onto. Stays false on
     the 3.5s zero-frames bail — the handoff then collapses to a plain fade. */
  var engineReady = false;
  /* Long enough to SEE the bottle flip even when the hero buffers instantly.
     Unconditional: reduce-motion (often just Windows "animation effects: off")
     must not skip the splash — it's the pre-buffer stage, not decoration.
     PHONES hold longer on purpose (same device test as the engine's tier pick):
     slower decodes + flakier networks -> more headroom so frames never skip. */
  var phoneLike = (function () {
    try {
      return matchMedia("(pointer: coarse)").matches &&
             Math.min(window.innerWidth || 9999, window.innerHeight || 9999) <= 760;
    } catch (e) { return false; }
  })();
  var MIN_SPLASH = phoneLike ? 4200 : 2400;
  /* PORTRAIT-reel predicate, mirroring the engine's tier pick exactly: a phone
     in any orientation, or a phone-sized portrait viewport — NOT every device.
     Shared by the deep-prefetch tier choice AND the splash→hero fly so both
     resolve to the SAME reel (a mismatch lands the bottle on the wrong crop —
     tier drift between copies of this test has bitten this project before). */
  function isPortraitReel() {
    try {
      return phoneLike ||
             (matchMedia("(max-width:760px)").matches &&
              matchMedia("(orientation: portrait)").matches);
    } catch (e) { return false; }
  }
  /* While the splash is up, ALL scrolling is locked: overflow is clamped via
     html.is-loading (set inline in the page head) and iOS touch scrolling —
     which ignores overflow on the body — is blocked here. Unlocked on reveal. */
  function blockTouch(e) { e.preventDefault(); }
  document.addEventListener("touchmove", blockTouch, { passive: false });
  /* IMPATIENCE — the lock above stops the page moving, but the events still
     fire, which is exactly the signal we want: a visitor rubbing the screen on
     the splash is saying "show me now". A single graze must not count, so a
     gesture only registers as a real scroll attempt when it repeats inside a
     short window, travels, or arrives with real wheel momentum. The flag
     downgrades the splash's ambitions (skip the deep 4K phase, below); it
     never bypasses the base reel — that is the no-skip guarantee. */
  var GESTURES = ["touchstart", "touchmove", "wheel"];
  var gestureHits = 0, lastGestureAt = 0, touchY = null, touchTravel = 0;
  function markImpatient() {
    if (impatient) return;
    impatient = true;
    cancelDeep();                     /* stop probe/sweep bytes the visitor doesn't want to wait for */
    if (deepPhase) dismissLoader();   /* deep phase = base fully cached, so revealing now is safe */
  }
  function onSplashGesture(e) {
    if (loaderDone || impatient) return;
    var now = Date.now();
    if (now - lastGestureAt > 500) gestureHits = 0;
    lastGestureAt = now;
    if (e.type === "touchstart") {
      touchY = e.touches && e.touches[0] ? e.touches[0].clientY : null;
      return;                                   /* a tap is curiosity, not scroll intent */
    }
    if (e.type === "wheel" && Math.abs(e.deltaY || 0) > 30) { markImpatient(); return; }
    if (e.type === "touchmove") {
      var y = e.touches && e.touches[0] ? e.touches[0].clientY : null;
      if (touchY != null && y != null) { touchTravel += Math.abs(y - touchY); touchY = y; }
      if (touchTravel > 24) { markImpatient(); return; }
    }
    if (++gestureHits >= 2) markImpatient();
  }
  GESTURES.forEach(function (t) { window.addEventListener(t, onSplashGesture, { passive: true }); });
  /* Unlock ONLY after the splash has fully faded (owner, 2026-07-24): the
     impatience gesture that triggers a reveal must never carry the page down
     the hero — the visitor lands on frame 1 with the film in front of them.
     Scroll is pinned to the top for the same reason: is-loading keeps scrollY
     at 0, but the reset is cheap insurance against any pre-lock drift. */
  function unlockScroll() {
    try { window.scrollTo(0, 0); } catch (e) {}
    document.documentElement.classList.remove("is-loading");
    document.removeEventListener("touchmove", blockTouch, { passive: false });
    try { if (window.__loaderSpinStop) window.__loaderSpinStop(); } catch (e) {}  /* splash gone — release the spin's rAF */
  }
  var LOADER_FADE = 700;                         /* matches #loader's .7s opacity transition */
  var FAST_FADE   = 400;                         /* impatient exit — quick, fly-less reveal (matches .done--fast) */
  var FLY_DELAY   = 100;                         /* wordmark starts settling, then the bottle launches */
  var FLY_DUR     = 1400;                        /* matches .loader__spinwrap.is-flying transition — a slow glide, not a flash */
  var FADE_AT     = 700;                         /* crossfade starts at 50% of the fly: the page reveals AROUND the moving
                                                    bottle and it docks last onto the already-visible hero — the slow fly
                                                    costs no extra lockout (fade end == fly end) */
  var GLIDE_AFTER = 2300;                        /* auto-glide this long after the fade COMPLETES */
  function dismissLoader() {
    if (loaderDone || !loader) return;
    try { if (/[?&]hold(loader)?\b/.test(location.search)) return; } catch (e) {}  /* ?hold — keep the splash up to inspect it */
    loaderDone = true;
    cancelDeep();                     /* reveal ends the splash's network ambitions (no-op if the sweep finished) */
    GESTURES.forEach(function (t) { window.removeEventListener(t, onSplashGesture, { passive: true }); });
    /* One floor gates the handoff: the MIN_SPLASH minimum. The splash bottle no
       longer has to come to REST before the fly — the canvas spin driver
       (inline in the page head) keeps it turning for the whole wait and is told
       the dock moment at handoff, so it eases out THROUGH the glide and lands
       label-front exactly as it docks. */
    var now = Date.now();
    var wait = Math.max(0, MIN_SPLASH - (now - loaderStart));
    /* Kick the handoff synchronously when the floors have elapsed. A NESTED
       setTimeout here can be starved for seconds behind a heavy frame-load burst
       (the outer timer fires on time, but a freshly-queued macrotask waits) —
       which would keep the splash up long after it should clear. */
    if (wait <= 0) beginHandoff();
    else setTimeout(beginHandoff, wait);
  }

  /* ── splash → hero bottle handoff ──
     The canvas spin driver is still turning when this runs; beginHandoff books
     its ease-out so it rests label-front — the same pose as hero frame 1 — at
     the exact dock moment. The bottle GLIDES right + rescales (1.4s, long-tail
     ease) so head-to-toe it docks EXACTLY on the hero bottle painted on the
     cover-fit canvas beneath; the whole-loader crossfade starts mid-glide and
     completes as it docks. We NEVER animate opacity/filter on the canvas
     itself: it is baked opaque on the paper colour and would draw its rectangle.
     Every abnormal path (impatient visitor, zero-frames engine bail, mid-fly
     resize, unreadable geometry) collapses to the plain fade — the fly is a
     bonus, never a gate. reduced-motion deliberately does NOT skip it: the
     splash spin is unconditional (Windows falsely reports reduce), so the
     handoff is too. */
  var revealed = false;
  var WIND_DOWN = 2000;                          /* visible slow-down: the spin eases to rest LABEL-FRONT over
                                                    this window, then the loader fades. */
  function commitFade(fast) {
    if (revealed) return;                        /* one-way latch: land-timer + abort can race */
    revealed = true;
    window.removeEventListener("resize", abortFly);
    window.removeEventListener("orientationchange", abortFly);
    var wrap = loader.querySelector(".loader__spinwrap");
    if (wrap) wrap.style.willChange = "";        /* flight over — drop the compositor hint */
    var fadeMs = fast ? FAST_FADE : LOADER_FADE;
    var wind   = fast ? 0 : WIND_DOWN;           /* impatient/fast exit skips the overtime and just fades */
    /* Ease the spin down to label-front over the wind-down window (a slow,
       visible deceleration that ALWAYS rests on the front), then fade. */
    try { if (window.__loaderSpinLand) window.__loaderSpinLand(wind || fadeMs); } catch (e) {}
    if (fast) {
      loader.classList.add("done--fast");
      loader.classList.add("done");              /* quick crossfade, no overtime */
    } else {
      /* hold the loader opaque THROUGH the slow-down so the deceleration is seen,
         then run the whole-loader crossfade once the bottle has halted front. */
      setTimeout(function () { loader.classList.add("done"); }, wind);
    }
    /* Unlock + glide re-based to when the fade COMPLETES (after the overtime). */
    setTimeout(unlockScroll, wind + fadeMs);
    setTimeout(startAutoScroll, wind + fadeMs + GLIDE_AFTER);
  }
  function abortFly() { commitFade(false); }     /* mid-fly resize/rotation: target rect is stale — fade NOW, skip the hold */
  function beginHandoff() {
    /* NO FLY (owner 2026-07-25): the splash bottle is PINNED onto the hero
       bottle's on-screen spot from the start (inline placeSpin, same reel
       fractions as computeFlip), so it spins IN PLACE exactly where the hero
       bottle is — it never moves. Dismissal is a straight whole-loader
       crossfade; the spin eases to rest label-front by fade-end. computeFlip /
       abortFly are kept below only as reference (unused). */
    loader.classList.add("is-leaving");          /* vertical LOADING settles out */
    commitFade(!!impatient);
  }
  /* FLIP math, pure reads. Match bottle HEIGHT (uniform scale — never squish)
     and align bottle CENTRE. Rects are read LIVE at dismissal, not cached at
     load: the iOS URL bar can resize the viewport between the two. For
     `translate(T) scale(k)` about the wrapper centre O, a screen point p maps
     to  p' = O + T + k·(p − O)  — solve T so the splash bottle centre lands on
     the hero bottle centre. Returns null on degenerate geometry -> plain fade. */
  function computeFlip(wrap, canvas) {
    var S = wrap.getBoundingClientRect();
    var C = canvas.getBoundingClientRect();
    if (!(S.width > 0 && S.height > 0 && C.width > 0 && C.height > 0)) return null;
    /* Bottle box inside the reel FRAME (measured off the immutable renders —
       re-measure if the reel is ever re-rendered). Reel choice mirrors the
       engine via isPortraitReel(); both landscape tiers share one aspect, both
       portrait tiers share the other, so fractions hold across quality tiers. */
    var reel = isPortraitReel()
      ? { cx: 0.6300, top: 0.3095, bottom: 0.6285, aspect: 608 / 1080 }
      : { cx: 0.5422, top: 0.3095, bottom: 0.6285, aspect: 1920 / 1080 };
    /* cover-fit: the frame scales until it covers the canvas — one axis exact,
       the other cropped and centred. Only the frame's ASPECT matters. */
    var areaAspect = C.width / C.height, sfW, sfH, offX, offY;
    if (reel.aspect >= areaAspect) { sfH = C.height; sfW = sfH * reel.aspect; offY = 0; offX = (C.width - sfW) / 2; }
    else                           { sfW = C.width;  sfH = sfW / reel.aspect; offX = 0; offY = (C.height - sfH) / 2; }
    var tgtCX = C.left + offX + reel.cx * sfW;
    var tgtCY = C.top  + offY + ((reel.top + reel.bottom) / 2) * sfH;
    var tgtH  = (reel.bottom - reel.top) * sfH;
    /* Bottle box inside the 2:3 splash img — per theme (the two bakes frame
       the bottle slightly differently). */
    var light = (document.documentElement.getAttribute("data-theme") || "dark") === "light";
    var box = light ? { cx: 0.504, top: 0.099, bottom: 0.917 }
                    : { cx: 0.504, top: 0.109, bottom: 0.906 };
    var srcCX = S.left + box.cx * S.width;
    var srcCY = S.top  + ((box.top + box.bottom) / 2) * S.height;
    var srcH  = (box.bottom - box.top) * S.height;
    if (!(srcH > 0 && tgtH > 0)) return null;
    var k = tgtH / srcH;
    var Ox = S.left + S.width / 2, Oy = S.top + S.height / 2;
    return { k: k, tx: tgtCX - Ox - k * (srcCX - Ox), ty: tgtCY - Oy - k * (srcCY - Oy) };
  }
  /* SCROLL cue: hides once the journey starts moving (visitor scroll or the
     auto-glide — both move scrollY past the threshold). */
  (function () {
    function onFirstMove() {
      if ((window.scrollY || window.pageYOffset || 0) > 40) {
        document.body.classList.add("cine-moving");
        window.removeEventListener("scroll", onFirstMove);
      }
    }
    window.addEventListener("scroll", onFirstMove, { passive: true });
  })();
  /* DELIBERATE pre-buffer gate: the splash's job is to load frames AHEAD so the
     hero never lags or skips. Hold until a deep buffer is decoded:
       - TARGET_FRAMES reached (desktop streams the whole reel after ready), or
       - the stream goes quiet with a healthy buffer (a phone tier only
         schedules ~56 frames around the playhead — once that window is full
         nothing more arrives while parked, so waiting longer buys nothing), or
       - a hard cap so nobody is ever trapped, or
       - ZERO frames by 3.5s (engine broken / frames 404) -> reveal the page. */
  var framesSeen = 0;
  var TARGET_FRAMES = 160;                       /* fallback gate for ancient browsers without fetch() */
  /* POLICY (owner, 2026-07-23 — reverses the earlier no-cap doctrine): nobody
     waits more than 10s on the splash, period. Load-driven INSIDE that
     ceiling: the gate still prefers to reveal on a fully-cached base reel,
     and only the ceiling can cut a slow link short — the engine's
     nearestReady covers any gap and the prefetch keeps running after reveal
     (the auto-glide's 10-18s tail absorbs the rest).
     STALL_MS removed: HARD_CAP 10s dominates — see 2026-07-23 policy reversal. */
  var HARD_CAP = 10000;

  /* DEEP PREFETCH, ALL DEVICES — the engine schedules frames near the
     playhead (on phones a deliberate decoded-RAM guard of ~56 frames), so a
     fast scroll used to outrun the network mid-reel and fall back to the
     nearest loaded frame: visible skipping. Instead the splash DOWNLOADS the
     ENTIRE reel into the HTTP cache — bytes on disk, zero decode RAM — and
     the gate below waits until every frame is on the device. Scrubbing then
     never touches the network anywhere in the film: decode-from-cache is
     fast, so NO skipped frames, start to finish, at any scroll speed.
     Tier choice mirrors the engine (portrait dir on phones). 1080p FLOOR
     (owner, 2026-07-24): the 720 tiers are retired — the manifests carry no
     baseLow/basePLow, so the low branches below resolve to the 1080p reel;
     `slow` now only vetoes the 4K phase, never lowers the base. */
  var PREFETCH_N = Infinity;                     /* full reel — all of m.count */
  var prefetched = 0;
  var prefetchTotal = 0;

  /* DEEP 4K PHASE (mobile page only — the manifest must carry baseHi) — the
     connection's REAL speed decides what the splash buys: the base reel is
     always the floor (reveal never happens before it's fully cached), and a
     measured WiFi/5G-class link on a patient visitor extends the splash to
     download the ENTIRE 4K reel too (bytes into HTTP cache, zero decode RAM),
     so the retina overlay paints from disk and the hero is 4K from frame 1 —
     but ONLY when the whole reel projects to land inside the 10s ceiling.
     Speed is measured against the 4K TIER ITSELF (6 mid-reel probe frames) —
     never against the base download, which the immutable cache makes look
     infinitely fast on every repeat visit. Impatient visitors (scroll attempts
     on the locked splash) skip the 4K phase; if it's already running, they
     reveal instantly — base is on disk, so that's always safe. */
  var impatient = false;
  var deepIntent = null;                         /* null = undecided, then true/false (informational) */
  var deepPhase = false;                         /* sweep running: base done, 4K downloading */
  var deepDeciding = false;                      /* base done, probe still in flight — bounded grace hold */
  var deepGot = 0, deepTotal = 0;
  var cancelDeep = function () {};               /* aborts probe + sweep; rebound below when eligible */

  (function () {
    var m = window.MASTRY_FRAMES;
    if (!m || !(m.count | 0) || typeof fetch !== "function") return;
    var slow = false;
    try {
      var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || "") || c.effectiveType === "3g" ||
                (c.effectiveType === "4g" && c.downlink > 0 && c.downlink < 2))) slow = true;
    } catch (e) {}
    /* portrait tier under the same conditions as the engine — shared with the
       splash→hero fly via isPortraitReel() so both resolve the SAME reel */
    var portrait = isPortraitReel();
    var base = (portrait && m.baseP) ? (slow && m.basePLow ? m.basePLow : m.baseP)
                                     : (slow && m.baseLow ? m.baseLow : m.base);
    if (!base) return;
    prefetchTotal = Math.min(PREFETCH_N, m.count | 0);
    var pad = m.pad == null ? 4 : (m.pad | 0), ext = m.ext || "webp";
    var next = 1, inflight = 0, CONC = 6;
    function frameUrl(dir, i) { var s = String(i); while (s.length < pad) s = "0" + s; return dir + s + "." + ext; }
    function settle() {
      inflight--; prefetched++;
      if (prefetched >= prefetchTotal) onBaseDone();   /* chained off the completing settle — no poll-gap race */
      else pump();
    }
    function pump() {
      while (inflight < CONC && next <= prefetchTotal) {
        inflight++;
        fetch(frameUrl(base, next++), { credentials: "same-origin" })
          .then(function (r) { return r && r.arrayBuffer ? r.arrayBuffer() : null; })  /* drain the body so it lands in cache */
          .then(settle, settle);
      }
    }
    pump();

    /* ---- deep 4K eligibility: phones-only manifest, capable DEVICE, non-slow
       link. The device answer comes from the ENGINE's profile (model class /
       RAM decide the resolution — the connection only decides how much we
       pre-download); read the mirror, never re-derive. ---- */
    var hiDir = m.baseHi ? String(m.baseHi) : "";
    var retina4k = false;
    try {
      retina4k = !!(window.MastryScrubber && window.MastryScrubber.deviceProfile &&
                    window.MastryScrubber.deviceProfile().retina4k);
    } catch (e) {}
    var deepEligible = !!hiDir && retina4k && portrait && !slow;   /* desktop manifest has no baseHi — never enters */
    if (!deepEligible) { deepIntent = false; return; }
    deepTotal = m.count | 0;

    /* Deep entry is BUDGET-driven, not floor-driven: at base-done we know the
       elapsed time t and the probed rate — enter the 4K phase only if the
       whole 118.7Mb reel projects to land inside the 10s ceiling, with a
       utilization haircut (505 tiny files at CONC 6 sustain below a 6-file
       burst rate) and a settle reserve. A fixed Mbps floor double-fails:
       blocks an early finisher a slower link could serve, admits a late one
       that blows the cap. */
    var DEEP_MBITS = 118.7;                      /* mobile-4k/ reel: 14,831,366 B */
    var DEEP_UTIL = 0.75;                        /* probe-to-sustained haircut */
    var DEEP_RESERVE = 0.5;                      /* seconds — decode/settle tail */
    var PROBE_GRACE = 1500;                      /* ms to wait at base-done for a still-flying probe */
    var PROBE_MIN_BYTES = 120000;                /* don't judge a link on a sliver */
    var probeMbps = -1;                          /* -1 = unresolved; Infinity = 4K already cached */
    var probeCtl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var sweepCtl = null;
    var batteryVeto = false;
    try {
      if (navigator.getBattery) navigator.getBattery().then(function (b) {
        if (b && b.level < 0.2 && !b.charging) batteryVeto = true;   /* a dying phone shouldn't buy luxury pixels */
      }, function () {});
    } catch (e) {}

    cancelDeep = function () {
      try { if (probeCtl) probeCtl.abort(); } catch (e) {}
      try { if (sweepCtl) sweepCtl.abort(); } catch (e) {}
    };

    /* ---- probe: 6 mid-reel 4K frames (~176KB), timed as one burst ----
       Mid-reel (250-255) so it never collides with the engine's hiStore, which
       prefetches the OPENING frames at init. A cached 4K reel resolves in a few
       ms (→ instant yes); a live link qualifies on aggregate byte-rate. */
    (function () {
      var ids = [250, 251, 252, 253, 254, 255];
      var t0 = Date.now(), got = 0, done = 0;
      function finish(bytes) {
        got += bytes;
        if (++done < ids.length || probeMbps >= 0) return;
        var secs = (Date.now() - t0) / 1000;
        probeMbps = secs < 0.12 ? Infinity                              /* cached reel — instant yes */
                  : got >= PROBE_MIN_BYTES ? (got * 8 / 1e6) / secs
                  : 0;                                                  /* errors/slivers read as slow */
      }
      ids.forEach(function (i) {
        fetch(frameUrl(hiDir, i), { credentials: "same-origin", signal: probeCtl && probeCtl.signal })
          .then(function (r) { return r && r.arrayBuffer ? r.arrayBuffer() : null; })
          .then(function (buf) { finish(buf ? buf.byteLength : 0); },
                function () { finish(0); });
      });
    })();

    /* ---- base complete: decide the 4K phase (runs synchronously in settle) ----
       Decision = budget math: remaining ceiling minus reserve, floored at 2s
       (below that the upside is marginal — the overlay streams 4K at rest
       regardless; deep is a luxury, never worth risking the ceiling).
       A still-flying probe gets a bounded grace (usually free: a cache-fast
       base lands well inside MIN_SPLASH anyway); still unresolved after the
       grace = slow by demonstration. */
    function onBaseDone() {
      if (probeMbps < 0 && !impatient && !batteryVeto) {
        deepDeciding = true;                     /* gate holds (bounded) while the probe lands */
        var graceEnd = Date.now() + PROBE_GRACE;
        (function waitProbe() {
          if (loaderDone) { deepDeciding = false; return; }
          if (probeMbps < 0 && !impatient && Date.now() < graceEnd &&
              Date.now() - loaderStart < 7500) { setTimeout(waitProbe, 100); return; }
          deepDeciding = false;
          decideDeep();
        })();
        return;
      }
      decideDeep();
    }
    function decideDeep() {
      if (impatient || batteryVeto || probeMbps <= 0) { deepIntent = false; cancelDeep(); return; }
      var t = (Date.now() - loaderStart) / 1000;
      var budget = HARD_CAP / 1000 - t - DEEP_RESERVE;
      if (budget < 2 || probeMbps < DEEP_MBITS / (DEEP_UTIL * budget)) {
        deepIntent = false;                      /* can't land 4K inside the ceiling — reveal on base */
        return;
      }
      deepIntent = true;
      deepPhase = true;
      sweepCtl = (typeof AbortController !== "undefined") ? new AbortController() : null;
      /* the engine's hiStore owns the opening frames (focus(1) kick at init) —
         sweep 16..505 first so the two never race the same URLs, then close 1..15 */
      var order = [], oi;
      for (oi = 16; oi <= deepTotal; oi++) order.push(oi);
      for (oi = 1; oi <= 15; oi++) order.push(oi);
      var k = 0, live = 0;
      function done4k() { live--; deepGot++; pump4k(); }
      function pump4k() {
        if (impatient || loaderDone) return;
        while (live < CONC && k < order.length) {
          live++;
          fetch(frameUrl(hiDir, order[k++]), { credentials: "same-origin", signal: sweepCtl && sweepCtl.signal })
            .then(function (r) { return r && r.arrayBuffer ? r.arrayBuffer() : null; })
            .then(done4k, done4k);
        }
      }
      pump4k();
    }
  })();

  function bufferCheck() {
    if (loaderDone) return;
    var now = Date.now();
    var elapsed = now - loaderStart;
    /* phones: done = whole reel downloaded; desktop: done = 160 decoded ahead */
    var baseDone = prefetchTotal > 0 ? prefetched >= prefetchTotal
                                     : framesSeen >= TARGET_FRAMES;
    if (framesSeen === 0) {
      if (elapsed >= 3500) { dismissLoader(); return; }  /* engine broken/frames 404 — never trap anyone */
    } else if (elapsed >= HARD_CAP) {
      /* the 10s ceiling dominates every phase: reveal with whatever's cached
         (partial base on a crawling link, partial 4K on a lying probe) —
         prefetch keeps running after reveal, nearestReady covers the gaps */
      cancelDeep();
      dismissLoader(); return;
    } else if (deepPhase) {
      /* luxury 4K phase — base is 100% on disk, so both exits reveal safely */
      if (deepGot >= deepTotal || impatient) {
        cancelDeep();
        dismissLoader(); return;
      }
    } else if (deepDeciding) {
      /* base done, probe mid-flight — bounded grace (≤1.5s, onBaseDone owns it) */
    } else if (baseDone) {
      dismissLoader(); return;
    }
    setTimeout(bufferCheck, 300);
  }
  setTimeout(bufferCheck, 1000);

  /* ── cinematic auto-scroll (ice glide) ──
     Once the hero is ready the page GLIDES down through the pinned cinematic on
     its own — one smooth, constant-velocity motion that plays the bottle's
     journey. The first genuine interaction (wheel, touch, drag, or a navigation
     key) UNLOCKS it: the glide releases instantly and the visitor scrolls freely
     from there, and it never re-locks. Honours reduced-motion and won't hijack a
     visitor who has already started scrolling.

     Why this also fixes Safari: driving the scroll on a steady rAF cadence keeps
     the scrub engine's own loop running frame-to-frame, instead of depending on
     Safari's coalesced/deferred wheel + momentum scroll events (the source of the
     stutter). We also neutralise CSS `scroll-behavior:smooth` for the duration,
     which otherwise fights every programmatic scrollTo on Safari and Chrome. */
  var startAutoScroll = function () {};         /* no-op unless enabled just below */
  (function () {
    if (reduceMotion) return;                   /* auto-motion: honour the OS setting */
    var cineEl = document.getElementById("cine");
    if (!cineEl) return;

    var running = false, unlocked = false, rafId = 0, t0 = 0, fromY = 0, toY = 0, dur = 0;
    var rootEl = document.documentElement;
    var prevBehavior = "";

    /* ice glide: short ease-in, long CONSTANT-velocity cruise, short ease-out — a
       trapezoidal speed profile (no fast middle), so the motion reads frictionless. */
    function iceEase(t) {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      var R = 0.16;                             /* ramp fraction at each end */
      var cruise = 1 - 2 * R;
      var v = 1 / (cruise + R);                 /* cruise speed, area-normalised to 1 */
      if (t < R) return v * (t * t) / (2 * R);
      if (t < R + cruise) return v * (R / 2 + (t - R));
      var td = t - R - cruise;
      return v * (R / 2 + cruise + td - (td * td) / (2 * R));
    }

    function restoreBehavior() { rootEl.style.scrollBehavior = prevBehavior; }
    function stop() {
      if (!running) return;
      running = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      restoreBehavior();                        /* hand back CSS smooth for anchor links */
    }
    function unlock() {                          /* the visitor took over — release for good */
      if (unlocked) return;
      unlocked = true;
      stop();
      EVENTS.forEach(function (type) { window.removeEventListener(type, onIntent, INTENT_OPTS); });
    }
    function tick(now) {
      if (!running) return;
      var p = dur > 0 ? Math.min((now - t0) / dur, 1) : 1;
      var y = fromY + (toY - fromY) * iceEase(p);
      try { window.scrollTo({ top: y, left: 0, behavior: "auto" }); }
      catch (e) { window.scrollTo(0, y); }      /* older Safari: object form unsupported */
      if (p < 1) rafId = requestAnimationFrame(tick);
      else stop();                              /* reached the end of the hero — hand off */
    }

    startAutoScroll = function () {
      if (unlocked || running) return;
      if ((window.scrollY || window.pageYOffset || 0) > 4) return;   /* visitor already moved */
      fromY = window.scrollY || window.pageYOffset || 0;
      toY = Math.max(0, cineEl.offsetTop + cineEl.offsetHeight - window.innerHeight);
      var dist = toY - fromY;
      if (dist <= 0) return;
      dur = Math.min(18000, Math.max(10000, dist / 0.38));   /* ~10–18s glide, paced to the hero */
      prevBehavior = rootEl.style.scrollBehavior;
      rootEl.style.scrollBehavior = "auto";     /* stop CSS smooth from fighting the glide */
      t0 = performance.now();
      running = true;
      rafId = requestAnimationFrame(tick);
    };

    /* Genuine user-intent events unlock; the glide's own scrollTo does NOT (we
       never listen to 'scroll'). Navigation keys count; typing in a field doesn't. */
    var EVENTS = ["wheel", "touchstart", "touchmove", "pointerdown", "mousedown", "keydown"];
    var INTENT_OPTS = { passive: true };
    var NAV_KEYS = { ArrowDown: 1, ArrowUp: 1, PageDown: 1, PageUp: 1, Home: 1, End: 1, " ": 1, Spacebar: 1 };
    function onIntent(e) {
      if (e.type === "keydown") {
        var tag = (e.target && e.target.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;  /* let forms type */
        if (!NAV_KEYS[e.key]) return;           /* only navigation keys mean "take over" */
      }
      unlock();
    }
    EVENTS.forEach(function (type) { window.addEventListener(type, onIntent, INTENT_OPTS); });
  })();

  /* ── hero: scroll-scrub cinematic (frames.js manifest + scrubber.js engine) ──
     A tall pinned track scrubs 505 rendered frames onto #heroCanvas as you
     scroll. onProgress drives the phase overlays (data-cine) + the marker (--cp).
     The engine handles preloading, HiDPI cover-fit, tiers, and reduced-motion. */
  (function () {
    var cineEl = document.getElementById("cine");
    var canvas = document.getElementById("heroCanvas");
    if (!cineEl || !canvas || !window.MastryScrubber || !window.MASTRY_FRAMES) return;
    var root = document.documentElement;
    window.MastryScrubber.init({
      canvas: canvas, manifest: window.MASTRY_FRAMES, scrollEl: cineEl,
      onReady: function () {
        document.body.classList.add("cine-ready");
        engineReady = true;            /* frame 1 is painted — the splash bottle now has a live fly target */
        /* NOT dismissLoader() — the splash deliberately stays up while the
           buffer deepens (bufferCheck above owns dismissal), so the hero
           starts with frames loaded ahead: no lag, no frame skipping. */
      },
      onProgress: function (p) {                 /* eased progress from the engine */
        if (p < 0) p = 0; else if (p > 1) p = 1;
        root.style.setProperty("--cp", p.toFixed(4));
        /* end card fades in once the bottle has arrived on the ledge (last ~10%) */
        document.body.classList.toggle("cine-end", p >= 0.9);
      },
      onLoadProgress: function (loaded) { framesSeen = loaded; }   /* feeds the pre-buffer gate */
    });
  })();

  /* ── scroll engine: data-speed (parallax Y), data-drift (X scrub), data-rotate ──
     Layout positions are cached (not read per frame) so scrolling stays 60fps. */
  var stage = [];
  function measureStage() {
    stage.forEach(function (s) { s.el.style.transform = ""; });
    var sy = window.scrollY;
    stage.forEach(function (s) {
      var r = s.el.getBoundingClientRect();
      s.top = r.top + sy;
      s.h = r.height;
    });
    choreograph();
  }
  function choreograph() {
    if (!stage.length) return;
    var vh = window.innerHeight;
    var center = window.scrollY + vh / 2;
    stage.forEach(function (s) {
      var mid = s.top + s.h / 2 - center;          /* px from viewport centre */
      var range = vh / 2 + s.h / 2;
      var p = Math.max(-1, Math.min(1, mid / range)); /* -1 entering … 0 centred … 1 leaving */
      var t = "";
      if (s.speed) t += "translateY(" + (mid * s.speed).toFixed(1) + "px) ";
      if (s.drift) t += "translateX(" + (p * s.drift).toFixed(1) + "px) ";
      if (s.rot) t += "rotate(" + (p * s.rot).toFixed(2) + "deg)";
      s.el.style.transform = t;
    });
  }
  if (!reduceMotion) {
    document.querySelectorAll("[data-speed],[data-drift],[data-rotate]").forEach(function (el) {
      stage.push({
        el: el,
        speed: parseFloat(el.dataset.speed) || 0,
        drift: parseFloat(el.dataset.drift) || 0,
        rot: parseFloat(el.dataset.rotate) || 0,
        top: 0, h: 0
      });
    });
    window.addEventListener("resize", measureStage);
    window.addEventListener("load", measureStage);  /* re-measure once images have sized the page */
    measureStage();
  }

  /* ── nav + progress ── */
  var nav = document.getElementById("nav");
  var progress = document.getElementById("progress");
  var cine = document.getElementById("cine");
  var lastY = 0;

  function onScroll() {
    var y = window.scrollY;
    var vh = window.innerHeight;
    /* The cinematic hero is a tall, dark, full-bleed track. Keep the nav
       transparent + light (and always visible) across it; turn it solid — and
       enable hide-on-scroll-down — only once we're past it, in the light content. */
    var heroExit = cine ? cine.offsetHeight - vh * 1.1 : 40;
    nav.classList.toggle("solid", y > heroExit);
    if (!reduceMotion && y > heroExit) {
      if (y > lastY + 2) nav.classList.add("hidden");
      else if (y < lastY - 2) nav.classList.remove("hidden");
    } else {
      nav.classList.remove("hidden");
    }
    var h = document.documentElement.scrollHeight - vh;
    progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    choreograph();
    lastY = y;
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  var burger = document.getElementById("burger");
  var navLinks = document.getElementById("navLinks");
  burger.addEventListener("click", function () {
    var open = navLinks.classList.toggle("open");
    burger.classList.toggle("open", open);
    burger.setAttribute("aria-expanded", open);
  });
  navLinks.addEventListener("click", function (e) {
    if (e.target.tagName === "A") {
      navLinks.classList.remove("open");
      burger.classList.remove("open");
      burger.setAttribute("aria-expanded", "false");
    }
  });

  /* ── scrollspy: mark the nav link for the section in view ── */
  var spyLinks = {};
  document.querySelectorAll('.nav__links a[href^="#"]').forEach(function (a) {
    spyLinks[a.getAttribute("href").slice(1)] = a;
  });
  var spyObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      var link = spyLinks[entry.target.id];
      if (!link) return;
      if (entry.isIntersecting) {
        Object.keys(spyLinks).forEach(function (k) { spyLinks[k].classList.remove("active"); });
        link.classList.add("active");
      }
    });
  }, { rootMargin: "-35% 0px -55% 0px" });
  Object.keys(spyLinks).forEach(function (id) {
    var sec = document.getElementById(id);
    if (sec) spyObserver.observe(sec);
  });

  /* ── scroll reveals ── */
  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
  document.querySelectorAll(".reveal, .reveal--fade").forEach(function (el) { revealObserver.observe(el); });

  /* ── stat counters ── */
  var statObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      statObserver.unobserve(entry.target);
      var el = entry.target;
      var target = parseInt(el.dataset.count, 10);
      if (reduceMotion || target === 0) { el.textContent = target; return; }
      var start = null;
      function step(t) {
        if (!start) start = t;
        var p = Math.min((t - start) / 1200, 1);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    });
  }, { threshold: 0.6 });
  document.querySelectorAll(".stats__num").forEach(function (el) { statObserver.observe(el); });

  /* ── flavour switcher ── */
  var FLAVOURS = {
    original: {
      jp: "マスティック",
      desc: "The unfiltered taste of Chios. Cool resin, white flowers and clean sea air, carried on fine, persistent bubbles.",
      notes: ["mastic resin", "cedar & pine", "sea air"],
      wash: "#F7F4D8", accent: "#91964F", deep: "#596532"          /* mastic-milk / mastic-olive / mastic-deep */
    },
    yuzu: {
      jp: "ゆず・マスティック",
      desc: "Winter citrus from the orchards of Kōchi meets Aegean resin — bright zest up front, a slow honeyed finish.",
      notes: ["yuzu zest", "honeyed citrus", "resin finish"],
      wash: "#FFF9E8", accent: "#C6A548", deep: "#856623"          /* sun-pale / sun-muted / sun-earth */
    },
    ume: {
      jp: "うめ・マスティック",
      desc: "Japanese plum blossom — softly tart, quietly floral. The gentlest bottle in the line, made for before dinner.",
      notes: ["ume plum", "blossom", "soft tartness"],
      wash: "#F6EEE7", accent: "#C3936C", deep: "#714A2E"          /* clay-dust / clay-sun / clay-earth */
    },
    hinoki: {
      jp: "ヒノキ・マスティック",
      desc: "Cypress calm. A walk through a wet forest shrine — green, resinous, and clean all the way down.",
      notes: ["hinoki cypress", "forest floor", "cool resin"],
      wash: "#EEF5EA", accent: "#527748", deep: "#314C2B"          /* forest-milk / forest-pine / forest-bark */
    }
  };

  var root = document.documentElement;
  var tabs = document.querySelectorAll(".flavours__tab");
  var bottles = document.querySelectorAll(".flavours__bottle");
  var fJp = document.getElementById("fJp");
  var fDesc = document.getElementById("fDesc");
  var fNotes = document.getElementById("fNotes");
  var detail = document.getElementById("flavourDetail");

  function selectFlavour(key) {
    var f = FLAVOURS[key];
    if (!f) return;
    root.style.setProperty("--fl-wash", f.wash);
    root.style.setProperty("--fl-accent", f.accent);
    root.style.setProperty("--fl-deep", f.deep);
    tabs.forEach(function (t) {
      var on = t.dataset.flavour === key;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on);
    });
    bottles.forEach(function (b) {
      b.classList.toggle("is-active", b.dataset.flavour === key);
    });
    /* detail panel was stripped for the minimalist layout; guard so tab clicks
       still swap the bottle + tint without touching removed nodes. */
    if (detail && fJp && fDesc && fNotes) {
      detail.style.opacity = 0;
      setTimeout(function () {
        fJp.textContent = f.jp;
        fDesc.textContent = f.desc;
        fNotes.innerHTML = f.notes.map(function (n) { return "<li>" + n + "</li>"; }).join("");
        detail.style.transition = "opacity .5s ease";
        detail.style.opacity = 1;
      }, reduceMotion ? 0 : 180);
    }
  }
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { selectFlavour(t.dataset.flavour); });
  });

  /* (the old hero bubbles canvas was removed — the hero is now the scroll-scrub
     cinematic wired above.) */

  /* ── scenery rotation ── */
  var sceneryFrame = document.getElementById("sceneryFrame");
  if (sceneryFrame) {
    var slides = sceneryFrame.querySelectorAll(".scenery__slide");
    var dotsWrap = document.getElementById("sceneryDots");
    var current = 0;
    var timer = null;
    var HOLD = 2600;

    slides.forEach(function (s, i) {
      var d = document.createElement("button");
      d.setAttribute("role", "tab");
      d.setAttribute("aria-label", "Slide " + (i + 1));
      if (i === 0) d.classList.add("is-active");
      d.addEventListener("click", function () { go(i); restart(); });
      dotsWrap.appendChild(d);
    });
    var dots = dotsWrap.querySelectorAll("button");

    function go(i) {
      current = (i + slides.length) % slides.length;
      slides.forEach(function (s, k) { s.classList.toggle("is-active", k === current); });
      dots.forEach(function (d, k) { d.classList.toggle("is-active", k === current); });
      /* nudge the next image to start fetching before it's shown */
      var next = slides[(current + 1) % slides.length].querySelector("img");
      if (next && next.loading === "lazy") next.loading = "eager";
    }
    function restart() {
      if (timer) clearInterval(timer);
      if (!reduceMotion) timer = setInterval(function () { go(current + 1); }, HOLD);
    }

    /* land on a different scene each page load */
    go(Math.floor(Math.random() * slides.length));
    restart();

    /* once the page is loaded, fetch the remaining slides in the background */
    window.addEventListener("load", function () {
      slides.forEach(function (s) {
        var img = s.querySelector("img");
        if (img.loading === "lazy") img.loading = "eager";
      });
    });

    sceneryFrame.addEventListener("mouseenter", function () { if (timer) clearInterval(timer); });
    sceneryFrame.addEventListener("mouseleave", restart);
    /* don't rotate while off-screen */
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) restart();
      else if (timer) clearInterval(timer);
    }).observe(sceneryFrame);
  }

  /* ── order form (static site — no backend) ──
     Submitting a VALID form opens the order pop-up instead of finishing:
       step 1 "Before you order" — allergen notice + terms, Decline / Accept
               (the ACCEPT click is the recorded acknowledgment — click-wrap;
               deliberately an acknowledgment, NOT a waiver: those are void
               under consumer law);
       step 2 "Your order" — read-back of every field, final Place order.
     Decline / × / backdrop / Esc close the pop-up; the form stays intact. */
  var orderForm = document.getElementById("orderForm");
  if (orderForm) {
    var orderOk = document.getElementById("orderOk");
    var required = orderForm.querySelectorAll("[required]");
    var ordModal = document.getElementById("ordModal");
    var ordmTerms = document.getElementById("ordmTerms");
    var ordmReview = document.getElementById("ordmReview");
    var prevOverflow = "";

    function openOrderModal() {
      if (!ordModal) return;
      /* read-back: the review step shows exactly what was typed */
      var sel = document.getElementById("fproduct");
      document.getElementById("ovFlavour").textContent = sel && sel.selectedIndex > 0 ? sel.options[sel.selectedIndex].text : "";
      document.getElementById("ovQty").textContent = (document.getElementById("fqty") || {}).value || "";
      document.getElementById("ovName").textContent = (document.getElementById("fname") || {}).value || "";
      document.getElementById("ovEmail").textContent = (document.getElementById("femail") || {}).value || "";
      document.getElementById("ovAddress").textContent = (document.getElementById("faddress") || {}).value || "";
      ordmTerms.hidden = false;
      ordmReview.hidden = true;
      ordModal.hidden = false;
      prevOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    function closeOrderModal() {
      if (!ordModal) return;
      ordModal.hidden = true;
      document.body.style.overflow = prevOverflow;
    }
    function placeOrder() {
      closeOrderModal();
      orderForm.querySelectorAll(".fg, .fg-row, .btn, .order__note").forEach(function (el) {
        el.style.display = "none";
      });
      orderOk.hidden = false;
    }

    orderForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var valid = true;
      required.forEach(function (field) {
        var empty = !field.value.trim();
        var bad = field.type === "email" && field.value.indexOf("@") < 1;
        if (empty || bad) {
          valid = false;
          field.style.borderBottomColor = "#9A6B43"; /* clay-brown */
          if (valid === false && field === required[0]) field.focus();
        } else {
          field.style.borderBottomColor = "";
        }
      });
      if (!valid) return;
      if (ordModal) openOrderModal();                /* review before anything is final */
      else placeOrder();                             /* pop-up markup missing — degrade to the old flow */
    });

    if (ordModal) {
      document.getElementById("ordmAccept").addEventListener("click", function () {
        ordmTerms.hidden = true;                     /* acknowledgment given — show the read-back */
        ordmReview.hidden = false;
      });
      document.getElementById("ordmBack").addEventListener("click", function () {
        ordmReview.hidden = true;
        ordmTerms.hidden = false;
      });
      document.getElementById("ordmDecline").addEventListener("click", closeOrderModal);
      document.getElementById("ordmClose").addEventListener("click", closeOrderModal);
      document.getElementById("ordmPlace").addEventListener("click", placeOrder);
      ordModal.addEventListener("click", function (e) { if (e.target === ordModal) closeOrderModal(); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !ordModal.hidden) closeOrderModal(); });
    }
  }

  /* ── language switch (EN / 日本語) ──
     EN is the authored DOM; Japanese lives in the dictionary below. The toggle
     swaps [data-i18n] text, [data-i18n-html] markup, and [data-i18n-ph]
     placeholders — originals are cached on the first pass so switching back to
     EN is lossless. The choice persists (mastry-lang); a first visit follows
     the browser language, so drinkmastry.jp visitors open in Japanese. */
  (function () {
    var JA = {
      "nav.story": "ストーリー",
      "nav.flavours": "フレーバー",
      "nav.order": "注文",
      "nav.merch": "グッズ",
      "nav.find": "ご注文はこちら",
      "stats.sugar": "糖類",
      "stats.calories": "カロリー",
      "stats.ingredients": "原材料",
      "stats.islands": "島",
      /* Certificate of Composition (essence section). Latin lab notation —
         per 100 ml, 0.00% ABV, Pistacia lentiscus, coordinates, units —
         deliberately untranslated (correct in both locales). */
      "cert.resinLine": "H₂O · CO₂ · 樹脂",
      "cert.fig": "図1 — <i>Pistacia lentiscus</i>、ヒオス島",
      "cert.energy": "エネルギー",
      "cert.protein": "たんぱく質",
      "cert.fat": "脂質",
      "cert.carb": "炭水化物",
      "cert.sugars": "うち糖類",
      "cert.salt": "食塩相当量",
      "cert.islandsLine": "ヒオス島 ↔ 日本",
      "cert.abv": "0.00% ABV · カフェインゼロ",
      "cert.note": "「0」表示は食品表示基準（100mlあたり5kcal未満・糖類0.5g未満）に基づきます。",
      "flavours.title": "四つの水、<em>ひとつの樹脂。</em>",
      /* flavour.* deliberately ABSENT: owner call 2026-07-24 — flavour names
         stay in English in Japanese mode (missing key = engine keeps the
         authored EN text) */
      "order.eyebrow": "注文",
      "order.title": "マストリーを<br /><em>ご注文。</em>",
      "order.sub": "ご希望の商品とお届け先をお知らせください。1営業日以内にメールにてご確認いたします。",
      "order.email": "メール",
      "order.origin": "産地",
      "order.originVal": "ギリシャ・ヒオス島 × 日本",
      "order.ships": "発送元",
      "order.shipsVal": "日本 · 3〜5営業日",
      "form.name": "お名前",
      "form.namePh": "例：山田 太郎",
      "form.flavour": "フレーバー",
      "form.select": "選択してください",
      "form.qty": "数量",
      "form.address": "お届け先住所",
      "form.addressPh": "例：東京都〇〇区〇〇1-2-3",
      "form.submit": "注文する",
      "form.note": "世界各国へ配送いたします。ご注文をもって<a href=\"legal.html#terms\">販売条件</a>・<a href=\"care.html#allergens\">アレルゲン情報</a>に同意いただいたものとみなします。",
      "form.ok": "ありがとうございます — ご注文を承りました。hello@mastry.jp より確認メールをお送りします。",
      "footer.tagline": "ギリシャ・ヒオス島のマスティック · 日本にて仕上げ",
      "footer.copyright": "© 2026 Mastry. マスティックのスパークリングウォーター。",
      "footer.care": "カスタマーサポート",
      "footer.legal": "法的情報"
    };
    var toggle = document.getElementById("langToggle");
    if (!toggle) return;                                 /* pages without the switch stay EN */
    var nodes = null;
    function collect() {
      nodes = [];
      document.querySelectorAll("[data-i18n],[data-i18n-html],[data-i18n-ph]").forEach(function (el) {
        if (el.dataset.i18n) nodes.push({ el: el, key: el.dataset.i18n, kind: "text", orig: el.textContent });
        if (el.dataset.i18nHtml) nodes.push({ el: el, key: el.dataset.i18nHtml, kind: "html", orig: el.innerHTML });
        if (el.dataset.i18nPh) nodes.push({ el: el, key: el.dataset.i18nPh, kind: "ph", orig: el.getAttribute("placeholder") || "" });
      });
    }
    var lang = "en";
    function apply(l) {
      if (!nodes) collect();
      nodes.forEach(function (n) {
        var v = l === "ja" ? JA[n.key] : null;
        if (n.kind === "ph") n.el.setAttribute("placeholder", v != null ? v : n.orig);
        else if (n.kind === "html") n.el.innerHTML = v != null ? v : n.orig;
        else n.el.textContent = v != null ? v : n.orig;
      });
      document.documentElement.lang = l === "ja" ? "ja" : "en";
      toggle.querySelectorAll("[data-lang-opt]").forEach(function (s) {
        s.classList.toggle("on", s.dataset.langOpt === l);
      });
      lang = l;
      try { localStorage.setItem("mastry-lang", l); } catch (e) {}
      try { measureStage(); } catch (e) {}               /* text lengths changed — re-measure parallax layout */
    }
    toggle.addEventListener("click", function () { apply(lang === "ja" ? "en" : "ja"); });
    var saved = null;
    try { saved = localStorage.getItem("mastry-lang"); } catch (e) {}
    var initial = (saved === "ja" || saved === "en") ? saved
                : (/^ja\b/i.test(navigator.language || "") ? "ja" : "en");
    if (initial === "ja") apply("ja");
  })();
})();
