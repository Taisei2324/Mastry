/* <bottle-3d> — Mastry 3D bottle web component.
   Transparent-canvas Three.js scene: lathe glass bottle, label texture,
   aluminum ROPP cap, condensation, fizz bubbles, scroll-reactive twist/drift,
   end-of-scroll cap-off + tilt + pour finale.
   Requires global THREE (three r147). */
(function () {
  'use strict';
  if (customElements.get('bottle-3d')) return;

  // Bottle silhouette: [radius, y] pairs, base y=0, top y≈3.26.
  // Sampled from the user's Blender model ("bottle only reset .blend"):
  // slim body, long shoulder taper, lip bead at the mouth.
  var PROFILE = [
    [0.001, 0.0], [0.3963, 0.0291], [0.4282, 0.0873], [0.4439, 0.1455],
    [0.4551, 0.2037], [0.4592, 0.262], [0.4598, 0.3202], [0.4602, 0.3784],
    [0.4608, 0.4948], [0.4616, 0.6112], [0.4624, 0.7859], [0.4634, 0.9023],
    [0.4643, 1.0187], [0.4651, 1.1934], [0.4659, 1.3098], [0.4665, 1.4262],
    [0.4673, 1.4845], [0.4679, 1.5427], [0.4677, 1.6009], [0.4666, 1.6591],
    [0.4607, 1.7173], [0.4551, 1.7755], [0.4473, 1.8337], [0.437, 1.892],
    [0.4239, 1.9502], [0.4075, 2.0084], [0.4028, 2.0666], [0.3755, 2.1248],
    [0.3556, 2.183], [0.3332, 2.2995], [0.3096, 2.3577], [0.2862, 2.4741],
    [0.2641, 2.5323], [0.2446, 2.5905], [0.2292, 2.6487], [0.219, 2.707],
    [0.2127, 2.7652], [0.2021, 2.8234], [0.1977, 2.8816], [0.1893, 2.9398],
    [0.2098, 2.998], [0.2168, 3.0562], [0.2037, 3.1145], [0.2052, 3.1727],
    [0.2011, 3.2309]
  ];
  var H = 3.26, CY = H / 2;

  function radiusAt(y) {
    if (y <= 0) return 0.3;
    for (var i = 1; i < PROFILE.length; i++) {
      if (PROFILE[i][1] >= y) {
        var a = PROFILE[i - 1], b = PROFILE[i];
        var t = (y - a[1]) / Math.max(1e-6, b[1] - a[1]);
        return a[0] + (b[0] - a[0]) * t;
      }
    }
    return PROFILE[PROFILE.length - 1][0];
  }
  function smoothstep(e0, e1, x) {
    var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  class Bottle3D extends HTMLElement {
    static get observedAttributes() { return ['condensation', 'spin-speed', 'spinspeed', 'offset-x', 'offsetx', 'pour']; }

    connectedCallback() {
      if (this._started) return;
      if (!window.THREE) { // three.js may still be loading from the helmet
        var self = this;
        setTimeout(function () { self.connectedCallback(); }, 60);
        return;
      }
      this._started = true;
      this.style.display = 'block';
      var canvas = document.createElement('canvas');
      canvas.style.cssText = 'width:100%;height:100%;display:block;';
      this.appendChild(canvas);
      this._canvas = canvas;
      this._initThree();
      this._bindEvents();
      this._clock = new THREE.Clock();
      var self = this;
      (function loop() {
        self._raf = requestAnimationFrame(loop);
        self._tick();
      })();
    }

    disconnectedCallback() {
      cancelAnimationFrame(this._raf);
      if (this._ro) this._ro.disconnect();
      if (this._io) this._io.disconnect();
      document.removeEventListener('visibilitychange', this._onVis);
      window.removeEventListener('scroll', this._onScroll);
      window.removeEventListener('wheel', this._onWheel);
      if (this._renderer) this._renderer.dispose();
      this._started = false;
    }

    attributeChangedCallback() { this._syncAttrs(); }

    _num(name, dflt) {
      var v = parseFloat(this.getAttribute(name));
      if (isNaN(v)) v = parseFloat(this.getAttribute(name.replace(/-/g, '')));
      return isNaN(v) ? dflt : v;
    }

    _syncAttrs() {
      this._condensation = Math.max(0, Math.min(10, this._num('condensation', 2)));
      this._spinSpeed = this._num('spin-speed', 1);
      this._offsetX = this._num('offset-x', 1.55);
      this._pourEnabled = this.getAttribute('pour') !== '0';
      if (this._drops) this._drops.count = Math.round(this._condensation * 55);
    }

    /* ---------- scene ---------- */
    _initThree() {
      if (!_v1) { _v1 = new THREE.Vector3(); _v2 = new THREE.Vector3(); _v3 = new THREE.Vector3(); _vZ = new THREE.Vector3(0, 0, 1); _q1 = new THREE.Quaternion(); _q2 = new THREE.Quaternion(); }
      var renderer = new THREE.WebGLRenderer({ canvas: this._canvas, alpha: true, antialias: true });
      renderer.setClearColor(0x000000, 0);
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.localClippingEnabled = true; // waterline = world-horizontal clip plane
      this._renderer = renderer;
      this._waterPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.32);

      var scene = new THREE.Scene();
      this._scene = scene;

      var camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
      camera.position.set(0, 0.1, 7.4);
      camera.lookAt(0, 0, 0);
      this._camera = camera;

      // Environment: soft studio light-box for glass/metal reflections
      var env = new THREE.Scene();
      var room = new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20),
        new THREE.MeshBasicMaterial({ color: 0x9a9a94, side: THREE.BackSide }));
      env.add(room);
      function panel(x, y, z, w, h, c) {
        var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0], c[1], c[2]), side: THREE.DoubleSide }));
        m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); return m;
      }
      panel(0, 9, 0, 8, 8, [7, 7, 6.6]);
      panel(-8, 2, 3, 3, 9, [3.4, 3.4, 3.2]);
      panel(8, 1, -2, 3, 9, [2.2, 2.2, 2.2]);
      panel(0, 1, 9, 5, 2.4, [1.6, 1.6, 1.55]);
      panel(-3, 2, 7, 0.7, 11, [10, 10, 9.5]);   // tall vertical highlight streak (hot glare band)
      panel(4.5, 2, 6, 0.5, 11, [5.5, 5.5, 5.3]);
      var pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(env, 0.04).texture;

      scene.add(new THREE.AmbientLight(0xffffff, 0.35));
      var key = new THREE.DirectionalLight(0xfff8ee, 1.15);
      key.position.set(3, 5, 4);
      scene.add(key);
      var rim = new THREE.DirectionalLight(0xe8f0ff, 0.4);
      rim.position.set(-4, 2, -3);
      scene.add(rim);
      var glint = new THREE.PointLight(0xffffff, 0.85, 30); // hot specular glint
      glint.position.set(2.4, 3.4, 3.2);
      scene.add(glint);

      // Groups: root (drift/tilt) > spin (twist) > bottle (pivot-centred)
      var root = new THREE.Group();
      var spin = new THREE.Group();
      var bottle = new THREE.Group();
      bottle.position.y = -CY;
      spin.add(bottle); root.add(spin); scene.add(root);
      this._root = root; this._spin = spin; this._bottle = bottle;

      this._buildBottle(bottle);
      this._buildCap(bottle);
      this._buildBubbles(bottle);
      this._buildCondensation(bottle);
      this._buildPour(scene);
      this._buildShadow(scene);

      // state
      this._vel = 0; this._lastScroll = window.scrollY;
      this._rotY = 0; this._driftX = 0; this._driftY = 0; this._tiltV = 0;
      this._capT = 0; this._tiltT = 0;
      this._syncAttrs();
      this._resize();
    }

    _buildBottle(parent) {
      var pts = PROFILE.map(function (p) { return new THREE.Vector2(p[0], p[1]); });
      var glassGeo = new THREE.LatheGeometry(pts, 144);

      var back = new THREE.Mesh(glassGeo, new THREE.MeshPhysicalMaterial({
        color: 0xc4dccc, roughness: 0.07, metalness: 0, transparent: true, opacity: 0.26,
        side: THREE.BackSide, envMapIntensity: 1.4, depthWrite: false
      }));
      back.renderOrder = 1;
      parent.add(back);

      // water
      var wpts = [];
      for (var y = 0.08; y <= 2.32; y += 0.08) wpts.push(new THREE.Vector2(radiusAt(y) * 0.90, y));
      wpts.push(new THREE.Vector2(radiusAt(2.32) * 0.90, 2.32));
      var water = new THREE.Mesh(new THREE.LatheGeometry(wpts, 96), new THREE.MeshPhysicalMaterial({
        color: 0xd9e8dc, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.26,
        envMapIntensity: 1.0, depthWrite: false, side: THREE.DoubleSide,
        clippingPlanes: [this._waterPlane]
      }));
      water.renderOrder = 2;
      parent.add(water);
      this._water = water;
      this._level = 1; // 1 = full; drains toward 0.32 while pouring
      var top = new THREE.Mesh(new THREE.CircleGeometry(radiusAt(2.32) * 0.90, 48),
        new THREE.MeshPhysicalMaterial({ color: 0xf2f7f0, roughness: 0.04, transparent: true, opacity: 0.35, envMapIntensity: 1.4, depthWrite: false }));
      top.rotation.x = -Math.PI / 2; top.position.y = 2.32; top.renderOrder = 2;
      parent.add(top);
      this._waterTop = top;

      // label
      var tex = new THREE.TextureLoader().load((this.getAttribute('label-src') || 'assets/label.jpg'));
      tex.encoding = THREE.sRGBEncoding;
      tex.wrapS = THREE.RepeatWrapping;
      tex.anisotropy = this._renderer.capabilities.getMaxAnisotropy();
      var labelH = 1.1, labelC = 1.2; // ends before the shoulder taper begins
      var label = new THREE.Mesh(new THREE.CylinderGeometry(0.478, 0.478, labelH, 128, 1, true),
        new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: 0.012, roughness: 0.55, metalness: 0 }));
      label.position.y = labelC;
      label.rotation.y = Math.PI; // full-wrap label: artwork centre (MASTRY) faces the camera, seam at the back
      label.renderOrder = 3;
      parent.add(label);

      var front = new THREE.Mesh(glassGeo, new THREE.MeshPhysicalMaterial({
        color: 0xd6e8dc, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.3,
        clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.FrontSide,
        envMapIntensity: 2.6, depthWrite: false
      }));
      front.renderOrder = 5;
      parent.add(front);

      // fresnel rim — bright glass edges where the surface turns away
      var fresnel = new THREE.Mesh(glassGeo, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
        vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float d = 1.0 - abs(dot(normalize(vN), normalize(vV))); float f = pow(d, 2.1); float hot = pow(d, 6.0); vec3 tint = vec3(0.82, 0.94, 0.86); gl_FragColor = vec4(tint * f * 1.1 + vec3(1.0) * hot * 0.85, f * 0.85 + hot * 0.6); }'
      }));
      fresnel.renderOrder = 6;
      parent.add(fresnel);

      // mouth (visible once cap is off)
      var mouth = new THREE.Mesh(new THREE.TorusGeometry(0.188, 0.018, 10, 40),
        new THREE.MeshPhysicalMaterial({ color: 0xdfe5dc, roughness: 0.1, transparent: true, opacity: 0.5, envMapIntensity: 1.6 }));
      mouth.rotation.x = Math.PI / 2; mouth.position.y = 3.24; mouth.renderOrder = 5;
      parent.add(mouth);
      // glass threads on the neck (visible once the cap is off)
      var threadMat = new THREE.MeshPhysicalMaterial({ color: 0xe8efe8, roughness: 0.08, transparent: true, opacity: 0.45, envMapIntensity: 1.8 });
      for (var th = 0; th < 2; th++) {
        var thread = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.007, 8, 48), threadMat);
        thread.rotation.x = Math.PI / 2;
        thread.position.y = 3.0 + th * 0.09;
        thread.renderOrder = 5;
        parent.add(thread);
      }
      this._mouthAnchor = new THREE.Object3D();
      this._mouthAnchor.position.set(0, 3.3, 0);
      parent.add(this._mouthAnchor);
    }

    _buildCap(parent) {
      // user-supplied max-LOD OBJ cap (assets/cap.obj); procedural fallback below.
      // Spinning parts go in this._cap; tamper ring + bridges stay fixed on the neck.
      this._capBaseY = 2.93; // sits over the wider lip bead of the user's bottle
      this._parentForCap = parent;
      var cap = new THREE.Group();
      cap.position.y = this._capBaseY;
      parent.add(cap);
      this._cap = cap;
      var fixed = new THREE.Group();
      fixed.position.y = this._capBaseY;
      parent.add(fixed);
      this._capFixed = fixed;
      var self = this;
      var src = this.getAttribute('cap-src') || this.getAttribute('capsrc') || 'assets/cap.obj';
      fetch(src)
        .then(function (r) { if (!r.ok) throw new Error('cap fetch ' + r.status); return r.text(); })
        .then(function (t) { self._assembleCap(t); })
        .catch(function () { self._buildProceduralCap(); });
    }

    _assembleCap(text) {
      var groups = parseOBJGroups(text);
      if (!groups.length) return this._buildProceduralCap();
      var S = 0.0146; // model Ø31.8 mm, sized over this bottle's Ø0.43 lip bead
      var green = new THREE.MeshStandardMaterial({ color: 0x2e8f5e, metalness: 0.85, roughness: 0.34, envMapIntensity: 1.25 });
      var greenDark = new THREE.MeshStandardMaterial({ color: 0x1f6b47, metalness: 0.85, roughness: 0.42, envMapIntensity: 1.1 });
      var bareAlu = new THREE.MeshStandardMaterial({ color: 0xd8dadb, metalness: 1.0, roughness: 0.24, envMapIntensity: 1.5 });
      var linerMat = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, metalness: 0, roughness: 0.6 });
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        if (!g.pos.length) continue;
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(g.pos), 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(g.nor), 3));
        var mat = /liner/i.test(g.name) ? linerMat
          : /thread/i.test(g.name) ? bareAlu
          : /bridge/i.test(g.name) ? greenDark : green;
        var mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x = -Math.PI / 2; // model is Z-up
        mesh.scale.setScalar(S);
        var isFixed = /tamper|breakaway/i.test(g.name);
        (isFixed ? this._capFixed : this._cap).add(mesh);
        if (/breakaway/i.test(g.name)) this._capBridges = mesh;
      }
      // silver "OPEN →" print on the skirt
      var oc = document.createElement('canvas');
      oc.width = 1024; oc.height = 128;
      var og = oc.getContext('2d');
      og.font = '700 58px Inter, Helvetica, Arial, sans-serif';
      og.fillStyle = 'rgba(228,234,231,0.95)';
      og.textBaseline = 'middle';
      og.fillText('O P E N', 400, 68);
      og.fillRect(650, 60, 200, 10);
      og.beginPath(); og.moveTo(880, 65); og.lineTo(845, 45); og.lineTo(845, 85); og.closePath(); og.fill();
      var openTex = new THREE.CanvasTexture(oc);
      openTex.anisotropy = 8;
      var openBand = new THREE.Mesh(new THREE.CylinderGeometry(0.200, 0.200, 0.062, 96, 1, true),
        new THREE.MeshBasicMaterial({ map: openTex, transparent: true, depthWrite: false }));
      openBand.position.y = 0.115;
      openBand.rotation.y = Math.PI * 1.1;
      this._cap.add(openBand);
    }

    _buildProceduralCap() {
      var parent = this._parentForCap;
      // green painted-aluminum ROPP cap (per reference photo): domed top, tick
      // knurling band, silver "OPEN →" print, rolled beads, tamper band on neck
      var cap = this._cap;
      var green = new THREE.MeshStandardMaterial({ color: 0x2e8f5e, metalness: 0.85, roughness: 0.34, envMapIntensity: 1.25 });
      var greenDark = new THREE.MeshStandardMaterial({ color: 0x1f6b47, metalness: 0.85, roughness: 0.42, envMapIntensity: 1.1 });
      // skirt
      var side = new THREE.Mesh(new THREE.CylinderGeometry(0.192, 0.197, 0.30, 96, 1, true), green);
      side.position.y = 0.15;
      cap.add(side);
      // domed top with rounded shoulder
      var domePts = [
        new THREE.Vector2(0.192, 0.30), new THREE.Vector2(0.190, 0.315), new THREE.Vector2(0.170, 0.333),
        new THREE.Vector2(0.120, 0.345), new THREE.Vector2(0.050, 0.350), new THREE.Vector2(0.001, 0.351)
      ];
      var dome = new THREE.Mesh(new THREE.LatheGeometry(domePts, 96), green);
      cap.add(dome);
      // tick knurling — short pressed dashes just under the shoulder
      var knurl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.006, 0.052, 0.006),
        greenDark, 52);
      var kd = new THREE.Object3D();
      for (var ki = 0; ki < 52; ki++) {
        var ang = ki / 52 * Math.PI * 2;
        kd.position.set(Math.cos(ang) * 0.1955, 0.252, Math.sin(ang) * 0.1955);
        kd.rotation.y = -ang;
        kd.updateMatrix();
        knurl.setMatrixAt(ki, kd.matrix);
      }
      cap.add(knurl);
      // silver "OPEN →" print
      var oc = document.createElement('canvas');
      oc.width = 1024; oc.height = 128;
      var og = oc.getContext('2d');
      og.font = '700 58px Inter, Helvetica, Arial, sans-serif';
      og.fillStyle = 'rgba(228,234,231,0.95)';
      og.textBaseline = 'middle';
      og.fillText('O P E N', 400, 68);
      og.fillRect(650, 60, 200, 10);
      og.beginPath(); og.moveTo(880, 65); og.lineTo(845, 45); og.lineTo(845, 85); og.closePath(); og.fill();
      var openTex = new THREE.CanvasTexture(oc);
      openTex.anisotropy = 8;
      var openBand = new THREE.Mesh(new THREE.CylinderGeometry(0.198, 0.198, 0.062, 96, 1, true),
        new THREE.MeshBasicMaterial({ map: openTex, transparent: true, depthWrite: false }));
      openBand.position.y = 0.165;
      openBand.rotation.y = Math.PI * 1.1;
      cap.add(openBand);
      // rolled beads around the lower skirt
      for (var g = 0; g < 2; g++) {
        var bead = new THREE.Mesh(new THREE.TorusGeometry(0.1965, 0.011, 12, 72), green);
        bead.rotation.x = Math.PI / 2;
        bead.position.y = 0.045 + g * 0.062;
        cap.add(bead);
      }
      // sealing liner under the cap (visible from below once opened)
      var liner = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.018, 48),
        new THREE.MeshStandardMaterial({ color: 0xf2f0ea, metalness: 0, roughness: 0.6 }));
      liner.position.y = 0.012;
      cap.add(liner);
      // tamper-evident band — breaks away and stays on the neck
      var band = new THREE.Mesh(new THREE.CylinderGeometry(0.194, 0.199, 0.05, 96, 1, true), green);
      band.position.y = -0.027;
      this._capFixed.add(band);
      var perf = new THREE.Mesh(new THREE.TorusGeometry(0.1945, 0.0032, 6, 72), greenDark);
      perf.rotation.x = Math.PI / 2;
      perf.position.y = 0.0;
      this._capFixed.add(perf);
    }

    _buildBubbles(parent) {
      var COUNT = 180; // headroom for the 2x cap-off surge
      var mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.016, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false, clippingPlanes: [this._waterPlane] }), COUNT);
      mesh.count = 90;
      this._bubbleBase = 90;
      mesh.renderOrder = 4;
      parent.add(mesh);
      this._bubbles = mesh;
      this._bubbleData = [];
      for (var i = 0; i < COUNT; i++) {
        this._bubbleData.push({
          a: Math.random() * Math.PI * 2,
          rf: Math.pow(Math.random(), 0.5) * 0.8,
          y: 0.1 + Math.random() * 2.2,
          v: 0.10 + Math.random() * 0.22,
          s: 0.4 + Math.random() * 1.1,
          w: Math.random() * Math.PI * 2
        });
      }
    }

    _buildCondensation(parent) {
      var MAX = 620;
      var mat = new THREE.MeshBasicMaterial({ map: dropletTexture(), transparent: true, depthWrite: false });
      var mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.032, 0.038), mat, MAX);
      mesh.renderOrder = 6;
      parent.add(mesh);
      this._drops = mesh;
      this._dropData = [];
      var dummy = new THREE.Object3D();
      for (var i = 0; i < MAX; i++) {
        var y = 0.18 + Math.random() * 2.5;
        // fewer drops over the label band
        if (y > 0.66 && y < 1.88 && Math.random() < 0.55) y = Math.random() < 0.5 ? 0.2 + Math.random() * 0.45 : 1.9 + Math.random() * 0.75;
        var d = {
          a: Math.random() * Math.PI * 2,
          y: y,
          s: 0.45 + Math.random() * 1.25,
          runner: i < 7,           // first few are animated "runners"
          st: 0.18 + Math.random() * 0.62, // stiction — how much tilt before it starts sliding
          moving: false,
          v: 0.10 + Math.random() * 0.25
        };
        if (d.runner) { d.s = 1.7 + Math.random() * 0.6; d.y = 2.2 + Math.random() * 0.6; d.st = 0; }
        this._dropData.push(d);
        this._placeDrop(dummy, d, i);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this._dropDummy = dummy;
    }

    _placeDrop(dummy, d, i) {
      var r = radiusAt(d.y) + 0.006;
      dummy.position.set(Math.cos(d.a) * r, d.y, Math.sin(d.a) * r);
      var stretch = (d.runner || d.moving) ? 1.8 : 1.15;
      dummy.scale.set(d.s, d.s * stretch, d.s);
      dummy.lookAt(Math.cos(d.a) * (r + 1), d.y, Math.sin(d.a) * (r + 1));
      dummy.updateMatrix();
      this._drops.setMatrixAt(i, dummy.matrix);
    }

    _buildPour(scene) {
      var MAX = 160;
      var mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xf6fbf6, transparent: true, opacity: 0.75, depthWrite: false }), MAX);
      mesh.renderOrder = 7;
      mesh.count = 0;
      scene.add(mesh);
      this._pour = mesh;
      this._pourData = [];
      this._pourClock = 0;
      // continuous liquid stream (parabolic tube, rebuilt while pouring)
      var stream = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshPhysicalMaterial({
        color: 0xf0f7ef, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.0,
        envMapIntensity: 1.7, clearcoat: 1, clearcoatRoughness: 0.1, depthWrite: false
      }));
      stream.renderOrder = 7;
      stream.visible = false;
      stream.frustumCulled = false;
      scene.add(stream);
      this._stream = stream;
      // bright inner core — reads as solid liquid inside the sheath
      var core = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
        color: 0xfbfefb, transparent: true, opacity: 0.0, depthWrite: false
      }));
      core.renderOrder = 8;
      core.visible = false;
      core.frustumCulled = false;
      scene.add(core);
      this._streamCore = core;
    }

    _buildShadow(scene) {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      var g = cv.getContext('2d');
      var grad = g.createRadialGradient(128, 128, 8, 128, 128, 126);
      grad.addColorStop(0, 'rgba(30,28,22,0.32)');
      grad.addColorStop(1, 'rgba(30,28,22,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
      var tex = new THREE.CanvasTexture(cv);
      var mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = -CY - 0.12;
      mesh.scale.set(1, 0.42, 1); // squashed ellipse
      scene.add(mesh);
      this._shadow = mesh;
    }

    /* ---------- events ---------- */
    _bindEvents() {
      var self = this;
      this._onScroll = function () {
        var y = window.scrollY;
        self._vel += (y - self._lastScroll);
        self._lastScroll = y;
      };
      this._onWheel = function (e) {
        // keeps the bottle alive at scroll bounds
        var doc = document.scrollingElement;
        var max = doc.scrollHeight - window.innerHeight;
        if ((window.scrollY <= 0 && e.deltaY < 0) || (window.scrollY >= max - 1 && e.deltaY > 0)) {
          self._vel += e.deltaY * 0.4;
        }
      };
      window.addEventListener('scroll', this._onScroll, { passive: true });
      window.addEventListener('wheel', this._onWheel, { passive: true });
      this._ro = new ResizeObserver(function () { self._resize(); });
      this._ro.observe(this);
      // perf guards: don't render when the tab is hidden or the element is offscreen
      this._onVis = function () { self._hidden = document.hidden; };
      document.addEventListener('visibilitychange', this._onVis);
      this._io = new IntersectionObserver(function (entries) {
        if (entries[0]) self._offscreen = !entries[0].isIntersecting;
      });
      this._io.observe(this);
    }

    _resize() {
      var w = this.clientWidth || 1, h = this.clientHeight || 1;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      this._renderer.setPixelRatio(dpr);
      this._renderer.setSize(w, h, false);
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
      this._narrow = w < 720;
    }

    /* ---------- per-frame ---------- */
    _tick() {
      if (this._hidden || this._offscreen) { this._clock.getDelta(); return; }
      var dt = Math.min(0.05, this._clock.getDelta());
      var t = this._clock.elapsedTime;

      // scroll physics
      var vel = this._vel;
      this._vel *= Math.pow(0.0018, dt); // exponential decay
      var doc = document.scrollingElement;
      var max = Math.max(1, doc.scrollHeight - window.innerHeight);
      var p = Math.min(1, Math.max(0, window.scrollY / max));

      // twist: scroll up → twist right, scroll down → twist left (reversed)
      this._rotY += -vel * 0.0035 * dt * 60 * 0.016;
      var idle = 0.12 * this._spinSpeed;
      this._rotY += idle * dt;
      this._spin.rotation.y = this._rotY;

      // drift up-right / down-left with velocity, springing back
      var targY = Math.max(-0.6, Math.min(0.6, -vel * 0.010));
      var targX = Math.max(-0.38, Math.min(0.38, -vel * 0.0055));
      var targTilt = Math.max(-0.16, Math.min(0.16, vel * 0.0011));
      this._driftY = lerp(this._driftY, targY, 1 - Math.pow(0.004, dt));
      this._driftX = lerp(this._driftX, targX, 1 - Math.pow(0.004, dt));
      this._tiltV = lerp(this._tiltV, targTilt, 1 - Math.pow(0.004, dt));

      // finale: cap off, tilt, pour — with a pour budget: once ~500ml is out, settle back upright
      var capGoal = this._pourEnabled ? smoothstep(0.50, 0.74, p) : 0;
      var tiltGoal = this._pourEnabled ? smoothstep(0.72, 0.96, p) : 0;
      if (this._level <= 0.20) tiltGoal = 0;
      if (p < 0.45 && this._tiltT < 0.15) this._level = Math.min(1, this._level + dt * 0.5); // refill on the way back up
      this._capT = lerp(this._capT, capGoal, 1 - Math.pow(0.008, dt));
      this._tiltT = lerp(this._tiltT, tiltGoal, 1 - Math.pow(0.008, dt));
      var capT = this._capT, tiltT = this._tiltT;

      this._cap.position.y = this._capBaseY + capT * 1.35;
      this._cap.position.x = capT * 0.85;
      this._cap.rotation.y = -capT * 14;
      this._cap.rotation.z = -capT * 0.9;
      if (this._capBridges) this._capBridges.visible = capT < 0.15; // bridges snap on first turn

      // root placement
      var offsetX = this._narrow ? this._offsetX * 0.25 : this._offsetX;
      var bob = Math.sin(t * 0.8) * 0.05;
      this._root.position.x = offsetX + this._driftX + tiltT * 0.55;
      this._root.position.y = bob + this._driftY + tiltT * 0.55;
      this._root.rotation.z = this._tiltV + tiltT * 1.95;

      // water level — a world-horizontal clipping plane IS the waterline,
      // so the water visibly drains and pools no matter how the bottle tilts
      var lvl = this._level;
      _v2.set(0, 0, 0);
      this._bottle.localToWorld(_v2);          // bottle base, world
      _v3.set(0, 3.26, 0);
      this._bottle.localToWorld(_v3);          // mouth, world
      var dyPer = (_v3.y - _v2.y) / 3.26;
      var rEff = 0.52 * (1 - Math.min(1, Math.abs(dyPer))); // tilted → span includes the barrel radius
      var minY = Math.min(_v2.y, _v3.y) - rEff, maxY = Math.max(_v2.y, _v3.y) + rEff;
      var h = lerp(minY, maxY, 0.712 * lvl);   // pooled water height
      this._waterPlane.constant = h;
      // surface disc rides the waterline along the bottle axis, always world-level
      if (Math.abs(dyPer) > 0.25) {
        var yLoc = Math.min(2.31, Math.max(0.12, (h - _v2.y) / dyPer));
        this._waterLocalY = yLoc;
        this._waterTop.visible = true;
        this._waterTop.position.y = yLoc;
        var rs = radiusAt(yLoc) / radiusAt(2.32);
        this._waterTop.scale.set(rs, rs, 1);
        this._bottle.getWorldQuaternion(_q1);
        _v3.set(0, 1, 0).applyQuaternion(_q1.invert());
        _q2.setFromUnitVectors(_vZ, _v3);
        this._waterTop.quaternion.slerp(_q2, 1 - Math.pow(0.002, dt));
      } else {
        this._waterTop.visible = false; // near-horizontal: clipped body reads as the pool
        this._waterLocalY = 2.31;
      }

      // bubbles — 2x speed and 2x count once the cap is off
      var surge = (Math.min(3.5, Math.abs(vel) * 0.012) + tiltT * 3.0) * (1 + capT);
      this._bubbles.count = Math.round(this._bubbleBase * (1 + capT));
      var wrapY = Math.min(this._waterLocalY || 2.28, 2.28);
      var bd = this._bubbleData, dummy = this._dropDummy;
      for (var i = 0; i < bd.length; i++) {
        var b = bd[i];
        b.y += (b.v * (1 + surge)) * dt;
        b.w += dt * 2;
        if (b.y > wrapY) { b.y = 0.1; b.a = Math.random() * Math.PI * 2; b.rf = Math.pow(Math.random(), 0.5) * 0.8; }
        var r = radiusAt(b.y) * 0.85 * b.rf;
        dummy.position.set(Math.cos(b.a + Math.sin(b.w) * 0.15) * r, b.y, Math.sin(b.a) * r);
        var s = b.s * (0.7 + 0.3 * Math.sin(b.w));
        dummy.scale.set(s, s, s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        this._bubbles.setMatrixAt(i, dummy.matrix);
      }
      this._bubbles.instanceMatrix.needsUpdate = true;

      // condensation — droplets obey gravity in bottle space: tilt the bottle and they slide downhill
      this._bottle.getWorldQuaternion(_q1);
      _v1.set(0, -1, 0).applyQuaternion(_q1.invert()); // world-down expressed in bottle-local axes
      var mobility = smoothstep(0.10, 0.85, Math.abs(this._root.rotation.z)) + Math.min(0.5, Math.abs(vel) * 0.0012);
      var dd = this._dropData;
      for (var j = 0; j < dd.length; j++) {
        var d = dd[j];
        var free = d.runner ? Math.max(0.35, mobility) : Math.max(0, mobility - d.st);
        if (free > 0.01) {
          var rr = Math.max(0.15, radiusAt(d.y) + 0.006);
          var ga = _v1.x * (-Math.sin(d.a)) + _v1.z * Math.cos(d.a); // downhill around the barrel
          d.a += (ga / rr) * free * d.v * dt * 2.4;
          d.y += _v1.y * free * d.v * dt * 2.4;
          if (d.y < 0.15 || d.y > 3.0) { d.y = 0.3 + Math.random() * 2.4; d.a = Math.random() * Math.PI * 2; }
          d.moving = true;
          this._placeDrop(dummy, d, j);
        } else if (d.moving) {
          d.moving = false;
          this._placeDrop(dummy, d, j);
        }
      }
      this._drops.instanceMatrix.needsUpdate = true;

      // pour particles
      this._updatePour(dt, tiltT);

      // shadow
      var lift = Math.abs(this._driftY) + tiltT;
      this._shadow.material.opacity = Math.max(0, 0.9 - lift * 1.4);
      this._shadow.position.x = this._root.position.x;
      var ss = 1 + bob * 0.5;
      this._shadow.scale.set(ss, 0.42 * ss, 1);

      this._renderer.render(this._scene, this._camera);
      if (!this._shown) {
        this._shown = true;
        document.documentElement.classList.add('bottle3d-on'); // hides the static hero photo
      }
    }

    _updatePour(dt, tiltT) {
      var mesh = this._pour, data = this._pourData, dummy = this._dropDummy;
      var pouring = tiltT > 0.58 && this._level > 0.20;
      if (pouring) {
        this._level = Math.max(0.20, this._level - dt * 0.20); // visible drain over the pour
        this._mouthAnchor.getWorldPosition(_v1);
        // direction the mouth points (local +y of bottle, incl. tilt)
        _v2.set(0, 1, 0).applyQuaternion(this._bottle.getWorldQuaternion(_q1));
        this._pourClock += dt;
        var rate = 90 * (tiltT - 0.55);
        var n = Math.floor(this._pourClock * rate);
        this._pourClock -= n / Math.max(1, rate);
        for (var k = 0; k < n && data.length < mesh.instanceMatrix.count; k++) {
          data.push({
            x: _v1.x + (Math.random() - 0.5) * 0.05, y: _v1.y, z: _v1.z + (Math.random() - 0.5) * 0.05,
            vx: _v2.x * 1.6 + (Math.random() - 0.5) * 0.25,
            vy: _v2.y * 1.6 + (Math.random() - 0.5) * 0.25,
            vz: _v2.z * 1.6 + (Math.random() - 0.5) * 0.25,
            life: 1.4, s: 0.6 + Math.random() * 0.8
          });
        }
      }
      for (var i = data.length - 1; i >= 0; i--) {
        var pt = data[i];
        pt.vy -= 7.5 * dt;
        pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
        pt.life -= dt;
        if (pt.life <= 0 || pt.y < -4) data.splice(i, 1);
      }
      mesh.count = data.length;
      for (var m = 0; m < data.length; m++) {
        var q = data[m];
        dummy.position.set(q.x, q.y, q.z);
        var sc = q.s * Math.min(1, q.life * 2);
        dummy.scale.set(sc, sc * 1.4, sc);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(m, dummy.matrix);
      }
      if (data.length) mesh.instanceMatrix.needsUpdate = true;
      this._updateStream(pouring, tiltT);
    }

    _updateStream(pouring, tiltT) {
      var stream = this._stream, core = this._streamCore;
      if (!pouring) {
        stream.material.opacity = Math.max(0, stream.material.opacity - 0.08);
        core.material.opacity = Math.max(0, core.material.opacity - 0.12);
        if (stream.material.opacity <= 0.01) { stream.visible = false; core.visible = false; }
        return;
      }
      var t0 = this._clock.elapsedTime;
      this._mouthAnchor.getWorldPosition(_v1);
      _v2.set(0, 1, 0).applyQuaternion(this._bottle.getWorldQuaternion(_q1));
      var pts = [];
      for (var i = 0; i <= 26; i++) {
        var tt = i * 0.026;
        var y = _v1.y + _v2.y * 1.6 * tt - 0.5 * 7.5 * tt * tt;
        var wob = Math.sin(t0 * 26 + i * 1.7) * 0.006 * (i / 26); // live wobble grows down-stream
        pts.push(new THREE.Vector3(_v1.x + _v2.x * 1.6 * tt + wob, y, _v1.z + _v2.z * 1.6 * tt + wob * 0.6));
        if (y < -3.8) break;
      }
      if (pts.length < 3) return;
      var curve = new THREE.CatmullRomCurve3(pts);
      var geo = new THREE.TubeGeometry(curve, 30, 0.032, 12, false);
      if (stream.geometry) stream.geometry.dispose();
      stream.geometry = geo;
      stream.visible = true;
      var coreGeo = new THREE.TubeGeometry(curve, 30, 0.014, 8, false);
      if (core.geometry) core.geometry.dispose();
      core.geometry = coreGeo;
      core.visible = true;
      var k = Math.min(1, (tiltT - 0.55) * 3.5);
      stream.material.opacity = Math.min(0.55, stream.material.opacity + 0.05) * k;
      core.material.opacity = Math.min(0.9, core.material.opacity + 0.08) * k;
    }
  }

  var _v1, _v2, _v3, _vZ, _q1, _q2;

  // minimal OBJ parser — v/vn/f with o|g groups, fan-triangulated, non-indexed
  function parseOBJGroups(text) {
    var vs = [], ns = [], groups = [], cur = null;
    var start = 0, len = text.length;
    while (start < len) {
      var end = text.indexOf('\n', start);
      if (end === -1) end = len;
      var ln = text.substring(start, end);
      start = end + 1;
      var c0 = ln.charCodeAt(0), c1 = ln.charCodeAt(1);
      if (c0 === 118 && c1 === 32) {          // 'v '
        var p = ln.substring(2).trim().split(/\s+/);
        vs.push(+p[0], +p[1], +p[2]);
      } else if (c0 === 118 && c1 === 110) {  // 'vn'
        var q = ln.substring(3).trim().split(/\s+/);
        ns.push(+q[0], +q[1], +q[2]);
      } else if (c0 === 102 && c1 === 32) {   // 'f '
        if (!cur) { cur = { name: 'default', pos: [], nor: [] }; groups.push(cur); }
        var refs = ln.substring(2).trim().split(/\s+/);
        for (var k = 1; k + 1 < refs.length; k++) {
          pushObjVert(cur, refs[0], vs, ns);
          pushObjVert(cur, refs[k], vs, ns);
          pushObjVert(cur, refs[k + 1], vs, ns);
        }
      } else if ((c0 === 111 || c0 === 103) && c1 === 32) { // 'o ' / 'g '
        cur = { name: ln.substring(2).trim(), pos: [], nor: [] };
        groups.push(cur);
      }
    }
    return groups;
  }
  function pushObjVert(g, ref, vs, ns) {
    var a = ref.split('/');
    var vi = (parseInt(a[0], 10) - 1) * 3;
    g.pos.push(vs[vi], vs[vi + 1], vs[vi + 2]);
    var ni = (parseInt(a[2] || a[0], 10) - 1) * 3;
    g.nor.push(ns[ni] || 0, ns[ni + 1] || 0, ns[ni + 2] === undefined ? 1 : ns[ni + 2]);
  }

  // flat 2D droplet sprite: gradient body, shaded lower rim, bright highlight
  var _dropTex = null;
  function dropletTexture() {
    if (_dropTex) return _dropTex;
    var cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    var g = cv.getContext('2d');
    var grad = g.createRadialGradient(32, 36, 4, 32, 32, 30);
    grad.addColorStop(0, 'rgba(235,244,240,0.10)');
    grad.addColorStop(0.55, 'rgba(226,238,233,0.30)');
    grad.addColorStop(0.85, 'rgba(255,255,255,0.60)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(88,98,88,0.28)';
    g.lineWidth = 3;
    g.beginPath(); g.arc(32, 33, 26, Math.PI * 0.18, Math.PI * 0.82); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath(); g.ellipse(24, 21, 5.5, 9, -0.5, 0, Math.PI * 2); g.fill();
    _dropTex = new THREE.CanvasTexture(cv);
    return _dropTex;
  }

  customElements.define('bottle-3d', Bottle3D);
})();
