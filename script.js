/* MASTRY — interactions */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── loader ── */
  var loader = document.getElementById("loader");
  window.addEventListener("load", function () {
    setTimeout(function () { loader.classList.add("done"); }, reduceMotion ? 0 : 900);
  });
  /* safety: never trap the user behind the loader */
  setTimeout(function () { loader.classList.add("done"); }, 3500);

  /* ── nav ── */
  var nav = document.getElementById("nav");
  var progress = document.getElementById("progress");
  var heroBottle = document.getElementById("heroBottle");

  function onScroll() {
    var y = window.scrollY;
    nav.classList.toggle("solid", y > 40);
    var h = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    if (heroBottle && !reduceMotion && y < window.innerHeight) {
      heroBottle.style.transform = "translateY(" + y * 0.12 + "px)";
    }
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

  /* ── scroll reveals ── */
  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
  document.querySelectorAll(".reveal").forEach(function (el) { revealObserver.observe(el); });

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
    detail.style.opacity = 0;
    setTimeout(function () {
      fJp.textContent = f.jp;
      fDesc.textContent = f.desc;
      fNotes.innerHTML = f.notes.map(function (n) { return "<li>" + n + "</li>"; }).join("");
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
})();
