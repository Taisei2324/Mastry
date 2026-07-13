/* MASTRY — interactions */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* phones get a calmer page: no scroll-driven transforms, ambient animation only */
  var calmScroll = reduceMotion || window.matchMedia("(max-width: 760px)").matches;

  /* Windows desktops scroll in big discrete wheel notches (a Mac trackpad tick
     is a few px; a mouse notch is ~100+), so the same choreography plays much
     faster there. Stamp .win-runway and style.css lengthens the animation
     runway — each notch advances the story less. No scroll hijacking. */
  if (!calmScroll && /Win/.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || "")) {
    document.documentElement.classList.add("win-runway");
  }
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
  /* phones: the herowords copy box rode a data-speed parallax, but iOS
     delivers momentum-scroll events in bursts, so the transform landed in
     jumps and the box visibly TELEPORTED just as the cup framed it (user:
     "glitchy, laggy, teleporting"). Strip the attribute before the stage
     registers it AND before cupFrameY compensates for it — on a phone the
     box simply rides the page natively. */
  if (calmScroll) document.querySelectorAll(".herowords .hero__copy[data-speed]").forEach(function (el) { el.removeAttribute("data-speed"); });
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

  /* in-page anchor clicks glide with scroll-behavior:smooth — stamp the moment
     so THE WALL (bottle-3d.js) and the frame freeze stand down during the
     flight instead of killing it mid-pour */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (a && a.getAttribute("href").length > 1) window.__anchorGlide = Date.now();
  }, true);

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
      'cup drop: <b id="cdVal"></b> px &nbsp;(+ = lower / below the text-box midline)' +
      '<br><input id="cdSlider" type="range" min="-200" max="450" style="width:240px;margin:6px 0">' +
      '<br>glide: <b id="cgVal">280</b> ms &nbsp;(higher = duller / less jittery)' +
      '<br><input id="cgSlider" type="range" min="20" max="700" value="280" style="width:240px;margin:6px 0">' +
      '<br>freeze at frame: <b id="fhVal">2000</b> ms &nbsp;(lock the framed shot)' +
      '<br><input id="fhSlider" type="range" min="0" max="4000" step="100" value="2000" style="width:240px;margin:6px 0">' +
      '<br><span id="cdMouse" style="opacity:.75">move mouse — read Y</span>';
    document.body.appendChild(cbox);
    var line = document.createElement("div");
    line.style.cssText = "position:fixed;left:0;right:0;height:1px;background:rgba(255,80,80,.8);z-index:99998;pointer-events:none;top:0;";
    document.body.appendChild(line);
    /* start the drop slider at THIS device's real default (a viewport fraction,
       so it matches what the page is actually showing on this screen) */
    var dropDefault = window.matchMedia("(max-width: 760px)").matches
      ? Math.round(window.innerHeight * 0.086)
      : Math.min(170, Math.round(window.innerHeight * 0.2125));
    window.__cupDrop = dropDefault;
    window.__cupGlide = 280;
    window.__frameHold = 2000;
    var sl = cbox.querySelector("#cdSlider"), val = cbox.querySelector("#cdVal"), mo = cbox.querySelector("#cdMouse");
    sl.value = dropDefault; val.textContent = dropDefault;
    var gl = cbox.querySelector("#cgSlider"), gval = cbox.querySelector("#cgVal");
    var fh = cbox.querySelector("#fhSlider"), fhv = cbox.querySelector("#fhVal");
    sl.addEventListener("input", function () { window.__cupDrop = +sl.value; val.textContent = sl.value; });
    gl.addEventListener("input", function () { window.__cupGlide = +gl.value; gval.textContent = gl.value; });
    fh.addEventListener("input", function () { window.__frameHold = +fh.value; fhv.textContent = fh.value; });
    document.addEventListener("mousemove", function (e) {
      line.style.top = e.clientY + "px";
      mo.textContent = "mouse Y = " + e.clientY + " px  (" + (e.clientY / window.innerHeight).toFixed(3) + " vh)";
    });
  }

  /* ── frame freeze: NOT an auto-scroll. The reader scrolls manually; the first
     time they reach the "Two ancient islands / One clear water" frame (title at
     screen centre) going DOWN, the scroll LOCKS on that composition for ~2s, then
     releases. Bounded (a timer always ends it), scrolling UP is never affected,
     re-arms only after leaving the frame. ON for phones too (user: "the
     disabling-scroll thing on mobile doesn't work — work on that"): touchmove
     is preventDefault'd during the hold and the clamp catches any iOS momentum
     that ignores it. Off only for reduced-motion and via ?nofreeze.
     Tunable: window.__frameHold (ms; 0 = off). ──────────────────── */
  if (!reduceMotion && !/[?&]nofreeze/.test(location.search)) (function () {
    var box = document.querySelector(".herowords .hero__copy");
    var hbSec = document.querySelector(".highball");
    if (!box) return;
    var bottle = document.querySelector(".heropin bottle-3d"); // the WALL publishes engagement as _holdY — never freeze while it holds
    var HOLD_MS = 2000, holdTimer = 0, holding = false, lastY = window.scrollY, activeFrame = null;
    // only a real reader can trip the freeze — a browser's async scroll-restore
    // crossing a frame on reload must never lock the page (or fight the
    // start-at-top guard in bottle-3d.js)
    var userGestured = false;
    ["wheel", "touchstart", "keydown", "pointerdown", "mousedown"].forEach(function (t) {
      window.addEventListener(t, function () { userGestured = true; }, { passive: true, once: true });
    });
    function vh() { return window.innerHeight; }
    // frame 1 — "Two ancient islands / One clear water":
    // DESKTOP: the copy box framed at screen centre — exact parallax fixed
    // point (the box carries data-speed, so the naive measure drifts with
    // where you measure from).
    // PHONES: the herowords section's natural END — the title box waits at
    // the bottom of the frame with the centred cup above it (the same
    // composition the user approved at "Splits beautifully").
    function cupFrameY() {
      if (calmScroll) {
        var hw = document.querySelector(".herowords");
        if (!hw) return -1e9;
        return Math.round(hw.getBoundingClientRect().top + window.scrollY + hw.offsetHeight - vh());
      }
      var r = box.getBoundingClientRect(), y = window.scrollY;
      var raw = r.top + y + r.height / 2 - 0.5 * vh();
      var sp = parseFloat(box.dataset.speed) || 0;
      return Math.round((raw + sp * y) / (1 + sp));
    }
    // frame 2 — "Splits beautifully with a little whisky": the CLOSING shot,
    // after the act has fully wound down (highball scrub w = 1.0, the same
    // formula bottle-3d drives the act with). The decanter and cork have
    // faded out entirely (gone past w 0.99), the tumbler stands alone at
    // screen centre with the finished drink, and the stage's bottom edge
    // sits exactly on the viewport bottom — the still-life composition.
    function whiskyFrameY() {
      if (!hbSec) return -1e9;
      var top = hbSec.getBoundingClientRect().top + window.scrollY;
      return Math.round(top - 0.8 * vh() + 1.0 * (hbSec.offsetHeight - 0.2 * vh()));
    }
    var frames = [{ fy: cupFrameY, armed: true }, { fy: whiskyFrameY, armed: true }];
    function freeze(e) { e.preventDefault(); }
    function keyFreeze(e) { var k = e.key; if (k === "ArrowDown" || k === "ArrowUp" || k === "PageDown" || k === "PageUp" || k === "Home" || k === "End" || k === " " || k === "Spacebar") e.preventDefault(); }
    function endHold() {
      clearTimeout(holdTimer); holding = false; activeFrame = null;
      document.documentElement.style.overflow = ""; // phones: unfreeze the scroller
      window.removeEventListener("wheel", freeze, { passive: false });
      window.removeEventListener("touchmove", freeze, { passive: false });
      window.removeEventListener("keydown", keyFreeze, true);
    }
    function startHold(f) {
      var ms = (typeof window.__frameHold === "number") ? window.__frameHold : HOLD_MS;
      if (ms <= 0) { f.armed = false; return; }
      holding = true; f.armed = false; activeFrame = f;
      window.addEventListener("wheel", freeze, { passive: false });
      window.addEventListener("touchmove", freeze, { passive: false });
      window.addEventListener("keydown", keyFreeze, true);
      if (calmScroll) {
        // phones: in-flight momentum ignores preventDefault, and clamping it
        // back every scroll event read as a jittery tug-of-war (the reported
        // glitch). Kill it dead instead: snap straight onto the composition,
        // then freeze the scroller itself — overflow:hidden halts momentum
        // instantly and blocks new gestures for the whole hold.
        var de = document.documentElement, pb = de.style.scrollBehavior;
        de.style.scrollBehavior = "auto";
        window.scrollTo(0, f.fy());
        de.style.scrollBehavior = pb;
        de.style.overflow = "hidden";
      } else {
        // desktop: present the EXACT frame — with input already locked, glide
        // the last few px so the composition lands precisely as designed
        window.scrollTo({ top: f.fy(), behavior: "smooth" });
      }
      clearTimeout(holdTimer); holdTimer = setTimeout(endHold, ms);
    }
    window.addEventListener("scroll", function () {
      var y = window.scrollY, prevY = lastY, down = y > prevY; lastY = y;
      if (holding) {
        if (calmScroll) return; // phones: the scroller itself is frozen (overflow:hidden) — nothing to clamp
        // belt & braces: some browsers (Safari trackpad momentum) ignore the
        // wheel preventDefault, so ENFORCE the still frame — any drift is
        // snapped straight back (instant, overriding the CSS smooth scroll)
        var fy2 = activeFrame ? activeFrame.fy() : y;
        if (Math.abs(y - fy2) > 1 && Math.abs(y - fy2) > Math.abs(prevY - fy2) + 0.5) { // clamp only motion AWAY from the frame; the settle glide converges and lands softly
          var de = document.documentElement, prevB = de.style.scrollBehavior;
          de.style.scrollBehavior = "auto";
          window.scrollTo(0, fy2);
          de.style.scrollBehavior = prevB;
          lastY = fy2;
        }
        return;
      }
      var clear = !(bottle && bottle._holdY != null) && Date.now() - (window.__anchorGlide || 0) > 1500;
      // phones: a momentum flick leaps far between two scroll EVENTS, so the
      // catch zone is deeper (the settle glide brings the frame back)
      var catchVh = calmScroll ? 1.35 : 0.90;
      for (var i = 0; i < frames.length; i++) {
        var f = frames[i], fy = f.fy();
        if (y < fy - 0.20 * vh()) f.armed = true;                              // re-arm just above each frame — every fresh down-pass locks again
        // ZONE ENTRY, not strict crossing: iOS delivers momentum scroll in
        // bursts, so two consecutive events can BOTH land past the frame —
        // requiring prevY < fy skipped the lock entirely (the reported
        // "snap is not guaranteed" on mobile). `armed` already guarantees
        // one lock per down-pass; `down` keeps upward scrolling free.
        if (userGestured && f.armed && down && clear && y >= fy && y <= fy + catchVh * vh()) { startHold(f); break; }
      }
    }, { passive: true });
    window.addEventListener("blur", function () { if (holding) endHold(); });
    document.addEventListener("visibilitychange", function () { if (document.hidden && holding) endHold(); });
    window.__mastryFreeze = { get holding() { return holding; }, frames: frames, cupFrameY: cupFrameY, whiskyFrameY: whiskyFrameY, endHold: endHold };
  })();
})();
