/* <bottle-3d> — Mastry 3D bottle web component.
   Transparent-canvas Three.js scene: lathe glass bottle, label texture,
   aluminum ROPP cap, condensation, fizz bubbles, scroll-reactive twist/drift,
   end-of-scroll cap-off (psssht + nucleation burst) + tilt + physical pour
   (tapering jet, Plateau–Rayleigh breakup into droplets, glugging).
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
      if (this._drops) {
        this._drops.count = Math.min(240, Math.round(this._condensation * 70));
        this._drops.visible = this._drops.count > 0;
      }
    }

    /* ---------- scene ---------- */
    _initThree() {
      if (!_v1) { _v1 = new THREE.Vector3(); _v2 = new THREE.Vector3(); _v3 = new THREE.Vector3(); _v4 = new THREE.Vector3(); _v5 = new THREE.Vector3(); _v6 = new THREE.Vector3(); _vZ = new THREE.Vector3(0, 0, 1); _vY = new THREE.Vector3(0, 1, 0); _q1 = new THREE.Quaternion(); _q2 = new THREE.Quaternion(); }
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

      this._buildCapGroups(bottle);
      this._buildBottle(bottle);
      this._buildBubbles(bottle);
      this._buildFizz(bottle);
      this._buildCondensation(bottle);
      this._buildPour(scene);
      this._buildShadow(scene);

      // state
      this._pin = this.closest('.heropin'); // pinned-hero container drives the pour timeline
      this._vel = 0; this._lastScroll = window.scrollY;
      this._frontY = -0.35; // yaw that centres the label's front graphic on camera
      this._rotY = this._frontY; this._driftX = 0; this._driftY = 0; this._tiltV = 0;
      this._capT = 0; this._tiltT = 0;
      this._syncAttrs();
      this._resize();
    }

    _buildBottle(parent) {
      this._buildWater(parent);
      // glass + label + cap come from the user's Blender GLB when provided;
      // the runtime lathe (same silhouette) is the fallback
      var bottleSrc = this.getAttribute('bottle-src') || this.getAttribute('bottlesrc');
      if (bottleSrc && THREE.GLTFLoader) this._buildFromGLB(bottleSrc, parent);
      else this._buildLatheGlass(parent);
    }

    /* glass rendered as three passes over one geometry: tinted back faces,
       clearcoated front faces, and an additive fresnel rim */
    _addGlassShells(parent, glassGeo) {
      var back = new THREE.Mesh(glassGeo, new THREE.MeshPhysicalMaterial({
        color: 0x4e8464, roughness: 0.07, metalness: 0, transparent: true, opacity: 0.55,
        side: THREE.BackSide, envMapIntensity: 0.8, depthWrite: false
      }));
      back.renderOrder = 1;
      parent.add(back);
      var front = new THREE.Mesh(glassGeo, new THREE.MeshPhysicalMaterial({
        color: 0x649a7c, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.5,
        clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.FrontSide,
        envMapIntensity: 1.2, depthWrite: false
      }));
      front.renderOrder = 5;
      parent.add(front);
      var fresnel = new THREE.Mesh(glassGeo, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
        vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float d = 1.0 - abs(dot(normalize(vN), normalize(vV))); float f = pow(d, 2.4); float hot = pow(d, 6.5); vec3 tint = vec3(0.62, 0.88, 0.72); gl_FragColor = vec4(tint * f * 0.78 + vec3(1.0) * hot * 0.62, f * 0.72 + hot * 0.5); }'
      }));
      fresnel.renderOrder = 6;
      parent.add(fresnel);
    }

    _buildFromGLB(src, parent) {
      var self = this;
      new THREE.GLTFLoader().load(src, function (g) {
        g.scene.updateMatrixWorld(true);
        var prims = [];
        g.scene.traverse(function (o) { if (o.isMesh) prims.push(o); });
        var box = new THREE.Box3().setFromObject(g.scene);
        if (!prims.length || box.isEmpty()) return fail();
        // normalize the whole model: base at y=0, total height H, centred on the axis
        var s = H / (box.max.y - box.min.y);
        var norm = new THREE.Matrix4().makeScale(s, s, s).multiply(
          new THREE.Matrix4().makeTranslation(
            -(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
        prims.forEach(function (o) {
          var geo = o.geometry.clone();
          geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld));
          var name = ((o.material && o.material.name) || '').toLowerCase();
          if (name.indexOf('glass') !== -1) {
            self._addGlassShells(parent, geo);
          } else if (name.indexOf('cap') !== -1) {
            var cm = o.material;
            cm.transmission = 0; // transmission breaks over the transparent canvas
            cm.envMapIntensity = 1.3;
            var capMesh = new THREE.Mesh(geo, cm);
            capMesh.scale.set(1.05, 1, 1.05); // radial room so the glass lip sits inside the cap
            capMesh.position.y = -self._capBaseY; // the cap group carries the animation
            self._cap.add(capMesh);
            self._hasGLBCap = true;
          } else {
            // the modelled label, UV-mapped with the real artwork
            var lm = o.material;
            lm.envMapIntensity = 0.3;
            if (lm.map) lm.map.anisotropy = self._renderer.capabilities.getMaxAnisotropy();
            var labelMesh = new THREE.Mesh(geo, lm);
            labelMesh.renderOrder = 3;
            parent.add(labelMesh);
          }
        });
        if (!self._hasGLBCap) self._loadCapOBJ();
      }, undefined, fail);
      function fail() { self._buildLatheGlass(parent); }
    }

    _buildLatheGlass(parent) {
      var pts = PROFILE.map(function (p) { return new THREE.Vector2(p[0], p[1]); });
      this._addGlassShells(parent, new THREE.LatheGeometry(pts, 144));
      // label: wrap texture on a PROFILE-sized cylinder
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
      this._loadCapOBJ();
    }

    _buildWater(parent) {
      var wpts = [];
      for (var y = 0.08; y <= 2.32; y += 0.08) wpts.push(new THREE.Vector2(radiusAt(y) * 0.90, y));
      wpts.push(new THREE.Vector2(radiusAt(2.32) * 0.90, 2.32));
      var water = new THREE.Mesh(new THREE.LatheGeometry(wpts, 96), new THREE.MeshPhysicalMaterial({
        color: 0xa7cbb4, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.3,
        envMapIntensity: 1.1, depthWrite: false, side: THREE.DoubleSide,
        clippingPlanes: [this._waterPlane]
      }));
      water.renderOrder = 2;
      parent.add(water);
      this._water = water;
      this._level = 1; // 1 = full; drains toward 0.32 while pouring
      var top = new THREE.Mesh(new THREE.CircleGeometry(radiusAt(2.32) * 0.90, 48),
        new THREE.MeshPhysicalMaterial({ color: 0xdfeee6, roughness: 0.04, transparent: true, opacity: 0.25, envMapIntensity: 1.2, depthWrite: false }));
      top.rotation.x = -Math.PI / 2; top.position.y = 2.32; top.renderOrder = 2;
      parent.add(top);
      this._waterTop = top;

      // screw-top neck finish: the GLB glass ends where the cap begins, so we
      // continue it — neck wall, a true helical screw thread, and a rolled
      // mouth lip — all sitting inside the cap until it unscrews
      // top trimmed down ~0.11 so the whole finish tucks well inside the cap
      var neckPts = [
        new THREE.Vector2(0.204, 2.96),   // blends over the glass cut
        new THREE.Vector2(0.188, 2.995),
        new THREE.Vector2(0.180, 3.03),
        new THREE.Vector2(0.180, 3.09),
        new THREE.Vector2(0.186, 3.115),
        new THREE.Vector2(0.186, 3.14),
        new THREE.Vector2(0.158, 3.14)    // rim turns in toward the bore
      ];
      this._addGlassShells(parent, new THREE.LatheGeometry(neckPts, 64));
      // the screw imprint the cap grips: 1.75 turns of glass helix
      var helixPts = [];
      var H0 = 2.98, H1 = 3.09;
      for (var hi = 0; hi <= 64; hi++) {
        var ht = hi / 64;
        var ang = ht * Math.PI * 2 * 1.75;
        helixPts.push(new THREE.Vector3(Math.cos(ang) * 0.186, H0 + (H1 - H0) * ht, Math.sin(ang) * 0.186));
      }
      var screw = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helixPts), 96, 0.0085, 8, false),
        new THREE.MeshPhysicalMaterial({ color: 0xd9e8dc, roughness: 0.08, transparent: true, opacity: 0.6, envMapIntensity: 1.6, depthWrite: false }));
      screw.renderOrder = 5;
      parent.add(screw);
      // rolled lip at the mouth
      var mouth = new THREE.Mesh(new THREE.TorusGeometry(0.176, 0.013, 10, 48),
        new THREE.MeshPhysicalMaterial({ color: 0xdfe5dc, roughness: 0.1, transparent: true, opacity: 0.55, envMapIntensity: 1.6 }));
      mouth.rotation.x = Math.PI / 2; mouth.position.y = 3.14; mouth.renderOrder = 5;
      parent.add(mouth);
      this._mouthAnchor = new THREE.Object3D();
      this._mouthAnchor.position.set(0, 3.18, 0);
      parent.add(this._mouthAnchor);
    }

    _buildCapGroups(parent) {
      // Spinning parts go in this._cap; tamper ring + bridges stay fixed on the neck.
      this._capBaseY = 3.0; // skirt starts at the lip bead; dome fully covers the 3.26 mouth
      this._parentForCap = parent;
      var cap = new THREE.Group();
      cap.position.y = this._capBaseY;
      parent.add(cap);
      this._cap = cap;
      var fixed = new THREE.Group();
      fixed.position.y = this._capBaseY;
      parent.add(fixed);
      this._capFixed = fixed;
    }

    _loadCapOBJ() {
      // max-LOD OBJ cap (assets/cap.obj); procedural fallback below
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
      var S = 0.0152; // model Ø31.8 mm, sized so the dome clears the glass mouth
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
        new THREE.MeshBasicMaterial({ color: 0xeaf6ef, transparent: true, opacity: 0.3, depthWrite: false, clippingPlanes: [this._waterPlane] }), COUNT);
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

    _buildFizz(parent) {
      // event bubbles, separate from the ambient column: the cap-off burst
      // firing every nucleation site at once, and the fat air slugs that
      // glug back in through the neck while pouring
      var MAX = 130;
      var mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.013, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xdff1e4, transparent: true, opacity: 0.6, depthWrite: false, clippingPlanes: [this._waterPlane] }), MAX);
      mesh.count = 0;
      mesh.renderOrder = 4;
      parent.add(mesh);
      this._fizz = mesh;
      this._fizzData = [];
    }

    _buildCondensation(parent) {
      // real droplets: tiny glass hemispheres that condense, grow, run down the
      // glass under gravity, and shrink away once they reach the bottom
      var MAX = 240;
      var mesh = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, 8, 6),
        new THREE.MeshPhysicalMaterial({
          color: 0xeef6f0, transparent: true, opacity: 0.55,
          roughness: 0.04, metalness: 0, envMapIntensity: 2.4,
          clearcoat: 1, clearcoatRoughness: 0.04, depthWrite: false
        }), MAX);
      mesh.renderOrder = 6;
      parent.add(mesh);
      this._drops = mesh;
      this._dropData = [];
      var dummy = new THREE.Object3D();
      for (var i = 0; i < MAX; i++) {
        var d = this._spawnDrop(i < 12);
        d.sc = d.target * (0.35 + Math.random() * 0.65); // page opens mid-condensation
        this._dropData.push(d);
        this._placeDrop(dummy, d, i);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this._dropDummy = dummy;
    }

    _spawnDrop(runner) {
      var y = 0.2 + Math.random() * 2.5;
      // fewer drops over the label band
      if (y > 0.66 && y < 1.84 && Math.random() < 0.7) y = Math.random() < 0.5 ? 0.2 + Math.random() * 0.44 : 1.86 + Math.random() * 0.8;
      return {
        a: Math.random() * Math.PI * 2,
        y: y,
        target: runner ? 0.024 + Math.random() * 0.016 : 0.006 + Math.random() * 0.013,
        sc: 0.0015,                            // condenses in from almost nothing
        grow: 0.10 + Math.random() * 0.22,     // relative growth per second
        st: runner ? 0.02 : 0.3 + Math.random() * 0.6, // stiction before it slides
        v: 0.15 + Math.random() * 0.3,
        wob: Math.random() * Math.PI * 2,
        sliding: false, dying: false, runner: runner
      };
    }

    _placeDrop(dummy, d, i) {
      var r = radiusAt(d.y) + d.sc * 0.18;
      dummy.position.set(Math.cos(d.a) * r, d.y, Math.sin(d.a) * r);
      dummy.lookAt(Math.cos(d.a) * (r + 1), d.y, Math.sin(d.a) * (r + 1));
      var sag = d.sliding ? 1.65 : 1.0 + (d.sc / (d.target || 1)) * 0.3; // heavy drops sag, runners stretch
      dummy.scale.set(d.sc, d.sc * sag, d.sc * 0.5); // flattened against the glass
      dummy.updateMatrix();
      this._drops.setMatrixAt(i, dummy.matrix);
    }

    _buildPour(scene) {
      // shared instanced pool: pour droplets, satellite drops, cap-off mist
      var MAX = 220;
      var mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xf6fbf6, transparent: true, opacity: 0.75, depthWrite: false }), MAX);
      mesh.renderOrder = 7;
      mesh.count = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this._pour = mesh;
      this._pourData = [];
      this._pourClock = 0;
      this._glugPhase = 0; this._glugCool = 0;
      this._fizzBurst = 0; this._fizzArmed = false; this._fizzClock = 0;
      // continuous jet: pre-allocated tube whose ring positions are rewritten
      // in place each frame — no geometry churn. The jet tapers as gravity
      // accelerates it (mass conservation), a Plateau–Rayleigh varicose wave
      // deepens down-stream, and past the breakup length it hands over to
      // the droplet pool above.
      var RINGS = this._strRings = 64, SEG = this._strSeg = 10;
      function tubeGeo(withNormals) {
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RINGS * SEG * 3), 3).setUsage(THREE.DynamicDrawUsage));
        if (withNormals) geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(RINGS * SEG * 3), 3).setUsage(THREE.DynamicDrawUsage));
        var idx = [];
        for (var i = 0; i < RINGS - 1; i++) {
          for (var j = 0; j < SEG; j++) {
            var a = i * SEG + j, b = i * SEG + (j + 1) % SEG;
            idx.push(a, a + SEG, b, b, a + SEG, b + SEG);
          }
        }
        geo.setIndex(idx);
        geo.setDrawRange(0, 0);
        return geo;
      }
      var stream = new THREE.Mesh(tubeGeo(true), new THREE.MeshPhysicalMaterial({
        color: 0xdceede, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.0,
        envMapIntensity: 2.0, clearcoat: 1, clearcoatRoughness: 0.06, depthWrite: false
      }));
      stream.renderOrder = 7;
      stream.visible = false;
      stream.frustumCulled = false;
      scene.add(stream);
      this._stream = stream;
      // bright inner core — reads as solid liquid inside the sheath
      var core = new THREE.Mesh(tubeGeo(false), new THREE.MeshBasicMaterial({
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
      // drag to spin, with flick inertia
      this._spinVel = 0;
      var dragging = false, lastX = 0, lastT = 0;
      this.addEventListener('pointerdown', function (e) {
        dragging = true; self._dragging = true; lastX = e.clientX; lastT = performance.now();
        self._spinVel = 0;
        if (self.setPointerCapture && e.pointerId !== undefined) {
          try { self.setPointerCapture(e.pointerId); } catch (_) {}
        }
      });
      window.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        var now = performance.now();
        var dx = e.clientX - lastX;
        self._rotY += dx * 0.012;                                  // direct spin under the cursor
        self._spinVel = (dx / Math.max(1, now - lastT)) * 12;      // flick momentum
        lastX = e.clientX; lastT = now;
      });
      window.addEventListener('pointerup', function () { dragging = false; self._dragging = false; });
      window.addEventListener('pointercancel', function () { dragging = false; self._dragging = false; });
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
      this._narrow = window.innerWidth <= 760;
      // the canvas spans the whole pinned hero so the pour can run off the
      // frame; push the camera back so the bottle keeps the size it had when
      // the canvas was only the centre stage box
      var ref = this._narrow ? Math.min(h * 0.52, 440) : Math.min(h * 0.8, 780);
      this._camera.position.z = 8.3 * (h / Math.max(1, ref));
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
    }

    /* ---------- per-frame ---------- */
    _tick() {
      if (this._hidden || this._offscreen) { this._clock.getDelta(); return; }
      var dt = Math.min(0.05, this._clock.getDelta());
      var t = this._clock.elapsedTime;

      // scroll physics
      var vel = this._vel;
      this._vel *= Math.pow(0.0018, dt); // exponential decay
      var p;
      if (this._pin) {
        // progress through the pinned hero (≈3 screens of scroll)
        var span = Math.max(1, this._pin.offsetHeight - window.innerHeight);
        p = Math.min(1, Math.max(0, (window.scrollY - this._pin.offsetTop) / span));
      } else {
        var doc = document.scrollingElement;
        var max = Math.max(1, doc.scrollHeight - window.innerHeight);
        p = Math.min(1, Math.max(0, window.scrollY / max));
      }

      // twist: scroll up → twist right, scroll down → twist left (reversed)
      this._rotY += -vel * 0.0018 * dt * 60 * 0.016;
      this._rotY += this._spinVel * dt;                 // flick inertia from drag
      this._spinVel *= Math.pow(0.12, dt);              // spins down gradually
      // settle brand-front: once scroll and drag go quiet, ease to the nearest
      // front-facing turn so the label never parks on the barcode side
      var TAU = Math.PI * 2;
      var home = this._frontY + Math.round((this._rotY - this._frontY) / TAU) * TAU;
      var quiet = this._dragging ? 0 :
        Math.max(0, 1 - Math.abs(vel) * 0.02 - Math.abs(this._spinVel) * 2);
      this._rotY += (home - this._rotY) * (1 - Math.pow(0.5, dt)) * quiet;
      // living sway — the bottle breathes but never turns its back
      this._spin.rotation.y = this._rotY + Math.sin(t * 0.4) * 0.05 * this._spinSpeed;

      // gentle drift with velocity — heavily damped so wheel notches read as
      // one continuous glide instead of dart-and-snap-back
      var targY = Math.max(-0.16, Math.min(0.16, -vel * 0.0028));
      var targX = Math.max(-0.09, Math.min(0.09, -vel * 0.0015));
      var targTilt = Math.max(-0.045, Math.min(0.045, vel * 0.0003));
      this._driftY = lerp(this._driftY, targY, 1 - Math.pow(0.05, dt));
      this._driftX = lerp(this._driftX, targX, 1 - Math.pow(0.05, dt));
      this._tiltV = lerp(this._tiltV, targTilt, 1 - Math.pow(0.05, dt));

      // finale: cap off, tilt, pour — with a pour budget: once ~500ml is out, settle back upright
      var capGoal = this._pourEnabled ? smoothstep(0.34, 0.58, p) : 0;
      var tiltGoal = this._pourEnabled ? smoothstep(0.56, 0.80, p) : 0;
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

      // carbonation release: the instant the seal cracks, CO2 mist jets from
      // the mouth and every nucleation site in the bottle fires at once;
      // re-arms whenever the cap screws back down (scrolling back up)
      if (!this._fizzArmed && capT < 0.06) this._fizzArmed = true;
      if (this._fizzArmed && capT > 0.18) {
        this._fizzArmed = false;
        this._fizzBurst = 1;
        this._spawnMist();
      }
      if (this._fizzBurst > 0) this._fizzBurst = Math.max(0, this._fizzBurst - dt * 0.4);

      // root placement — while tipping, the bottle slides so its mouth ends
      // over the glass line (30% of the viewport from the left), where the
      // next section's glass waits to catch the pour
      var offsetX = this._narrow ? this._offsetX * 0.25 : this._offsetX;
      var bob = Math.sin(t * 0.8) * 0.05;
      var halfW = this._camera.position.z * 0.2867 * this._camera.aspect;
      // glass line: 30% of the viewport on desktop, 16% on phones
      var pourX = (this._narrow ? -0.68 : -0.4) * halfW + 1.44; // mouth swings ~1.44 left of root at full tilt
      this._root.position.x = offsetX + this._driftX + tiltT * pourX;
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

      // bubbles — 2x speed and 2x count once the cap is off, plus a hard
      // surge while the cap-off fizz burst is live
      var surge = (Math.min(3.5, Math.abs(vel) * 0.012) + tiltT * 3.0) * (1 + capT) + this._fizzBurst * 5;
      this._bubbles.count = Math.min(this._bubbleData.length, Math.round(this._bubbleBase * (1 + capT + this._fizzBurst)));
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

      // condensation — droplet lifecycle: condense in, grow until heavy, run
      // downhill (meandering) under bottle-space gravity, vanish at the bottom
      if (this._drops.count > 0) {
      this._bottle.getWorldQuaternion(_q1);
      _v1.set(0, -1, 0).applyQuaternion(_q1.invert()); // world-down in bottle-local axes
      var agitation = smoothstep(0.10, 0.85, Math.abs(this._root.rotation.z)) + Math.min(0.6, Math.abs(vel) * 0.0015);
      var dd = this._dropData;
      for (var j = 0; j < dd.length; j++) {
        var d = dd[j];
        if (d.dying) {
          d.sc -= (d.target || 0.01) * dt * 3.2; // soaks away
          if (d.sc <= 0.0015) dd[j] = d = this._spawnDrop(d.runner);
          this._placeDrop(dummy, d, j);
          continue;
        }
        if (d.sc < d.target) d.sc = Math.min(d.target, d.sc + d.target * d.grow * dt);
        // fully grown drops get heavy enough to creep even on a still bottle
        var heavy = (d.sc >= d.target * 0.98) ? (d.runner ? 0.22 : 0.03) : 0;
        var free = Math.max(0, agitation - d.st) + heavy;
        d.sliding = free > 0.02;
        if (d.sliding) {
          d.wob += dt * 3;
          var rr = Math.max(0.15, radiusAt(d.y) + 0.006);
          var ga = _v1.x * (-Math.sin(d.a)) + _v1.z * Math.cos(d.a); // downhill around the barrel
          d.a += ((ga / rr) * free * d.v + Math.sin(d.wob) * 0.10 * free) * dt * 2.4; // meanders as it runs
          d.y += _v1.y * free * d.v * dt * 2.4;
          if (d.y < 0.16 || d.y > 3.0) { d.dying = true; d.y = Math.min(3.0, Math.max(0.16, d.y)); }
        }
        this._placeDrop(dummy, d, j);
      }
      this._drops.instanceMatrix.needsUpdate = true;
      }

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
      var time = this._clock.elapsedTime;

      // pour strength = how far past the pour threshold the tilt is, scaled
      // by how much head of water is left to feed the stream — the pour
      // peters out into drips as the bottle empties
      var head = smoothstep(0.20, 0.42, this._level);
      var ps = smoothstep(0.58, 0.96, tiltT) * head;
      var pouring = tiltT > 0.58 && this._level > 0.201 && ps > 0.003;

      // glug: near-horizontal the mouth runs full of water, so air can only
      // get back in by starving the flow in pulses (glug… glug…)
      var flow = 1;
      if (pouring) {
        var glugAmp = smoothstep(0.80, 0.97, tiltT) * smoothstep(0.24, 0.40, this._level);
        this._glugPhase += dt * (5.2 + 2.2 * ps);
        var gl = 0.5 + 0.5 * Math.sin(this._glugPhase);
        flow = 1 - glugAmp * 0.45 * (1 - gl * gl);
        this._glugCool -= dt;
        if (glugAmp > 0.25 && gl < 0.12 && this._glugCool <= 0) {
          this._glugCool = 0.45;
          this._spawnGlugAir();
        }
        this._level = Math.max(0.20, this._level - dt * (0.08 + 0.30 * ps * flow));
      }

      var bk = this._updateStream(pouring, ps, flow, time);

      // past the breakup point the jet pinches into main drops + satellites
      if (pouring && bk) {
        this._pourClock += dt * (24 + 190 * ps);
        var n = Math.floor(this._pourClock);
        this._pourClock -= n;
        for (var k = 0; k < n && data.length < mesh.instanceMatrix.count - 60; k++) {
          var sat = Math.random() < 0.35;
          var jr = bk.r * 1.4;
          data.push({
            x: bk.x + (Math.random() - 0.5) * jr, y: bk.y + (Math.random() - 0.5) * jr, z: bk.z + (Math.random() - 0.5) * jr,
            vx: bk.vx + (Math.random() - 0.5) * 0.22,
            vy: bk.vy + (Math.random() - 0.5) * 0.22,
            vz: bk.vz + (Math.random() - 0.5) * 0.22,
            life: 1.6, l0: 1.6,
            s: Math.min(3.8, (sat ? 0.42 : 0.95) * bk.r * 94 * (0.8 + Math.random() * 0.4)),
            g: 16, drag: 0.9, mist: false
          });
        }
      }

      // integrate droplets & mist
      for (var i = data.length - 1; i >= 0; i--) {
        var pt = data[i];
        pt.vy -= pt.g * dt; // per-particle gravity: pour drops 16, spit 7.5, mist floats
        var dg = Math.pow(pt.drag, dt);
        pt.vx *= dg; pt.vy *= dg; pt.vz *= dg;
        pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.z += pt.vz * dt;
        pt.life -= dt;
        if (pt.life <= 0 || pt.y < -8.5) data.splice(i, 1);
      }
      mesh.count = data.length;
      for (var m = 0; m < data.length; m++) {
        var q = data[m];
        var vm = Math.sqrt(q.vx * q.vx + q.vy * q.vy + q.vz * q.vz), sc;
        dummy.position.set(q.x, q.y, q.z);
        if (q.mist) {
          // gas puff: expands as it dissipates, fades out fast
          sc = q.s * (1 + (1 - q.life / q.l0) * 2.2) * Math.min(1, q.life * 3);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(sc, sc, sc);
        } else {
          // falling drop: prolate, stretched along its velocity
          sc = q.s * Math.min(1, q.life * 2);
          if (vm > 0.01) { _v4.set(q.vx / vm, q.vy / vm, q.vz / vm); dummy.quaternion.setFromUnitVectors(_vY, _v4); }
          dummy.scale.set(sc, sc * (1 + Math.min(0.9, vm * 0.14)), sc);
        }
        dummy.updateMatrix();
        mesh.setMatrixAt(m, dummy.matrix);
      }
      if (data.length) mesh.instanceMatrix.needsUpdate = true;

      this._updateFizz(dt);
    }

    _spawnMist() {
      // psssht — CO2 mist and a few flung droplets jet from the mouth the
      // moment the seal cracks
      this._mouthAnchor.getWorldPosition(_v1);
      this._bottle.getWorldQuaternion(_q1);
      var data = this._pourData, cap = this._pour.instanceMatrix.count;
      for (var i = 0; i < 56 && data.length < cap; i++) {
        var spit = i < 8; // a few real droplets ride out with the gas
        var ang = Math.random() * Math.PI * 2;
        var spread = (spit ? 0.3 : 0.6) * Math.pow(Math.random(), 0.7);
        _v3.set(Math.cos(ang) * spread, 1, Math.sin(ang) * spread).normalize().applyQuaternion(_q1);
        var sp = spit ? 1.1 + Math.random() * 0.9 : 1.5 + Math.random() * 2.0;
        var life = spit ? 0.9 : 0.3 + Math.random() * 0.4;
        data.push({
          x: _v1.x + (Math.random() - 0.5) * 0.05,
          y: _v1.y + (Math.random() - 0.5) * 0.02,
          z: _v1.z + (Math.random() - 0.5) * 0.05,
          vx: _v3.x * sp, vy: _v3.y * sp, vz: _v3.z * sp,
          life: life, l0: life,
          s: spit ? 0.5 + Math.random() * 0.4 : 0.13 + Math.random() * 0.2,
          g: spit ? 7.5 : 0.8, drag: spit ? 0.55 : 0.008, mist: !spit
        });
      }
    }

    _spawnGlugAir() {
      // the glug is air forcing its way back through the neck: a few fat
      // bubbles wobble from the mouth toward the trapped air pocket, i.e.
      // world-up expressed in bottle space
      this._bottle.getWorldQuaternion(_q1);
      _v1.set(0, 1, 0).applyQuaternion(_q1.invert());
      var fd = this._fizzData, cap = this._fizz.instanceMatrix.count;
      var n = 2 + Math.floor(Math.random() * 3);
      for (var i = 0; i < n && fd.length < cap; i++) {
        var ang = Math.random() * Math.PI * 2, rr = Math.random() * 0.06;
        fd.push({
          x: Math.cos(ang) * rr, y: 2.5 + Math.random() * 0.35, z: Math.sin(ang) * rr,
          dx: _v1.x, dy: _v1.y, dz: _v1.z,
          v: 1.0 + Math.random() * 0.8, s: 2.4 + Math.random() * 1.8,
          life: 1.4, w: Math.random() * Math.PI * 2, pop: false
        });
      }
    }

    _updateFizz(dt) {
      var mesh = this._fizz, fd = this._fizzData, dummy = this._dropDummy;
      if (this._fizzBurst > 0.02) {
        // cap-off burst: nucleation sites on the glass wall and base fire
        // streams of fast-rising bubbles for a couple of seconds
        this._fizzClock += dt * this._fizzBurst * 70;
        var n = Math.floor(this._fizzClock);
        this._fizzClock -= n;
        var wl = Math.min(this._waterLocalY || 2.28, 2.28);
        for (var k = 0; k < n && fd.length < mesh.instanceMatrix.count; k++) {
          var wall = Math.random() < 0.72;
          var y = wall ? 0.15 + Math.random() * Math.max(0.2, wl - 0.5) : 0.10 + Math.random() * 0.25;
          var ang = Math.random() * Math.PI * 2;
          var rr = radiusAt(y) * (wall ? 0.80 + Math.random() * 0.08 : Math.random() * 0.5);
          fd.push({
            x: Math.cos(ang) * rr, y: y, z: Math.sin(ang) * rr,
            dx: 0, dy: 1, dz: 0,
            v: 0.5 + Math.random() * 0.8, s: 1.0 + Math.random() * 1.6,
            life: 6, w: Math.random() * Math.PI * 2, pop: true
          });
        }
      }
      var wrap = Math.min(this._waterLocalY || 2.28, 2.30);
      for (var i = fd.length - 1; i >= 0; i--) {
        var b = fd[i];
        b.w += dt * 7;
        b.v += dt * 0.45;             // buoyancy: they accelerate as they rise
        b.s += dt * 0.22;             // and swell as the pressure drops
        b.x += (b.dx * b.v + Math.sin(b.w) * 0.06) * dt;
        b.y += b.dy * b.v * dt;
        b.z += (b.dz * b.v + Math.cos(b.w * 0.9) * 0.06) * dt;
        // glass is a wall: hold every bubble inside the profile, which also
        // funnels the swarm through the shoulder as the neck narrows
        var rMax = radiusAt(Math.min(Math.max(b.y, 0), H)) * 0.84;
        var rr = Math.sqrt(b.x * b.x + b.z * b.z);
        if (rr > rMax && rr > 0) { b.x *= rMax / rr; b.z *= rMax / rr; }
        b.life -= dt;
        if (b.life <= 0 || (b.pop && b.y >= wrap)) { fd.splice(i, 1); continue; }
      }
      mesh.count = fd.length;
      for (var m = 0; m < fd.length; m++) {
        var q = fd[m];
        dummy.position.set(q.x, q.y, q.z);
        var sq = 1 + Math.sin(q.w * 1.7) * 0.18; // wobbling squash & stretch
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(q.s * sq, q.s / sq, q.s * sq);
        dummy.updateMatrix();
        mesh.setMatrixAt(m, dummy.matrix);
      }
      if (fd.length) mesh.instanceMatrix.needsUpdate = true;
    }

    /* rebuilds the jet in place; returns the breakup point + velocity so the
       droplet system can take over where the continuous stream pinches off */
    _updateStream(pouring, ps, flow, time) {
      var stream = this._stream, core = this._streamCore;
      if (!pouring) {
        stream.material.opacity = Math.max(0, stream.material.opacity - 0.08);
        core.material.opacity = Math.max(0, core.material.opacity - 0.12);
        if (stream.material.opacity <= 0.01) { stream.visible = false; core.visible = false; }
        return null;
      }
      this._mouthAnchor.getWorldPosition(_v1);
      this._bottle.getWorldQuaternion(_q1);
      _v2.set(0, 1, 0).applyQuaternion(_q1);          // mouth axis, world
      // water leaves over the LOW edge of the lip, not the mouth centre
      _v3.set(0, -1, 0).addScaledVector(_v2, _v2.y);  // world-down projected onto the mouth plane
      if (_v3.lengthSq() > 1e-6) _v3.normalize(); else _v3.set(0, 0, 0);
      var ex = _v1.x + _v3.x * 0.10, ey = _v1.y + _v3.y * 0.10, ez = _v1.z + _v3.z * 0.10;
      // exit speed & thickness ride the pour strength and the glug pulse.
      // GP is pour gravity: the bottle is ~25cm tall so scene gravity feels
      // moon-weak on a water jet — pump it so the arc bends down decisively
      var GP = 16;
      var v0 = (0.55 + 0.95 * ps) * (0.82 + 0.18 * flow);
      var r0 = (0.016 + 0.062 * ps) * (0.55 + 0.45 * flow);
      // weak pours droop off the lip; hard pours jet along the axis
      var droop = 0.55 * (1 - ps);
      _v4.set(_v2.x + _v3.x * droop, _v2.y + _v3.y * droop, _v2.z + _v3.z * droop).normalize();
      var vx = _v4.x * v0, vy = _v4.y * v0, vz = _v4.z * v0;
      // breakup length: fat fast jets hold together, thin dribbles pinch off
      // almost immediately. At full pour the jet stays coherent all the way
      // off the bottom of the frame — it hands over to the glass below
      var Lb = Math.min(1.9 + 5.2 * ps, Math.max(0.14, 9 * v0 * Math.pow(r0, 0.75) * (1 + 2.2 * ps)));

      var posA = stream.geometry.attributes.position.array;
      var norA = stream.geometry.attributes.normal.array;
      var posC = core.geometry.attributes.position.array;
      var RINGS = this._strRings, SEG = this._strSeg, TSTEP = 0.016;
      var edgeY = -(this._camera.position.z * 0.2867 + 1.0); // just past the frame bottom
      var s = 0, nr = 0, bk = null;
      for (var i = 0; i < RINGS; i++) {
        var tt = i * TSTEP;
        var wx = ex + vx * tt, wy = ey + vy * tt - 0.5 * GP * tt * tt, wz = ez + vz * tt;
        var cvx = vx, cvy = vy - GP * tt, cvz = vz;
        var spd = Math.sqrt(cvx * cvx + cvy * cvy + cvz * cvz);
        if (i > 0) s += spd * TSTEP;
        // mass conservation: the jet thins as gravity stretches it
        var rBase = r0 * Math.sqrt(v0 / Math.max(v0, spd));
        var frac = s / Lb;
        // Plateau–Rayleigh varicose wave rides down the jet and deepens;
        // wavelength ≈ 9x jet radius, travelling with the flow
        var r = rBase * (1 + (0.08 + 0.95 * frac * frac) * 0.42 * Math.sin(s * 10.5 - time * 30));
        if (frac > 0.78) r *= Math.max(0.10, 1 - (frac - 0.78) * 3.6); // necks into the pinch-off
        if (r < 0.003) r = 0.003;
        // lateral wander grows down-stream
        var lat = Math.sin(s * 7.5 - time * 11) * 0.016 * frac;
        _v4.set(cvx / spd, cvy / spd, cvz / spd);
        if (Math.abs(_v4.y) > 0.985) _v5.set(1, 0, 0); else _v5.set(0, 1, 0);
        _v6.crossVectors(_v4, _v5).normalize();
        _v5.crossVectors(_v6, _v4);
        wx += _v6.x * lat; wy += _v6.y * lat; wz += _v6.z * lat;
        for (var j = 0; j < SEG; j++) {
          var a2 = j / SEG * Math.PI * 2;
          var ca = Math.cos(a2), sa = Math.sin(a2);
          var nx = _v6.x * ca + _v5.x * sa, ny = _v6.y * ca + _v5.y * sa, nz = _v6.z * ca + _v5.z * sa;
          var o = (i * SEG + j) * 3;
          posA[o] = wx + nx * r; posA[o + 1] = wy + ny * r; posA[o + 2] = wz + nz * r;
          norA[o] = nx; norA[o + 1] = ny; norA[o + 2] = nz;
          var rc = r * 0.42;
          posC[o] = wx + nx * rc; posC[o + 1] = wy + ny * rc; posC[o + 2] = wz + nz * rc;
        }
        nr = i + 1;
        if (s >= Lb || wy < edgeY) {
          if (s >= Lb) bk = { x: wx, y: wy, z: wz, vx: cvx, vy: cvy, vz: cvz, r: rBase };
          break;
        }
      }
      if (!bk && nr === RINGS) {
        // ran out of rings before the jet broke — hand over where the tube ends
        var lt = (RINGS - 1) * TSTEP;
        bk = { x: ex + vx * lt, y: ey + vy * lt - 0.5 * GP * lt * lt, z: ez + vz * lt, vx: vx, vy: vy - GP * lt, vz: vz, r: 0.003 };
      }
      if (nr < 2) { stream.visible = false; core.visible = false; return bk; }
      stream.geometry.setDrawRange(0, (nr - 1) * SEG * 6);
      core.geometry.setDrawRange(0, (nr - 1) * SEG * 6);
      stream.geometry.attributes.position.needsUpdate = true;
      stream.geometry.attributes.normal.needsUpdate = true;
      core.geometry.attributes.position.needsUpdate = true;
      stream.visible = true; core.visible = true;
      // faint for a dribble, solid for a committed pour — but always
      // translucent enough to read as water, not paint
      var k = Math.min(1, 0.3 + ps * 4);
      stream.material.opacity = Math.min(0.55 * k, stream.material.opacity + 0.06);
      core.material.opacity = Math.min(0.5 * k, core.material.opacity + 0.08);
      return bk;
    }
  }

  var _v1, _v2, _v3, _v4, _v5, _v6, _vZ, _vY, _q1, _q2;

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

  customElements.define('bottle-3d', Bottle3D);
})();
