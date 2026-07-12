/* MASTRY — interactions */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* phones get a calmer page: no scroll-driven transforms, ambient animation only */
  var calmScroll = reduceMotion || window.matchMedia("(max-width: 760px)").matches;
  /* on desktop the station-snap engine (bottom of this file) is the sole scroll
     authority, so bottle-3d's WALL stands down (they must never both scrollTo) */
  if (!calmScroll) window.__mastrySnapEngine = true;
  if (reduceMotion) {
    document.querySelectorAll("model-viewer[auto-rotate]").forEach(function (mv) {
      mv.removeAttribute("auto-rotate");
    });
  }

  /* ── loader ── */
  var loader = document.getElementById("loader");
  window.addEventListener("load", function () {
    setTimeout(function () { loader.classList.add("done"); }, reduceMotion ? 0 : 900);
  });
  /* safety: never trap the user behind the loader */
  setTimeout(function () { loader.classList.add("done"); }, 3500);

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
      var near = 1 - Math.abs(p);                     /* 0 at edges … 1 dead centre */
      var t = "";
      if (s.tilt) t += "perspective(900px) rotateX(" + (p * s.tilt).toFixed(2) + "deg) ";
      if (s.speed) t += "translateY(" + (mid * s.speed).toFixed(1) + "px) ";
      if (s.drift) t += "translateX(" + (p * s.drift).toFixed(1) + "px) ";
      if (s.zoom) t += "scale(" + (s.zoom + (1 - s.zoom) * near).toFixed(3) + ") ";
      if (s.rot) t += "rotate(" + (p * s.rot).toFixed(2) + "deg)";
      if (t) s.el.style.transform = t;
      if (s.prog) s.el.style.setProperty("--p", Math.min(1, near * 1.6).toFixed(3));
    });
  }
  /* phones get the full scroll choreography except data-rotate (the spinning
     seal read as too busy mid-screen on mobile) */
  var stageSelector = calmScroll
    ? "[data-speed],[data-drift],[data-zoom],[data-tilt],[data-progress]"
    : "[data-speed],[data-drift],[data-rotate],[data-zoom],[data-tilt],[data-progress]";
  if (!reduceMotion) {
    document.querySelectorAll(stageSelector)
      .forEach(function (el) {
        stage.push({
          el: el,
          speed: parseFloat(el.dataset.speed) || 0,
          drift: parseFloat(el.dataset.drift) || 0,
          rot: parseFloat(el.dataset.rotate) || 0,
          zoom: parseFloat(el.dataset.zoom) || 0,
          tilt: parseFloat(el.dataset.tilt) || 0,
          prog: el.hasAttribute("data-progress"),
          top: 0, h: 0
        });
      });
    window.addEventListener("resize", measureStage);
    window.addEventListener("load", measureStage);  /* re-measure once images have sized the page */
    measureStage();
  }

  /* ── nav + hero scroll choreography ── */
  var nav = document.getElementById("nav");
  var progress = document.getElementById("progress");
  var heroBottle = document.getElementById("heroBottle");
  var heroCopy = document.querySelector(".hero__copy");
  var heroVertical = document.querySelector(".hero__vertical");
  var scrollCue = document.querySelector(".hero__scrollcue");
  var lastY = 0;

  function onScroll() {
    var y = window.scrollY;
    var vh = window.innerHeight;
    nav.classList.toggle("solid", y > 40);
    /* hide nav scrolling down, reveal scrolling up */
    if (!reduceMotion) {
      if (y > 480 && y > lastY + 2) nav.classList.add("hidden");
      else if (y < lastY - 2 || y <= 480) nav.classList.remove("hidden");
    }
    var h = document.documentElement.scrollHeight - vh;
    progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    /* pinned hero: the 3D bottle handles its own scroll physics; only the cue fades */
    if (!calmScroll && y < vh) {
      if (scrollCue) scrollCue.style.opacity = Math.max(0, 1 - y / (vh * 0.3)).toFixed(3);
    }
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
  var JA = (document.documentElement.lang || "").indexOf("ja") === 0;
  var FLAVOURS = {
    original: {
      jp: "マスティック",
      desc: "The unfiltered taste of Chios. Cool resin, white flowers and clean sea air, carried on fine, persistent bubbles.",
      notes: ["mastic resin", "cedar & pine", "sea air"],
      descJa: "ヒオスそのままの味わい。冷たい樹脂、白い花、澄んだ潮風 — きめ細かく続く泡にのせて。",
      notesJa: ["マスティック樹脂", "杉と松", "潮風"],
      wash: "#F7F4D8", accent: "#91964F", deep: "#596532"          /* mastic-milk / mastic-olive / mastic-deep */
    },
    yuzu: {
      jp: "ゆず・マスティック",
      desc: "Winter citrus from the orchards of Kōchi meets Aegean resin — bright zest up front, a slow honeyed finish.",
      notes: ["yuzu zest", "honeyed citrus", "resin finish"],
      descJa: "高知の畑の冬柑橘と、エーゲ海の樹脂。はじける皮の香りのあと、蜂蜜のような余韻がゆっくりと。",
      notesJa: ["柚子の皮", "蜂蜜のような柑橘", "樹脂の余韻"],
      wash: "#FFF9E8", accent: "#C6A548", deep: "#856623"          /* sun-pale / sun-muted / sun-earth */
    },
    ume: {
      jp: "うめ・マスティック",
      desc: "Japanese plum blossom — softly tart, quietly floral. The gentlest bottle in the line, made for before dinner.",
      notes: ["ume plum", "blossom", "soft tartness"],
      descJa: "梅の花のように、やわらかな酸味とひかえめな花の香り。食前のための、いちばん穏やかな一本。",
      notesJa: ["梅", "花の香り", "やさしい酸味"],
      wash: "#F6EEE7", accent: "#C3936C", deep: "#714A2E"          /* clay-dust / clay-sun / clay-earth */
    },
    hinoki: {
      jp: "ヒノキ・マスティック",
      desc: "Cypress calm. A walk through a wet forest shrine — green, resinous, and clean all the way down.",
      notes: ["hinoki cypress", "forest floor", "cool resin"],
      descJa: "檜の静けさ。雨上がりの森の参道を歩くように — 緑と樹脂、最後まで清らか。",
      notesJa: ["檜", "森の香り", "冷たい樹脂"],
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

  var currentFlavour = "original"; // matches the is-active markup default
  var bottleTimer = null, bottleTimer2 = null;
  function selectFlavour(key) {
    var f = FLAVOURS[key];
    if (!f || key === currentFlavour) return;
    currentFlavour = key;
    root.style.setProperty("--fl-wash", f.wash);
    root.style.setProperty("--fl-accent", f.accent);
    root.style.setProperty("--fl-deep", f.deep);
    tabs.forEach(function (t) {
      var on = t.dataset.flavour === key;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on);
    });
    /* three-beat swap: evaporate the old bottle upward, hold the stage
       clearly empty, then condense the new bottle down into place */
    clearTimeout(bottleTimer); clearTimeout(bottleTimer2);
    if (reduceMotion) {
      bottles.forEach(function (b) {
        b.classList.remove("is-leaving");
        b.classList.toggle("is-active", b.dataset.flavour === key);
      });
    } else {
      bottles.forEach(function (b) {
        b.classList.toggle("is-leaving", b.classList.contains("is-active"));
        b.classList.remove("is-active");
      });
      bottleTimer = setTimeout(function () {
        bottles.forEach(function (b) { b.classList.remove("is-leaving"); });
      }, 620);
      bottleTimer2 = setTimeout(function () {
        bottles.forEach(function (b) {
          b.classList.toggle("is-active", b.dataset.flavour === key);
        });
      }, 1200);
    }
    detail.style.opacity = 0;
    setTimeout(function () {
      fJp.textContent = f.jp;
      fDesc.textContent = JA ? f.descJa : f.desc;
      fNotes.innerHTML = (JA ? f.notesJa : f.notes).map(function (n) { return "<li>" + n + "</li>"; }).join("");
      detail.style.transition = "opacity .5s ease";
      detail.style.opacity = 1;
    }, reduceMotion ? 0 : 180);
  }
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { selectFlavour(t.dataset.flavour); });
  });

  /* ── hero bubbles ── */
  var canvas = document.getElementById("bubbles");
  if (canvas && !reduceMotion) {
    var ctx = canvas.getContext("2d");
    var bubbles = [];
    var running = true;

    function resize() {
      canvas.width = canvas.offsetWidth * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
    }
    resize();
    window.addEventListener("resize", resize);

    function spawn() {
      var w = canvas.width;
      return {
        x: w * (0.3 + Math.random() * 0.4),
        y: canvas.height + 10,
        r: (1 + Math.random() * 2.6) * devicePixelRatio,
        v: (0.35 + Math.random() * 0.75) * devicePixelRatio,
        drift: (Math.random() - 0.5) * 0.35 * devicePixelRatio,
        a: 0.12 + Math.random() * 0.25
      };
    }
    for (var i = 0; i < 26; i++) {
      var b = spawn();
      b.y = Math.random() * canvas.height;
      bubbles.push(b);
    }

    function tick() {
      if (!running) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "rgba(107,122,50,0.55)"; /* olive-core */
      bubbles.forEach(function (b, idx) {
        b.y -= b.v;
        b.x += b.drift;
        if (b.y < -12) bubbles[idx] = spawn();
        ctx.globalAlpha = b.a;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      requestAnimationFrame(tick);
    }
    tick();

    /* pause when hero is off-screen */
    new IntersectionObserver(function (entries) {
      var visible = entries[0].isIntersecting;
      if (visible && !running) { running = true; tick(); }
      else if (!visible) { running = false; }
    }).observe(canvas);
  }

  /* ── scenery filmstrip: slides horizontally, one frame every 5s, endless loop ── */
  var sceneryFrame = document.getElementById("sceneryFrame");
  if (sceneryFrame) {
    var track = document.getElementById("sceneryTrack");
    var slides = Array.prototype.slice.call(track.children);
    var n = slides.length;
    track.appendChild(slides[0].cloneNode(true));   /* seam for the seamless wrap */
    var dotsWrap = document.getElementById("sceneryDots");
    var current = 0;
    var timer = null;
    var HOLD = 5000;

    slides.forEach(function (s, i) {
      var d = document.createElement("button");
      d.setAttribute("role", "tab");
      d.setAttribute("aria-label", "Slide " + (i + 1));
      if (i === 0) d.classList.add("is-active");
      d.addEventListener("click", function () { snapIfWrapped(); go(i); restart(); });
      dotsWrap.appendChild(d);
    });
    var dots = dotsWrap.querySelectorAll("button");

    function setX(instant) {
      if (instant) track.style.transition = "none";
      track.style.transform = "translateX(" + (-current * 100) + "%)";
      if (instant) { void track.offsetWidth; track.style.transition = ""; }
    }
    function go(i) {
      current = i;
      setX(false);
      var active = current % n;
      dots.forEach(function (d, k) { d.classList.toggle("is-active", k === active); });
      /* nudge the next image to start fetching before it slides in */
      var next = track.children[(current + 1) % track.children.length].querySelector("img");
      if (next && next.loading === "lazy") next.loading = "eager";
    }
    /* after the seam clone slides in, silently reset to the real first slide */
    function snapIfWrapped() {
      if (current >= n) { current = 0; setX(true); }
    }
    track.addEventListener("transitionend", function (e) {
      if (e.target === track && e.propertyName === "transform") snapIfWrapped();
    });
    function restart() {
      if (timer) clearInterval(timer);
      timer = setInterval(function () { snapIfWrapped(); go(current + 1); }, HOLD);
    }

    go(0);
    restart();

    /* once the page is loaded, fetch the remaining slides in the background */
    window.addEventListener("load", function () {
      track.querySelectorAll("img").forEach(function (img) {
        if (img.loading === "lazy") img.loading = "eager";
      });
    });

    sceneryFrame.addEventListener("mouseenter", function () { if (timer) clearInterval(timer); });
    sceneryFrame.addEventListener("mouseleave", restart);
    /* don't advance while off-screen */
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) restart();
      else if (timer) clearInterval(timer);
    }).observe(sceneryFrame);
  }

  /* ── order form (static site — no backend) ── */
  var orderForm = document.getElementById("orderForm");
  if (orderForm) {
    var orderOk = document.getElementById("orderOk");
    var required = orderForm.querySelectorAll("[required]");
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
      orderForm.querySelectorAll(".fg, .fg-row, .btn, .order__note").forEach(function (el) {
        el.style.display = "none";
      });
      orderOk.hidden = false;
    });
  }

  /* ── station-snap engine ───────────────────────────────────────────────────
     One scroll input carries the page in a single smooth flight to the next
     "station": TOP → the cup framed beside "Two ancient islands" → the whisky-
     pour view. The whole 3D rig is a pure function of window.scrollY, so an eased
     scrollTo makes the pour play through cleanly (the engine never touches the
     rig). OFF entirely under calmScroll (mobile / reduced-motion) → pure native
     scroll. Only the three cinematic sections snap; the story downward is free.
     Designed to NEVER trap the reader (watchdog, escape keys, popstate, etc.). */
  if (!calmScroll) (function () {
    var wordsEl = document.querySelector(".herowords");
    var hbEl = document.querySelector(".highball");
    if (!wordsEl || !hbEl) return;

    function vh() { return window.innerHeight; }
    function stTop() { return 0; }
    function stWords() { return wordsEl.offsetTop + 0.62 * wordsEl.offsetHeight - 0.62 * vh(); }
    function stHighball() { return hbEl.offsetTop - 0.80 * vh() + 0.88 * (hbEl.offsetHeight - 0.20 * vh()); }
    var stations = [stTop, stWords, stHighball];
    var LAST = stations.length - 1;
    function zoneEnd() { return hbEl.offsetTop + hbEl.offsetHeight - vh(); }
    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function inZone() { return window.scrollY <= zoneEnd() + 2; }
    function nearest() {
      var y = window.scrollY, bi = 0, bd = Infinity;
      for (var i = 0; i < stations.length; i++) { var d = Math.abs(stations[i]() - y); if (d < bd) { bd = d; bi = i; } }
      return bi;
    }

    var state = "IDLE";            // IDLE | ANIMATING | FREE
    var idx = 0, idxPending = 0, accum = 0;
    var rafId = null, fromY = 0, toY = 0, t0 = 0, dur = 0, flightDir = 0, cooldownUntil = 0;

    if (location.hash && window.scrollY > zoneEnd()) { state = "FREE"; }
    else { state = "IDLE"; idx = nearest(); }

    function cancelFlight() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
    function settleNow() { cancelFlight(); window.scrollTo({ top: Math.round(stations[idxPending]()), behavior: "auto" }); idx = idxPending; state = "IDLE"; }

    function step(now) {
      var el = now - t0, e = ease(clamp(el / dur, 0, 1));
      window.scrollTo({ top: Math.round(fromY + (toY - fromY) * e), behavior: "auto" });
      if (el >= dur || el > dur + 500) {         // done (or watchdog)
        window.scrollTo({ top: Math.round(toY), behavior: "auto" });
        idx = idxPending; state = "IDLE"; cooldownUntil = now + 200; rafId = null;
      } else { rafId = requestAnimationFrame(step); }
    }
    function flyTo(target) {
      if (target < 0 || target > LAST) return;
      cancelFlight();
      fromY = window.scrollY; toY = stations[target]();
      flightDir = target > idx ? 1 : -1;
      dur = clamp(900 + 260 * Math.abs(toY - fromY) / vh(), 900, 2400);
      t0 = performance.now(); idxPending = target; state = "ANIMATING";
      rafId = requestAnimationFrame(step);
    }
    function norm(e) { var d = e.deltaY; if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= vh(); return d; }

    window.addEventListener("wheel", function (e) {
      if (state === "FREE") {                    // native scroll; re-arm once well back in the zone
        if (inZone() && window.scrollY < zoneEnd() - 0.5 * vh()) { state = "IDLE"; idx = nearest(); }
        return;
      }
      if (!inZone()) { state = "FREE"; return; }
      if (state === "ANIMATING") {               // allow an opposite-direction correction after 150ms
        e.preventDefault();
        var dy = norm(e);
        if (Math.abs(e.deltaX) < Math.abs(dy) && (dy > 0 ? 1 : -1) !== flightDir && performance.now() - t0 > 150) {
          flyTo(clamp(idxPending + (dy > 0 ? 1 : -1), 0, LAST));
        }
        return;
      }
      // IDLE, in-zone. A decaying inertial-scroll tail keeps REFRESHING the quiet
      // window, so one physical swipe (even with long momentum) is exactly one flight.
      if (performance.now() < cooldownUntil) { cooldownUntil = performance.now() + 200; e.preventDefault(); return; }
      var d = norm(e);
      if (Math.abs(e.deltaX) >= Math.abs(d)) { e.preventDefault(); return; }
      accum += d;
      if (Math.abs(accum) < 30) { e.preventDefault(); return; }   // still accumulating — hold on-station
      var dir = accum > 0 ? 1 : -1; accum = 0;
      var tgt = idx + dir;
      if (tgt < 0) { e.preventDefault(); return; }               // at top, going up — hold
      if (tgt > LAST) { state = "FREE"; return; }                // at last, going down — release to native (this input scrolls)
      e.preventDefault();
      flyTo(tgt);
    }, { passive: false });

    window.addEventListener("keydown", function (e) {
      var a = document.activeElement, tag = a && a.tagName;
      if (a && (a.isContentEditable || tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON" || a.getAttribute("role") === "tab")) return;
      if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      var k = e.key;
      if (k === "Home" || k === "End") { cancelFlight(); state = "FREE"; return; }  // never hijack; let native jump
      var dir = 0;
      if (k === "ArrowDown" || k === "PageDown" || (k === " " && !e.shiftKey)) dir = 1;
      else if (k === "ArrowUp" || k === "PageUp" || (k === " " && e.shiftKey)) dir = -1;
      else return;
      if (state === "FREE") {
        if (inZone() && window.scrollY < zoneEnd() - 0.5 * vh()) { state = "IDLE"; idx = nearest(); }
        return;
      }
      if (state !== "IDLE") return;
      if (!inZone()) { state = "FREE"; return; }
      if (performance.now() < cooldownUntil) { e.preventDefault(); return; }
      var tgt = idx + dir;
      if (tgt < 0) { e.preventDefault(); return; }
      if (tgt > LAST) { state = "FREE"; return; }
      e.preventDefault();
      flyTo(tgt);
    });

    // ── escape hatches: the reader can ALWAYS get out ──
    function disarm() { cancelFlight(); state = window.scrollY > zoneEnd() ? "FREE" : "IDLE"; idx = nearest(); }
    window.addEventListener("hashchange", disarm);
    window.addEventListener("popstate", disarm);
    document.addEventListener("visibilitychange", function () { if (document.hidden && rafId) settleNow(); });
    window.addEventListener("blur", function () { if (rafId) settleNow(); });
    window.addEventListener("resize", function () { if (state === "ANIMATING") toY = stations[idxPending](); });

    // lightweight debug handle (harmless): lets tooling drive/read the engine
    window.__mastrySnap = { flyTo: flyTo, stations: stations, zoneEnd: zoneEnd, nearest: nearest, get state() { return state; }, get idx() { return idx; } };
  })();
})();
