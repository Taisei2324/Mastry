/* MASTRY — interactions */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* phones get a calmer page: no scroll-driven transforms, ambient animation only */
  var calmScroll = reduceMotion || window.matchMedia("(max-width: 760px)").matches;
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

  /* ── coordinate helper (only with ?coords in the URL) ──────────────────────
     A live slider that moves the cup up/down in real time (sets window.__cupDrop,
     which bottle-3d reads each frame) plus a mouse-Y readout, so the exact cup
     position can be dialled in and read off as a plain pixel number. Invisible to
     normal visitors — it only builds when the URL has ?coords. */
  if (/[?&]coords/.test(location.search)) {
    var cbox = document.createElement("div");
    cbox.style.cssText = "position:fixed;top:14px;left:14px;z-index:99999;background:rgba(20,30,20,.92);color:#fff;font:13px/1.6 ui-monospace,Menlo,monospace;padding:12px 14px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.3);";
    cbox.innerHTML =
      'cup drop: <b id="cdVal">265</b> px' +
      '<br><input id="cdSlider" type="range" min="-150" max="600" value="265" style="width:240px;margin:6px 0">' +
      '<br>glide: <b id="cgVal">190</b> ms &nbsp;(slower = more gradual slide)' +
      '<br><input id="cgSlider" type="range" min="20" max="700" value="190" style="width:240px;margin:6px 0">' +
      '<br>flight speed: <b id="gvVal">2.6</b> px/ms &nbsp;(lower = slower auto-glide)' +
      '<br><input id="gvSlider" type="range" min="1.2" max="5" step="0.1" value="2.6" style="width:240px;margin:6px 0">' +
      '<br><span id="cdMouse" style="opacity:.75">move mouse — read Y</span>';
    document.body.appendChild(cbox);
    var line = document.createElement("div");
    line.style.cssText = "position:fixed;left:0;right:0;height:1px;background:rgba(255,80,80,.8);z-index:99998;pointer-events:none;top:0;";
    document.body.appendChild(line);
    window.__cupDrop = 265;
    window.__cupGlide = 190;
    var sl = cbox.querySelector("#cdSlider"), val = cbox.querySelector("#cdVal"), mo = cbox.querySelector("#cdMouse");
    var gl = cbox.querySelector("#cgSlider"), gval = cbox.querySelector("#cgVal");
    sl.addEventListener("input", function () { window.__cupDrop = +sl.value; val.textContent = sl.value; });
    gl.addEventListener("input", function () { window.__cupGlide = +gl.value; gval.textContent = gl.value; });
    var gv = cbox.querySelector("#gvSlider"), gvv = cbox.querySelector("#gvVal");
    gv.addEventListener("input", function () { window.__glideVel = +gv.value; gvv.textContent = gv.value; });
    document.addEventListener("mousemove", function (e) {
      line.style.top = e.clientY + "px";
      mo.textContent = "mouse Y = " + e.clientY + " px  (" + (e.clientY / window.innerHeight).toFixed(3) + " vh)";
    });
  }

  /* ── station glide: ONE downward action → ONE ease-out flight to the next
     station (A hero top → B framed "Two ancient islands" title → C whisky
     full-screen). Below C is free scroll. Upward is NEVER trapped: every wheel/
     touch listener is passive, the engine only ever moves scrollY DOWNWARD to a
     LOWER station, and any counter-input cancels the flight so native scroll wins
     the same frame. Off under reduced-motion / phones (calmScroll) and via the
     ?noglide kill-switch. ────────────────────────────────────────────────── */
  if (!calmScroll && !/[?&]noglide/.test(location.search)) (function () {
    window.__mastrySnapEngine = true;            // bottle-3d stands its WALL down; the glide owns the pour
    if (typeof window.__glideVel !== "number") window.__glideVel = 2.6; // avg px/ms, live-tunable (lower = slower)
    var DUR_MIN = 780, DUR_MAX = 2200;           // ms clamps
    var TRIGGER_PX = 60;                          // downward accum to arm one flight
    var ACCUM_IDLE = 220, COOLDOWN_MS = 320, SKIP_EPS = 24, WATCHDOG_PAD = 500;
    var pin = document.querySelector(".heropin");
    var title = document.querySelector(".herowords .hero__title");
    var hb = document.querySelector(".highball");
    if (!pin || !title || !hb) { window.__mastrySnapEngine = false; return; }
    var vh = function () { return window.innerHeight; };
    var absTop = function (el) { return el.getBoundingClientRect().top + window.scrollY; };
    function stA() { return pin.offsetTop; }                                   // ~0
    function stB() { return Math.round(absTop(title) + title.offsetHeight * 0.5 - 0.50 * vh()); } // title mid at screen centre
    function stC() { return Math.round(absTop(hb) - 0.80 * vh() + 0.88 * (hb.offsetHeight - 0.20 * vh())); } // whisky pour complete, full-screen
    function stations() { return [stA(), stB(), stC()]; }
    function zoneEnd() { return absTop(hb) + hb.offsetHeight - vh(); }
    function inZone() { return window.scrollY <= zoneEnd() + 2; }
    function nextTarget() { var y = window.scrollY + SKIP_EPS, s = stations(); for (var i = 0; i < s.length; i++) if (s[i] > y) return s[i]; return null; }
    function easeOutCubic(t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return 1 - Math.pow(1 - t, 3); }
    var state = "IDLE", accum = 0, lastDownT = 0, cooldownUntil = 0;
    var raf = 0, fromY = 0, toY = 0, startT = 0, dur = 0;
    function flyTo(target) {
      fromY = window.scrollY; toY = target;
      if (toY <= fromY) return;                     // engine never moves up or nowhere
      var vel = (typeof window.__glideVel === "number" && window.__glideVel > 0) ? window.__glideVel : 2.6;
      dur = Math.max(DUR_MIN, Math.min(DUR_MAX, (toY - fromY) / vel));
      startT = performance.now(); state = "ANIMATING";
      cancelAnimationFrame(raf); raf = requestAnimationFrame(step);
    }
    function step(now) {
      if (state !== "ANIMATING") return;
      var e = now - startT;
      if (e >= dur || e > dur + WATCHDOG_PAD) { settle(); return; }
      window.scrollTo(0, Math.round(fromY + (toY - fromY) * easeOutCubic(e / dur)));
      raf = requestAnimationFrame(step);
    }
    function settle() { cancelAnimationFrame(raf); raf = 0; window.scrollTo(0, Math.round(toY)); state = "IDLE"; accum = 0; cooldownUntil = performance.now() + COOLDOWN_MS; }
    function abort() { if (state !== "ANIMATING") return; cancelAnimationFrame(raf); raf = 0; state = inZone() ? "IDLE" : "FREE"; accum = 0; }
    window.addEventListener("wheel", function (e) {
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      var d = e.deltaY; if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= vh();
      if (state === "ANIMATING") { if (d < 0) abort(); return; }        // up aborts; down ignored (latch)
      if (state === "FREE") { if (nextTarget() != null && inZone()) state = "IDLE"; else return; }
      var t = performance.now();
      if (t < cooldownUntil) { if (d > 0) cooldownUntil = t + 120; return; } // absorb inertial tail
      if (d < 0) { accum = 0; return; }                                 // upward can never arm
      if (t - lastDownT > ACCUM_IDLE) accum = 0;
      lastDownT = t; accum += d;
      if (accum >= TRIGGER_PX && inZone()) { var tgt = nextTarget(); accum = 0; if (tgt == null) { state = "FREE"; return; } flyTo(tgt); }
    }, { passive: true });
    window.addEventListener("keydown", function (e) {
      var el = e.target, tag = el && el.tagName;
      if ((el && (el.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el.getAttribute && el.getAttribute("role") === "tab"))) || e.metaKey || e.ctrlKey || e.altKey) return;
      var k = e.key;
      var downKey = (k === "ArrowDown" || k === "PageDown" || ((k === " " || k === "Spacebar") && !e.shiftKey));
      var upKey = (k === "ArrowUp" || k === "PageUp" || k === "Home" || k === "End" || ((k === " " || k === "Spacebar") && e.shiftKey));
      if (state === "ANIMATING") { if (upKey) { abort(); return; } if (downKey) { e.preventDefault(); } return; } // up never prevented
      if (!downKey || e.repeat) return;
      if (state === "FREE") { if (nextTarget() != null && inZone()) state = "IDLE"; else return; }
      if (performance.now() < cooldownUntil || !inZone()) return;
      var tgt = nextTarget(); if (tgt == null) { state = "FREE"; return; }
      e.preventDefault(); flyTo(tgt);
    }, { passive: false });
    window.addEventListener("touchstart", function () { if (state === "ANIMATING") abort(); }, { passive: true }); // touch never triggers; only aborts
    document.addEventListener("visibilitychange", function () { if (document.hidden && state === "ANIMATING") settle(); });
    window.addEventListener("blur", function () { if (state === "ANIMATING") settle(); });
    window.addEventListener("resize", function () { if (state === "ANIMATING") { var s = stations(); for (var i = 0; i < s.length; i++) if (s[i] > fromY) { toY = s[i]; break; } } });
    window.__mastryGlide = { get state() { return state; }, stations: stations, zoneEnd: zoneEnd, nextTarget: nextTarget, flyTo: flyTo, abort: abort };
  })();
})();
