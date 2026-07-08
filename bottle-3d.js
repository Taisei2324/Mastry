/* <bottle-3d> — real-time spinning Mastry bottle for the hero.
   Usage: <bottle-3d label-src="images/label.jpg" condensation="2" spin-speed="1" offset-x="1.55">
   Requires the global THREE build (r147). Progressive enhancement: on first
   successful frame it adds .bottle3d-on to <html> so CSS can hide the static
   photo; if WebGL or THREE is missing it does nothing and the photo remains. */
(function () {
  "use strict";

  var REDUCE = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* bottle silhouette: (radius, height) pairs, base at y=0, ~3.24 units tall */
  var PROFILE = [
    [0.001, 0.0], [0.30, 0.0], [0.44, 0.015], [0.50, 0.06], [0.525, 0.16],
    [0.525, 1.58], [0.505, 1.78], [0.44, 1.98], [0.34, 2.22], [0.245, 2.46],
    [0.19, 2.66], [0.175, 2.82], [0.175, 3.0]
  ];
  var BOTTLE_H = 3.24;
  var LABEL_BOTTOM = 0.30, LABEL_H = 1.22, LABEL_R = 0.535;

  function radiusAt(y) {
    for (var i = 1; i < PROFILE.length; i++) {
      if (y <= PROFILE[i][1]) {
        var a = PROFILE[i - 1], b = PROFILE[i];
        var t = (y - a[1]) / ((b[1] - a[1]) || 1);
        return a[0] + (b[0] - a[0]) * t;
      }
    }
    return PROFILE[PROFILE.length - 1][0];
  }

  /* soft studio environment: paper-warm gradient with two window streaks,
     so the glass and cap have something to reflect */
  function makeEnvTexture() {
    var c = document.createElement("canvas");
    c.width = 512; c.height = 256;
    var x = c.getContext("2d");
    var g = x.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.5, "#f6f2e6");
    g.addColorStop(1, "#c9c6b6");
    x.fillStyle = g; x.fillRect(0, 0, 512, 256);
    x.filter = "blur(14px)";
    x.fillStyle = "rgba(255,255,255,0.95)";
    x.fillRect(96, 20, 46, 170);
    x.fillRect(330, 30, 70, 150);
    x.fillStyle = "rgba(56,62,40,0.55)";
    x.fillRect(212, 10, 42, 210);
    x.fillRect(462, 24, 34, 190);
    x.fillStyle = "rgba(145,150,79,0.35)";
    x.fillRect(0, 216, 512, 40);
    x.filter = "none";
    var tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  /* knurled silver cap texture: fine vertical ribs */
  function makeCapTexture() {
    var c = document.createElement("canvas");
    c.width = 512; c.height = 64;
    var x = c.getContext("2d");
    for (var i = 0; i < 128; i++) {
      x.fillStyle = i % 2 ? "#b9bdc1" : "#e4e7e9";
      x.fillRect(i * 4, 0, 4, 64);
    }
    var tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  /* fallback label if label-src fails to load */
  function makeFallbackLabel() {
    var c = document.createElement("canvas");
    c.width = 1024; c.height = 380;
    var x = c.getContext("2d");
    x.fillStyle = "#f3f0e7"; x.fillRect(0, 0, 1024, 380);
    x.fillStyle = "#26341c"; x.textAlign = "center";
    x.font = "600 92px Georgia, serif";
    x.fillText("M A S T R Y", 512, 190);
    x.font = "24px Georgia, serif";
    x.fillStyle = "#59653f";
    x.fillText("SPARKLING WATER WITH MASTIC", 512, 248);
    return new THREE.CanvasTexture(c);
  }

  function Bottle3D() {
    return Reflect.construct(HTMLElement, [], Bottle3D);
  }
  Bottle3D.prototype = Object.create(HTMLElement.prototype, {
    constructor: { value: Bottle3D },

    connectedCallback: {
      value: function () {
        if (this._booted) return;
        this._booted = true;
        var host = this;
        if (!window.THREE) return;

        var labelSrc = host.getAttribute("label-src") || "images/label.jpg";
        var condensation = parseFloat(host.getAttribute("condensation") || "1");
        var spinSpeed = parseFloat(host.getAttribute("spin-speed") || "1");
        var offsetX = parseFloat(host.getAttribute("offset-x") || "0");

        var renderer;
        try {
          renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        } catch (e) { return; }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputEncoding = THREE.sRGBEncoding;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.12;
        renderer.domElement.style.cssText = "display:block;width:100%;height:100%;";
        host.style.display = "block";
        host.appendChild(renderer.domElement);

        var scene = new THREE.Scene();
        var camera = new THREE.PerspectiveCamera(30, 1, 0.1, 40);
        camera.position.set(0, 1.62, 7.6);
        camera.lookAt(0, 1.62, 0);

        var pmrem = new THREE.PMREMGenerator(renderer);
        scene.environment = pmrem.fromEquirectangular(makeEnvTexture()).texture;
        scene.add(new THREE.HemisphereLight(0xffffff, 0xdad5c2, 0.6));
        var sun = new THREE.DirectionalLight(0xffffff, 0.9);
        sun.position.set(2.5, 4, 3);
        scene.add(sun);

        var group = new THREE.Group();
        scene.add(group);

        /* glass shell */
        var pts = PROFILE.map(function (p) { return new THREE.Vector2(p[0], p[1]); });
        var glass = new THREE.Mesh(
          new THREE.LatheGeometry(pts, 48),
          new THREE.MeshPhysicalMaterial({
            color: 0xffffff, transparent: true, opacity: 0.17,
            roughness: 0.04, metalness: 0, envMapIntensity: 1.5,
            clearcoat: 1, clearcoatRoughness: 0.06,
            depthWrite: false
          })
        );
        group.add(glass);

        /* sparkling water inside */
        var lpts = [];
        for (var i = 0; i < PROFILE.length; i++) {
          var p = PROFILE[i];
          if (p[1] > 2.72) break;
          lpts.push(new THREE.Vector2(Math.max(p[0] * 0.94, 0.001), Math.min(p[1] + 0.02, 2.72)));
        }
        lpts.push(new THREE.Vector2(0.14, 2.72));
        lpts.push(new THREE.Vector2(0.001, 2.72));
        var liquid = new THREE.Mesh(
          new THREE.LatheGeometry(lpts, 40),
          new THREE.MeshPhysicalMaterial({
            color: 0xe9f4ee, transparent: true, opacity: 0.2,
            roughness: 0.02, metalness: 0, envMapIntensity: 0.3,
            depthWrite: false
          })
        );
        group.add(liquid);

        /* wrap-around label */
        var labelMat = new THREE.MeshStandardMaterial({
          map: makeFallbackLabel(), roughness: 0.85, metalness: 0,
          envMapIntensity: 0.25, side: THREE.DoubleSide
        });
        /* paper wraps ~3/4 of the bottle so glass shows through the gap */
        var LABEL_ARC = Math.PI * 1.5;
        var label = new THREE.Mesh(
          new THREE.CylinderGeometry(LABEL_R, LABEL_R, LABEL_H, 64, 1, true,
            Math.PI - LABEL_ARC / 2, LABEL_ARC),
          labelMat
        );
        label.position.y = LABEL_BOTTOM + LABEL_H / 2;
        label.rotation.y = Math.PI; /* texture centre faces the camera */
        group.add(label);
        new THREE.TextureLoader().load(labelSrc, function (tex) {
          tex.encoding = THREE.sRGBEncoding;
          tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          labelMat.map = tex;
          labelMat.needsUpdate = true;
        });

        /* silver twist cap */
        var capTex = makeCapTexture();
        var cap = new THREE.Mesh(
          new THREE.CylinderGeometry(0.19, 0.19, 0.32, 48),
          new THREE.MeshStandardMaterial({
            map: capTex, color: 0xffffff, metalness: 0.85, roughness: 0.32,
            envMapIntensity: 1.2
          })
        );
        cap.position.y = 3.08;
        group.add(cap);

        /* carbonation: tiny bubbles rising through the liquid */
        var BUBBLES = 110;
        var bubbleGeo = new THREE.SphereGeometry(1, 6, 6);
        var bubbleMat = new THREE.MeshBasicMaterial({
          color: 0xf4fbf7, transparent: true, opacity: 0.55, depthWrite: false
        });
        var bubbles = new THREE.InstancedMesh(bubbleGeo, bubbleMat, BUBBLES);
        var bub = [];
        for (i = 0; i < BUBBLES; i++) {
          bub.push({
            th: Math.random() * Math.PI * 2,
            rr: Math.random(),
            y: 0.1 + Math.random() * 2.5,
            v: 0.12 + Math.random() * 0.3,
            s: 0.006 + Math.random() * 0.013
          });
        }
        group.add(bubbles);

        /* condensation droplets on the glass, above and below the label */
        var DROPS = Math.max(0, Math.round(70 * condensation));
        var drops = null;
        if (DROPS) {
          drops = new THREE.InstancedMesh(
            new THREE.SphereGeometry(1, 8, 6),
            new THREE.MeshPhysicalMaterial({
              color: 0xffffff, transparent: true, opacity: 0.5,
              roughness: 0.05, metalness: 0, envMapIntensity: 2.2,
              depthWrite: false
            }),
            DROPS
          );
          var dummy = new THREE.Object3D();
          for (i = 0; i < DROPS; i++) {
            var upper = Math.random() < 0.78;
            var dy = upper
              ? 1.6 + Math.random() * 0.72
              : 0.05 + Math.random() * 0.2;
            var th = Math.random() * Math.PI * 2;
            var r = radiusAt(dy) + 0.006;
            var s = 0.008 + Math.random() * 0.014;
            dummy.position.set(Math.sin(th) * r, dy, Math.cos(th) * r);
            dummy.rotation.set(0, th, 0);
            dummy.scale.set(s, s * 1.5, s * 0.5);
            dummy.updateMatrix();
            drops.setMatrixAt(i, dummy.matrix);
          }
          drops.instanceMatrix.needsUpdate = true;
          group.add(drops);
        }

        /* --- placement -------------------------------------------------- */
        var hero = document.querySelector(".hero");
        var stage = document.querySelector(".hero__stage");
        var mat4 = new THREE.Matrix4();

        function visWorldH() {
          return 2 * camera.position.z * Math.tan(camera.fov * Math.PI / 360);
        }

        function place() {
          var vh = window.innerHeight || 1;
          var perPx = visWorldH() / vh;
          if (stage) {
            /* pin the bottle to the hero stage so it sits exactly where the
               photo lives on every screen size and scrolls away with it */
            var rect = stage.getBoundingClientRect();
            var dx = rect.left + rect.width / 2 - (window.innerWidth || 1) / 2;
            var dy = rect.top + rect.height / 2 - vh / 2;
            group.position.x = dx * perPx;
            group.position.y = -dy * perPx;
            var sc = Math.min(1.05, Math.max(0.4, rect.height * perPx / (BOTTLE_H + 0.35)));
            group.scale.setScalar(sc);
            return rect.bottom > -60 && rect.top < vh + 60;
          }
          group.position.x = offsetX;
          group.position.y = 0;
          var fadeEnd = (hero ? hero.offsetHeight : vh) * 0.85;
          var op = Math.max(0, Math.min(1, 1 - window.scrollY / fadeEnd));
          host.style.opacity = op;
          return op > 0;
        }

        function resize() {
          var w = host.clientWidth || window.innerWidth;
          var h = host.clientHeight || window.innerHeight;
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        }
        window.addEventListener("resize", resize);
        resize();

        /* --- animation loop --------------------------------------------- */
        var clock = new THREE.Clock();
        var t = 0, shown = false, cleared = false;

        function frame() {
          requestAnimationFrame(frame);
          if (document.hidden) return;
          var dt = Math.min(clock.getDelta(), 0.05);
          var visible = place();
          if (!visible && shown) {
            if (!cleared) { renderer.clear(); cleared = true; }
            return;
          }
          cleared = false;

          if (!REDUCE) {
            t += dt;
            group.rotation.y = t * 0.4 * spinSpeed;
            group.rotation.z = Math.sin(t * 0.7) * 0.015;
            group.position.y += Math.sin(t * 0.9) * 0.045;
            for (var i = 0; i < BUBBLES; i++) {
              var b = bub[i];
              b.y += b.v * dt;
              if (b.y > 2.6) { b.y = 0.08; b.th = Math.random() * Math.PI * 2; }
              var br = b.rr * (radiusAt(b.y) * 0.94 - 0.03);
              var wob = b.th + t * 0.3;
              mat4.makeScale(b.s, b.s, b.s);
              mat4.setPosition(Math.sin(wob) * br, b.y, Math.cos(wob) * br);
              bubbles.setMatrixAt(i, mat4);
            }
            bubbles.instanceMatrix.needsUpdate = true;
          }

          renderer.render(scene, camera);
          if (!shown) {
            shown = true;
            document.documentElement.classList.add("bottle3d-on");
          }
        }
        frame();
      }
    }
  });
  Object.setPrototypeOf(Bottle3D, HTMLElement);
  customElements.define("bottle-3d", Bottle3D);
})();
