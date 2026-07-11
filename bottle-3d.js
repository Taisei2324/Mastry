/* <bottle-3d> — Mastry 3D bottle web component.
   Transparent-canvas Three.js scene: lathe glass bottle, label texture,
   aluminum ROPP cap, condensation, fizz bubbles, scroll-reactive twist/drift,
   end-of-scroll cap-off (psssht + nucleation burst) + tilt + physical pour
   (tapering jet, Plateau–Rayleigh breakup into droplets, glugging).
   Requires global THREE (three r147). */
(function () {
  'use strict';
  if (customElements.get('bottle-3d')) return;

  // every visit begins at the top: the hero pour is the front door. Browsers
  // restore the old scroll position on reload, which respawns the reader
  // halfway down with the story (and THE WALL) skipped — so restoration is
  // taken over and the page always opens fresh. Deep links with a #hash
  // keep their destination.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (!location.hash) window.scrollTo(0, 0);
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted || location.hash) return; // bfcache restore: same rule
    window.scrollTo(0, 0);
    var b = document.querySelector('bottle-3d');
    if (b) { b._level = 1; b._wallT = 0; } // full bottle, wall re-armed
  });

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

  /* ── shared water-realism shaders (bottle + tumbler) ──────────────────
     Injected into the EXISTING water MeshPhysicalMaterials via
     onBeforeCompile using r147 chunk names (common / begin_vertex /
     output_fragment), so the PMREM env, the ACES+sRGB output tail and
     the _waterPlane clip keep working untouched. `holder` (the custom
     element instance) receives ._waterUniforms / ._waterTopUniforms
     once the program first compiles — feed them per frame from _tick.
     Body: Beer-Lambert depth absorption with a 25% reflection floor
     (mix(1,absorb,0.75)) so grazing env highlights never dull to mud,
     fresnel silhouette density, and a caustic band pinned to
     uWaterlineY. Alpha is capped at 0.72 so nothing goes inky over the
     cream page. */
  function installWaterBodyShader(mat, holder) {
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uWaterlineY = { value: 2.32 };
      shader.uniforms.uBaseY = { value: 0.0 };
      shader.uniforms.uTime = { value: 0.0 };
      shader.uniforms.uAgitate = { value: 0.0 };
      holder._waterUniforms = shader.uniforms;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPosW;')
        .replace('#include <begin_vertex>',
                 '#include <begin_vertex>\n  vWPosW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\nvarying vec3 vWPosW;\nuniform float uWaterlineY, uBaseY, uTime, uAgitate;')
        .replace('#include <output_fragment>', [
          'vec3  V     = normalize( vViewPosition );',
          'float ndv   = abs( dot( normalize( normal ), V ) );',
          'float fres  = pow( 1.0 - ndv, 3.0 );',
          'float wy    = vWPosW.y;',
          'float d     = wy - uWaterlineY;',
          'float depth = clamp( ( uWaterlineY - wy ) / max( 0.05, uWaterlineY - uBaseY ), 0.0, 1.0 );',
          'float thick = depth * 0.9 + fres * 0.8;',
          'vec3  absorb = exp( -vec3( 0.42, 0.14, 0.28 ) * thick );',
          'vec3  col    = outgoingLight * mix( vec3( 1.0 ), absorb, 0.75 );',
          'float line   = exp( -( d * d ) / ( 0.020 * 0.020 ) );',
          'float shim   = 0.7 + 0.3 * sin( wy * 38.0 + uTime * 5.0 );',
          'col += vec3( 0.34, 0.40, 0.36 ) * line * ( 0.35 + 0.5 * uAgitate ) * shim;',
          'col += vec3( 0.30, 0.36, 0.33 ) * line * fres * 0.5;',
          'float a = clamp( diffuseColor.a + fres * 0.42 + line * 0.30 + depth * 0.10, 0.0, 0.72 );',
          'gl_FragColor = vec4( col, a );'
        ].join('\n'));
    };
    mat.needsUpdate = true;
  }

  /* surface disc: fresnel sheen + capillary meniscus rim + faint moving
     ripple. vR is OBJECT-space radius / uDiscR (CircleGeometry lies in
     local XY), so it is immune to the per-frame world-up orientation
     slerp AND the per-frame scale.set(rs,rs,1) / rIn resizing. */
  function installWaterTopShader(mat, discR, holder) {
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uTime = { value: 0.0 };
      shader.uniforms.uDiscR = { value: discR };
      holder._waterTopUniforms = shader.uniforms;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vR;\nuniform float uDiscR;')
        .replace('#include <begin_vertex>',
                 '#include <begin_vertex>\n  vR = length( position.xy ) / uDiscR;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vR;\nuniform float uTime;')
        .replace('#include <output_fragment>', [
          'vec3  V    = normalize( vViewPosition );',
          'float fres = pow( 1.0 - abs( dot( normalize( normal ), V ) ), 4.0 );',
          'float rim  = smoothstep( 0.80, 0.99, vR );',
          'float rip  = 0.5 + 0.5 * sin( vR * 24.0 - uTime * 2.2 );',
          'vec3  col  = outgoingLight;',
          'col += vec3( 0.42, 0.52, 0.47 ) * fres * 0.28;',
          'col += vec3( 0.72, 0.84, 0.78 ) * rim * ( 0.22 + 0.10 * rip );',
          'float a = clamp( diffuseColor.a + fres * 0.30 + rim * 0.35, 0.0, 0.72 );',
          'gl_FragColor = vec4( col, a );'
        ].join('\n'));
    };
    mat.needsUpdate = true;
  }

  /* ── one water look for the WHOLE flow, shared by both scenes ─────────
     The jet is UNLIT: a lit/env-mapped material on a thin tube is all
     grazing angles, and its fresnel reflections of the grey studio env
     composite as a dark outline over the transparent canvas. MeshBasic
     can never go dark; the wet sheen comes from an additive fresnel pass
     (additive only ever brightens) drawn over the same tube geometry. */
  var WATER_JET_TINT = 0xd0e1d8;   // solved from pixels: pool renders #E9EFEA; this lands the stream on it exactly
  var WATER_CORE_TINT = 0xf0f7f2;  // solid-liquid core, barely brighter than the sheath
  var WATER_DROP_TINT = 0xc4dfd0;  // droplets, satellites, splash, mist
  var WATER_JET_OP = 0.85;         // dense enough that no stretch of the stream reads transparent
  var WATER_CORE_OP = 0.26;        // core stays subtle so it can't white-out a thin ribbon
  function waterJetMaterial() {
    // toneMapped:false — ACES would compress the pale sage toward the page
    // cream and the whole stream washes out (user-reported overexposure)
    return new THREE.MeshBasicMaterial({ color: WATER_JET_TINT, transparent: true, opacity: 0.0, depthWrite: false, toneMapped: false, vertexColors: true });
  }
  function waterSheenMesh(geo) {
    // fresnel definition pass: a CONSTANT sage edge (normal blend can never
    // fall darker than this authored colour — no env, no black) plus a white
    // hot sparkle toward pure grazing
    var m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.FrontSide,
      uniforms: { uK: { value: 0 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uK; varying vec3 vN; varying vec3 vV; void main(){ float d = 1.0 - abs(dot(normalize(vN), normalize(vV))); float f = pow(d, 2.0); float hot = pow(d, 7.0); gl_FragColor = vec4(mix(vec3(0.47, 0.58, 0.51), vec3(1.0), hot), (f * 0.62 + hot * 0.35) * uK); }'
    }));
    m.visible = false;
    m.frustumCulled = false;
    return m;
  }
  function syncWaterSheen(stream, sheen) {
    // the sheen shares the stream's geometry; only visibility + strength track
    sheen.visible = stream.visible;
    sheen.material.uniforms.uK.value = stream.material.opacity / WATER_JET_OP;
  }

  class Bottle3D extends HTMLElement {
    static get observedAttributes() { return ['condensation', 'spin-speed', 'spinspeed', 'offset-x', 'offsetx', 'pour']; }

    connectedCallback() {
      if (this._started) return;
      if (!window.THREE) { // three.js may still be loading from the helmet
        var self = this;
        setTimeout(function () { if (self.isConnected) self.connectedCallback(); }, 60);
        return;
      }
      this._started = true;
      _pourHandoff.hasBottle = true;
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
      _pourHandoff.hasBottle = false; _pourHandoff.live = false;
      cancelAnimationFrame(this._raf);
      if (this._ro) this._ro.disconnect();
      if (this._io) this._io.disconnect();
      document.removeEventListener('visibilitychange', this._onVis);
      window.removeEventListener('scroll', this._onScroll);
      window.removeEventListener('wheel', this._onWheel);
      // dispose() alone does not free the GL context; without forceContextLoss
      // a detach/re-attach stacks contexts until mobile Safari evicts one
      if (this._renderer) { this._renderer.dispose(); this._renderer.forceContextLoss(); }
      if (this._canvas && this._canvas.parentNode === this) this.removeChild(this._canvas);
      this._canvas = null;
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
      if (!_v1) { _v1 = new THREE.Vector3(); _v2 = new THREE.Vector3(); _v3 = new THREE.Vector3(); _v4 = new THREE.Vector3(); _v5 = new THREE.Vector3(); _v6 = new THREE.Vector3(); _v7 = new THREE.Vector3(); _vZ = new THREE.Vector3(0, 0, 1); _vY = new THREE.Vector3(0, 1, 0); _q1 = new THREE.Quaternion(); _q2 = new THREE.Quaternion(); }
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
      scene.environment = makeStudioEnv(renderer);

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
      // ONE liquid, base to lip: the lathe runs the full interior — body,
      // shoulder, neck, screw-finish bore — and the world-horizontal clip
      // plane alone decides where its surface is. (It used to stop at the
      // shoulder with a separate "neck run" mesh patched on top; two
      // transparent meshes always betrayed their seam. User: "make it just
      // one liquid.")
      var wpts = [new THREE.Vector2(0.001, 0.08)];
      for (var y = 0.08; y <= 2.90; y += 0.06) wpts.push(new THREE.Vector2(radiusAt(y) * 0.90, y));
      for (var y2 = 2.92; y2 <= 3.08; y2 += 0.08) wpts.push(new THREE.Vector2(Math.min(radiusAt(y2) * 0.90, 0.148), y2));
      wpts.push(new THREE.Vector2(0.142, 3.16));
      wpts.push(new THREE.Vector2(0.001, 3.16));
      var water = new THREE.Mesh(new THREE.LatheGeometry(wpts, 96), new THREE.MeshPhysicalMaterial({
        color: 0xa7cbb4, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.3,
        envMapIntensity: 1.1, depthWrite: false, side: THREE.DoubleSide,
        clippingPlanes: [this._waterPlane]
      }));
      water.renderOrder = 2;
      parent.add(water);
      this._water = water;
      installWaterBodyShader(water.material, this);
      this._level = 1; // 1 = full; drains toward 0.32 while pouring
      var top = new THREE.Mesh(new THREE.CircleGeometry(radiusAt(2.32) * 0.90, 48),
        new THREE.MeshPhysicalMaterial({ color: 0xdfeee6, roughness: 0.04, transparent: true, opacity: 0.25, envMapIntensity: 1.4, depthWrite: false }));
      top.rotation.x = -Math.PI / 2; top.position.y = 2.32; top.renderOrder = 2;
      parent.add(top);
      this._waterTop = top;
      installWaterTopShader(top.material, radiusAt(2.32) * 0.90, this);

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
        new THREE.MeshPhysicalMaterial({ color: 0xb9d3c4, roughness: 0.08, transparent: true, opacity: 0.4, envMapIntensity: 1.2, depthWrite: false })); // glass-green, not frosted white — read as a plug at pour angle
      screw.renderOrder = 5;
      parent.add(screw);
      // rolled lip at the mouth
      var mouth = new THREE.Mesh(new THREE.TorusGeometry(0.176, 0.013, 10, 48),
        new THREE.MeshPhysicalMaterial({ color: 0xbdd6c7, roughness: 0.1, transparent: true, opacity: 0.4, envMapIntensity: 1.2 }));
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
      var MAX = 150;
      // bright, near-white air so the gulp reads clearly against the sage
      // water (a submerged air bubble catches the light as a pale sphere)
      var mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.013, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xf3fbf6, transparent: true, opacity: 0.78, depthWrite: false, toneMapped: false, clippingPlanes: [this._waterPlane] }), MAX);
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
      var MAX = 300; // max LOD: more drops in flight, rounder drops
      var mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 10, 8),
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
      var RINGS = this._strRings = 96, SEG = this._strSeg = 16; // max LOD on the jet
      function tubeGeo(withNormals) {
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RINGS * SEG * 3), 3).setUsage(THREE.DynamicDrawUsage));
        if (withNormals) geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(RINGS * SEG * 3), 3).setUsage(THREE.DynamicDrawUsage));
        if (withNormals) { var ca = new Float32Array(RINGS * SEG * 3); ca.fill(1); geo.setAttribute('color', new THREE.BufferAttribute(ca, 3).setUsage(THREE.DynamicDrawUsage)); }
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
      // ══ ORIGINAL materials, restored (9e68e98): the lit clearcoat sheath
      // over the aurora backdrop + the bright solid-liquid core ══
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
      this._noWall = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this._onScroll = function () {
        var y = window.scrollY;
        // THE WALL, scroll-event side: arms here too, so a violent flick that
        // outruns the ticker (or lands while the bottle is offscreen) still
        // hits it — same conditions as _tick, including the 12s release
        if (self._pin && !self._noWall && self._sawHero && self._level > 0.245 &&
            (!self._wallT || self._clock.elapsedTime - self._wallT < 12)) {
          var end = self._pin.offsetTop + 0.88 * Math.max(1, self._pin.offsetHeight - window.innerHeight);
          if (y > end) self._holdY = end;
        }
        if (self._holdY != null && y > self._holdY) {
          window.scrollTo(0, self._holdY);
          y = self._holdY;
        }
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
      // drag to spin, with flick inertia. On TOUCH the gesture's intent is
      // resolved first: a horizontal drag spins, a vertical one is handed back
      // to the page so the reader scrolls past without the bottle grabbing it.
      this._spinVel = 0;
      var dragging = false, lastX = 0, lastT = 0, startX = 0, startY = 0, axis = 1; // axis 1 = spinning, 0 = undecided (touch), -1 = scrolling
      this.addEventListener('pointerdown', function (e) {
        dragging = true; self._dragging = true; lastX = e.clientX; lastT = performance.now();
        startX = e.clientX; startY = e.clientY;
        axis = (e.pointerType === 'touch') ? 0 : 1;               // touch waits to see if it's a scroll
        self._spinVel = 0;
        // capturing a touch pointer swallows the page scroll — only capture a mouse/pen
        if (e.pointerType !== 'touch' && self.setPointerCapture && e.pointerId !== undefined) {
          try { self.setPointerCapture(e.pointerId); } catch (_) {}
        }
      });
      window.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        if (axis === 0) {                                          // touch, intent undecided
          var adx = Math.abs(e.clientX - startX), ady = Math.abs(e.clientY - startY);
          if (adx < 8 && ady < 8) { lastX = e.clientX; lastT = performance.now(); return; }
          if (ady > adx) { axis = -1; dragging = false; self._dragging = false; return; } // vertical → scroll the page
          axis = 1;                                                // horizontal → this is a spin
        }
        var now = performance.now();
        var dx = e.clientX - lastX;
        self._rotY += dx * 0.012;                                  // direct spin under the cursor
        self._spinVel = (dx / Math.max(1, now - lastT)) * 12;      // flick momentum
        lastX = e.clientX; lastT = now;
      });
      window.addEventListener('pointerup', function () { dragging = false; self._dragging = false; axis = 1; });
      window.addEventListener('pointercancel', function () { dragging = false; self._dragging = false; axis = 1; });
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
      // how tall the bottle actually renders, in CSS px — the cup below
      // sizes itself from this so the two always keep their proportion
      _pourHandoff.bPx = H * ref / (2 * 0.2867 * 8.3);
    }

    /* ---------- per-frame ---------- */
    _tick() {
      // never freeze mid-pour: if the hero scrolls out of view while the
      // water is still flowing, keep ticking until the transfer finishes —
      // a frozen broadcast left the glass drawing a phantom, bent stream
      // from stale screen coordinates and the cup never filled
      if (this._hidden || (this._offscreen && !this._pourActive && this._holdY == null)) { this._clock.getDelta(); return; }
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

      // THE WALL: the pour must finish before the words below unlock. It
      // stands MID-POUR (p=0.88, bottle deeply tilted, jet at full song) —
      // at the pin's end it came too late: a natural scroll drained the
      // bottle en route and the wall waved everyone through. Armed by
      // position + remaining water, enforced every frame. Never traps: 12s
      // hard release, reduced-motion exempt, scroll-up free, and only for
      // readers who actually came down through the hero.
      // the top bar sits out the show: on before the sequence, off once it
      // is underway (the wall's per-frame clamps made it flicker), back the
      // moment the reader is through to the cup
      var navOff = p > 0.35 && p < 0.995 && !this._noWall;
      if (navOff !== this._navOff) {
        this._navOff = navOff;
        document.documentElement.classList.toggle('heroseq', navOff);
      }

      if (p < 0.7) { this._sawHero = true; if (this._level > 0.9) this._wallT = 0; }
      var wall = this._sawHero && !this._noWall && this._pin && this._level > 0.245;
      if (wall) {
        var wallY = this._pin.offsetTop + 0.88 * Math.max(1, this._pin.offsetHeight - window.innerHeight);
        wall = window.scrollY >= wallY - 2;
        if (wall) {
          if (!this._wallT) this._wallT = t || 0.001;
          if (t - this._wallT > 12) wall = false;
        }
      }
      this._holdY = wall ? wallY : null;
      if (this._holdY != null && window.scrollY > this._holdY + 1) window.scrollTo(0, this._holdY);

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
      // bottle upright and full again = the story reset; the glass empties itself
      _pourHandoff.reset = this._level > 0.95 && this._tiltT < 0.15;
      _pourHandoff.bLevel = this._level; // conservation feed: the cup receives exactly what the bottle loses
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
      var bob = Math.sin(t * 0.8) * 0.05 * (1 - tiltT); // rock-still while pouring
      var halfW = this._camera.position.z * 0.2867 * this._camera.aspect;
      // glass line: 30% of the viewport on desktop, 14% on phones
      var pourX = (this._narrow ? -0.74 : -0.4) * halfW + 1.44; // mouth swings ~1.44 left of root at full tilt
      // the bottle holds ONE fixed pour stance — it tilts, it does not wander.
      // The +0.5 lean splits the jet's sideways carry so both strong and weak
      // pours land on-screen; the landing walk is the CUP's job to chase.
      this._root.position.x = offsetX + this._driftX + tiltT * (pourX + 0.5);
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
      var h = lerp(minY, maxY, 0.712 * lvl) + (this._surfBob || 0); // pooled water height, heaving with the glug
      this._waterPlane.constant = h;
      // surface disc rides the waterline along the bottle axis, always world-level
      if (dyPer > 0.25) { // upright-ish ONLY: inverted, the disc escaped the silhouette as a floating bar
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

      // feed the water-realism shader uniforms (installed via onBeforeCompile;
      // guarded — they only exist after the first program compile). h is the
      // per-frame world waterline Y (== this._waterPlane.constant), _v2 still
      // holds the bottle-base world position from the block above.
      if (this._waterUniforms) {
        this._waterUniforms.uWaterlineY.value = h;
        this._waterUniforms.uBaseY.value = _v2.y;
        this._waterUniforms.uTime.value = t;
        this._waterUniforms.uAgitate.value =
          Math.min(1, Math.abs(vel) * 0.008 + tiltT * 0.8 + this._fizzBurst * 0.8 + (this._glugKick || 0) * 0.6);
      }
      if (this._waterTopUniforms) this._waterTopUniforms.uTime.value = t;

      // bubbles — 2x speed and 2x count once the cap is off, plus a hard
      // surge while the cap-off fizz burst is live. But once the bottle
      // TILTS to pour, the in-bottle carbonation clears away so the pour
      // reads as clean flowing water (the gargle lives in the flow, not in
      // bubbles) — user: "delete the bubbles, make the gargle the flow".
      var pourClean = smoothstep(0.34, 0.60, tiltT); // 0 upright … 1 pouring
      var surge = (Math.min(3.5, Math.abs(vel) * 0.012) + tiltT * 3.0) * (1 + capT) + this._fizzBurst * 5;
      this._bubbles.count = Math.min(this._bubbleData.length,
        Math.round(this._bubbleBase * (1 + capT + this._fizzBurst) * (1 - pourClean)));
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

      // ══ ORIGINAL pour dynamics, restored (9e68e98) ══
      // pour strength = how far past the pour threshold the tilt is, scaled
      // by how much head of water is left to feed the stream — the pour
      // peters out into drips as the bottle empties
      var head = smoothstep(0.20, 0.42, this._level);
      var ps = smoothstep(0.58, 0.96, tiltT) * head;
      var pouring = tiltT > 0.58 && this._level > 0.201 && ps > 0.003;
      this._pourActive = pouring; // keeps the tick alive offscreen until the pour completes

      // two regimes, set by how full the neck is:
      //  • FULL neck → air can only barge in through pulses: the flow chokes
      //    rhythmically and fat slugs punch up the neck (the gargle).
      //  • once the level DROPS, air finds a steady open channel up one side
      //    of the bore, so inflow and outflow coexist and the pour runs
      //    smooth — no choke, no glug, just a clean thread of rising air.
      // ══ THE GARGLE, expressed purely as the FLOW OF THE WATER ══
      // No bubbles, no air pockets. While the neck is packed (level high)
      // the pour PULSATES — the column swells and pinches, big/small/big/
      // small, and those bulges travel down the stream (see _updateStream,
      // which reads this._glugAmp + this._glugPhase). As the bottle drains
      // past ~0.62→0.40 the pulse fades and the water simply runs down
      // smoothly: air now has a clear path, so no more glug.
      var flow = 1;
      if (pouring) {
        var tiltG = smoothstep(0.72, 0.95, tiltT);
        var gargle = tiltG * smoothstep(0.40, 0.62, this._level); // 1 = packed & gargling, 0 = drained & smooth
        this._glugAmp = gargle;
        this._glugPhase += dt * (9.0 + 3.0 * ps);                 // the glug cadence (~1.5 Hz)
        var gl = 0.5 + 0.5 * Math.sin(this._glugPhase);
        // STEADY mean choke (= the time-average of the old oscillation): the
        // whole column no longer throbs in lockstep — the big/small rhythm
        // lives ONLY in the travelling wave in _updateStream. Drain timing
        // and mean thickness are unchanged; at gargle=0 the base pour is exact.
        flow = 1 - 0.19 * gargle;
        // the water INSIDE heaves on the same beat — surface only, no particles
        this._surfBob = (gl - 0.5) * 0.05 * gargle;
        this._level = Math.max(0.20, this._level - dt * (0.05 + 0.16 * ps * flow));
      } else {
        this._glugAmp = 0;
        this._surfBob = (this._surfBob || 0) * Math.pow(0.02, dt); // settle when not pouring
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
      // the glug is air forcing its way back through the neck toward the
      // trapped pocket — world-up expressed in bottle space. It enters as
      // ONE fat slug that fills the bore (the audible "glug"), with a short
      // train of smaller bubbles chasing it up.
      this._bottle.getWorldQuaternion(_q1);
      _v1.set(0, 1, 0).applyQuaternion(_q1.invert());
      var fd = this._fizzData, cap = this._fizz.instanceMatrix.count;
      // the slug: a bore-filling air pocket punched in at the mouth
      if (fd.length < cap) {
        var a0 = Math.random() * Math.PI * 2, r0 = Math.random() * 0.025;
        fd.push({
          x: Math.cos(a0) * r0, y: 2.98 + Math.random() * 0.12, z: Math.sin(a0) * r0,
          dx: _v1.x, dy: _v1.y, dz: _v1.z,
          v: 1.7 + Math.random() * 0.6, s: 9.5 + Math.random() * 3.5,
          life: 1.7, w: Math.random() * Math.PI * 2, pop: false
        });
      }
      // the train: bubbles shed off the slug as it tears up the neck
      var n = 3 + Math.floor(Math.random() * 4);
      for (var i = 0; i < n && fd.length < cap; i++) {
        var ang = Math.random() * Math.PI * 2, rr = Math.random() * 0.075;
        fd.push({
          x: Math.cos(ang) * rr, y: 2.55 + Math.random() * 0.45, z: Math.sin(ang) * rr,
          dx: _v1.x, dy: _v1.y, dz: _v1.z,
          v: 1.0 + Math.random() * 0.9, s: 2.0 + Math.random() * 2.2,
          life: 1.4, w: Math.random() * Math.PI * 2, pop: false
        });
      }
    }

    /* the smooth regime: once the level drops enough that air has an open
       path, it runs up ONE side of the bore in a steady thin thread —
       continuous inflow beside the outflow, no glug. Bubbles hug the
       world-up side of the neck (where air travels) and rise cleanly. */
    _spawnAirChannel(dt, intensity) {
      this._bottle.getWorldQuaternion(_q1);
      _v1.set(0, 1, 0).applyQuaternion(_q1.invert());   // world-up in bottle space
      var sx = _v1.x, sz = _v1.z, sl = Math.sqrt(sx * sx + sz * sz);
      if (sl > 1e-6) { sx /= sl; sz /= sl; } else { sx = 1; sz = 0; } // lateral toward the up-side of the bore
      var fd = this._fizzData, cap = this._fizz.instanceMatrix.count;
      this._airClock = (this._airClock || 0) + dt * 30 * intensity;
      var nn = Math.floor(this._airClock);
      this._airClock -= nn;
      for (var i = 0; i < nn && fd.length < cap; i++) {
        var off = 0.055 + Math.random() * 0.055;        // ride the channel, offset to one wall
        var jit = (Math.random() - 0.5) * 0.05;         // slight spread across the channel
        fd.push({
          x: sx * off - sz * jit, y: 2.86 + Math.random() * 0.24, z: sz * off + sx * jit,
          dx: _v1.x, dy: _v1.y, dz: _v1.z,
          v: 1.2 + Math.random() * 0.5, s: 1.3 + Math.random() * 1.1,
          life: 1.3, w: Math.random() * Math.PI * 2, pop: false
        });
      }
    }

    _updateFizz(dt) {
      var mesh = this._fizz, fd = this._fizzData, dummy = this._dropDummy;
      // the cap-off nucleation burst only fires while the bottle is upright;
      // once it tilts to pour, no new bubbles nucleate (existing ones rise
      // out within a beat) so the pour is clean water, no fizz in the bottle
      if (this._fizzBurst > 0.02 && (this._tiltT || 0) < 0.34) {
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
        // once the bottle tilts to pour, any lingering cap-off bubbles are
        // culled fast so the pour is clean water (no fizz in the bottle)
        b.life -= dt * (1 + 60 * smoothstep(0.34, 0.60, this._tiltT || 0));
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
        _pourHandoff.live = false;
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
      // ══ THE ORIGINAL POUR, restored verbatim from the version the user
      // loved (commit 9e68e98) — water leaves over the LOW edge of the lip,
      // mass-conservation taper, Plateau–Rayleigh varicose wave, breakup
      // into main drops + satellites. Only the frame-bottom kill bound is
      // parametrised for today's full-hero canvas. ══
      var ex = _v1.x + _v3.x * 0.10, ey = _v1.y + _v3.y * 0.10, ez = _v1.z + _v3.z * 0.10;
      var GP = 16;
      // exit velocity doubled (user: "no urge for the water to leave the
      // bottle") — nearer Torricelli for the head behind the lip at this
      // scene's stylised gravity; the water now JETS off the lip instead of
      // dribbling. Same taper/wave/breakup physics downstream.
      var v0 = (1.1 + 1.9 * ps) * (0.82 + 0.18 * flow);
      var r0 = (0.032 + 0.105 * ps) * (0.55 + 0.45 * flow); // thicker at the lip (user), thinning downstream by mass conservation
      // weak pours droop off the lip; hard pours jet along the axis
      var droop = 0.55 * (1 - ps);
      _v4.set(_v2.x + _v3.x * droop, _v2.y + _v3.y * droop, _v2.z + _v3.z * droop).normalize();
      var vx = _v4.x * v0, vy = _v4.y * v0, vz = _v4.z * v0;
      // breakup length: fat fast jets hold together, thin dribbles pinch off
      // almost immediately. The old 1.9 cap kept the breakup "inside the
      // frame" of the small hero box — on today's full-height canvas that
      // split the stream into blobs in plain view (user: "it's just
      // splitting"). A committed pour now rides coherent past the frame
      // bottom (the edgeY kill), and only a thinning flow pinches on-screen.
      var Lb = Math.min(6.5, Math.max(0.14, 26 * v0 * Math.pow(r0, 0.75)));

      var posA = stream.geometry.attributes.position.array;
      var norA = stream.geometry.attributes.normal.array;
      var posC = core.geometry.attributes.position.array;
      var RINGS = this._strRings, SEG = this._strSeg, TSTEP = 0.011; // finer rings, same reach
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
        // THE GARGLE: a low-frequency thickness wave that TRAVELS down the
        // column — fat runs separated by sharp pinches (big/small/big/small),
        // its phase lagging with arclength so a parcel emitted on a surge
        // stays fat as it falls. Distinct from the fine P-R ripple above;
        // amplitude is this._glugAmp (full when the neck is packed, 0 once
        // drained → the column then runs smooth). Held full at the very lip
        // so the stream never looks detached from the mouth.
        var gAmp = this._glugAmp || 0;
        if (gAmp > 0.01) {
          // time-of-flight phase: a parcel now at flight-time tt down the
          // column shows the emission state from tt ago (the integrator rate
          // matches _glugPhase's), so the bulge is BORN at the lip and marches
          // down carrying its birth thickness — big, small, big, small
          var gv = 0.5 + 0.5 * Math.sin(this._glugPhase - (9.0 + 3.0 * ps) * tt);
          var gEdge = Math.min(1, s / 0.15);
          r *= 1 - gAmp * 0.55 * gEdge * (1 - gv * gv);            // fat runs, sharp pinches between
        }
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

  var _v1, _v2, _v3, _v4, _v5, _v6, _v7, _vZ, _vY, _q1, _q2;

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

  /* shared soft studio light-box → PMREM env for glass/metal/water */
  function makeStudioEnv(renderer) {
    var env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0x9a9a94, side: THREE.BackSide })));
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
    var tex = pmrem.fromScene(env, 0.04).texture; // the baked cubeUV texture survives generator dispose
    pmrem.dispose();
    env.traverse(function (o) { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    return tex;
  }

  /* ══ <glass-3d> — the tumbler that catches the hero's pour. Same water,
     same jet physics, same three-pass glass as the bottle above it. ══ */
  var GH = 1.0;                       // tumbler height, world units
  /* live handoff between the two scenes. The glass's canvas overlaps the
     hero (CSS top:-100svh), so while the bottle pours it broadcasts its
     jet's exit state in VIEWPORT PIXELS — position, velocity, gravity,
     radius — and the glass scene draws the ENTIRE stream from lip to cup in
     one canvas: there is no border for the water to be cut off at. One
     shared object, both elements live in this closure — no allocation. */
  var _pourHandoff = { live: false, ps: 0, mx: 0, my: 0, vx: 0, vy: 0, g: 0, r: 0, hasBottle: false, hasGlass: false, glassActive: false, glassTop: 1e9, beat: 0, covered: false, reset: false, cupSeen: false, bLevel: 1 };
  function tumblerInnerR(y) {         // inner wall radius at height y (fit to the lathe profile)
    return 0.255 + 0.045 * Math.max(0, Math.min(1, (y - 0.125) / (0.96 - 0.125)));
  }

  class Glass3D extends HTMLElement {
    connectedCallback() {
      if (this._started) return;
      if (!window.THREE) {
        var self0 = this;
        setTimeout(function () { if (self0.isConnected) self0.connectedCallback(); }, 60);
        return;
      }
      this._started = true;
      _pourHandoff.hasGlass = true;
      this.style.display = 'block';
      var canvas = document.createElement('canvas');
      canvas.style.cssText = 'width:100%;height:100%;display:block;';
      this.appendChild(canvas);
      this._canvas = canvas;
      this._reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this._level = this._reduce ? 0.68 : 0.03;   // fill fraction of the tumbler
      this._initScene();
      var self = this;
      this._ro = new ResizeObserver(function () { self._resize(); });
      this._ro.observe(this);
      this._onVis = function () { self._hidden = document.hidden; };
      document.addEventListener('visibilitychange', this._onVis);
      this._io = new IntersectionObserver(function (entries) {
        if (entries[0]) self._offscreen = !entries[0].isIntersecting;
      });
      this._io.observe(this);
      this._clock = new THREE.Clock();
      (function loop() {
        self._raf = requestAnimationFrame(loop);
        self._tick();
      })();
    }

    disconnectedCallback() {
      _pourHandoff.hasGlass = false; _pourHandoff.glassActive = false;
      cancelAnimationFrame(this._raf);
      if (this._ro) this._ro.disconnect();
      if (this._io) this._io.disconnect();
      document.removeEventListener('visibilitychange', this._onVis);
      // dispose() alone does not free the GL context; without forceContextLoss
      // a detach/re-attach stacks contexts until mobile Safari evicts one
      if (this._renderer) { this._renderer.dispose(); this._renderer.forceContextLoss(); }
      if (this._canvas && this._canvas.parentNode === this) this.removeChild(this._canvas);
      this._canvas = null;
      this._started = false;
    }

    _initScene() {
      // at DPR>=2 pixel density already smooths edges — dropping MSAA halves fill cost
      var renderer = new THREE.WebGLRenderer({ canvas: this._canvas, alpha: true, antialias: (window.devicePixelRatio || 1) < 2 });
      renderer.setClearColor(0x000000, 0);
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.localClippingEnabled = true;
      this._renderer = renderer;
      var scene = new THREE.Scene();
      this._scene = scene;
      var camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
      camera.position.set(0, 0, 8);
      camera.lookAt(0, 0, 0);
      this._camera = camera;
      scene.environment = makeStudioEnv(renderer);
      scene.add(new THREE.AmbientLight(0xffffff, 0.35));
      var key = new THREE.DirectionalLight(0xfff8ee, 1.15);
      key.position.set(3, 5, 4); scene.add(key);
      var rim = new THREE.DirectionalLight(0xe8f0ff, 0.4);
      rim.position.set(-4, 2, -3); scene.add(rim);
      var glint = new THREE.PointLight(0xffffff, 0.85, 30);
      glint.position.set(2.4, 3.4, 3.2); scene.add(glint);

      this._waterPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0.2);
      var g = new THREE.Group();
      scene.add(g);
      this._glass = g;

      // tumbler: one lathe that includes the inner wall, so the rim and the
      // wall thickness read as real glass — clear, not the bottle's green.
      // A glass-src GLB (the user's own render) replaces it when provided.
      var pts = [
        [0.00, 0.020], [0.22, 0.020], [0.270, 0.035], [0.285, 0.10],
        [0.290, 0.35], [0.315, 0.70], [0.330, 0.97], [0.330, 1.00],
        [0.312, 1.00], [0.300, 0.96], [0.284, 0.70], [0.262, 0.35],
        [0.255, 0.125], [0.00, 0.125]
      ].map(function (p) { return new THREE.Vector2(p[0], p[1]); });
      this._tumblerShells = this._shellify(g, new THREE.LatheGeometry(pts, 64));
      this._loadGlassSrc(g);

      // soft contact shadow under the base
      var shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 40), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        vertexShader: 'varying vec2 vU; void main(){ vU = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'varying vec2 vU; void main(){ float a = smoothstep(1.0, 0.15, length(vU)); gl_FragColor = vec4(0.12, 0.16, 0.10, a * 0.22); }'
      }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.y = 0.005;
      shadow.scale.set(1, 0.55, 1);
      shadow.renderOrder = 0;
      g.add(shadow);

      // the water body — same material family as inside the bottle. The
      // cavity profile lives on the instance so a loaded glass-src model can
      // redefine it and the water follows the real glass.
      this._innerR = tumblerInnerR;
      this._waterBase = 0.125;
      var water = new THREE.Mesh(this._waterGeo(), new THREE.MeshPhysicalMaterial({
        color: 0xa7cbb4, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.34,
        envMapIntensity: 1.1, depthWrite: false, side: THREE.DoubleSide,
        clippingPlanes: [this._waterPlane]
      }));
      water.renderOrder = 2; g.add(water);
      this._water = water;
      installWaterBodyShader(water.material, this);
      var top = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshPhysicalMaterial({
        color: 0xdfeee6, roughness: 0.04, transparent: true, opacity: 0.30,
        envMapIntensity: 1.3, depthWrite: false
      }));
      top.rotation.x = -Math.PI / 2; top.renderOrder = 2;
      g.add(top);
      this._waterTop = top;
      installWaterTopShader(top.material, 1.0, this);

      // the falling jet — the same rewritten-in-place tube as the bottle's pour
      var RINGS = this._strRings = 96, SEG = this._strSeg = 12; // max LOD, matching the bottle's jet
      function tubeGeo(withNormals) {
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RINGS * SEG * 3), 3).setUsage(THREE.DynamicDrawUsage));
        if (withNormals) geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(RINGS * SEG * 3), 3).setUsage(THREE.DynamicDrawUsage));
        if (withNormals) { var ca = new Float32Array(RINGS * SEG * 3); ca.fill(1); geo.setAttribute('color', new THREE.BufferAttribute(ca, 3).setUsage(THREE.DynamicDrawUsage)); }
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
      var stream = new THREE.Mesh(tubeGeo(true), waterJetMaterial()); // the bottle jet's exact water
      // between the water body (2) and the front wall (5): the glass and its
      // dark rim veil the submerged stretch, so the jet falls INTO the glass
      stream.renderOrder = 3; stream.visible = false; stream.frustumCulled = false;
      scene.add(stream);
      this._stream = stream;
      var core = new THREE.Mesh(tubeGeo(false), new THREE.MeshBasicMaterial({
        color: WATER_CORE_TINT, transparent: true, opacity: 0.0, depthWrite: false, toneMapped: false // the bottle core's exact white
      }));
      core.renderOrder = 3.5; core.visible = false; core.frustumCulled = false;
      scene.add(core);
      this._core = core;
      // wet-glint pass on the same tube — geometry (and drawRange) shared
      var sheen = waterSheenMesh(stream.geometry);
      sheen.renderOrder = 3.6;
      scene.add(sheen);
      this._sheen = sheen;

      // splash droplets kicked up at the impact point — the bottle drops' water
      var splash = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 8, 6),
        new THREE.MeshBasicMaterial({ color: WATER_DROP_TINT, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }), 150);
      splash.count = 0; splash.renderOrder = 3.7; splash.frustumCulled = false;
      scene.add(splash);
      this._splash = splash; this._splashData = []; this._splashClock = 0;

      // bubbles churned under the impact, rising through the water
      var bub = new THREE.InstancedMesh(new THREE.SphereGeometry(0.013, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xf2fbf5, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false, clippingPlanes: [this._waterPlane] }), 120);
      bub.count = 0; bub.renderOrder = 4; bub.frustumCulled = false;
      scene.add(bub);
      this._bub = bub; this._bubData = []; this._bubClock = 0;

      // ── the whisky act awaits the USER'S bottle file (they will deliver a
      // model; the procedural stand-in was cut at their word). While _wb is
      // null the whole act sleeps — no bottle, no amber jet, no gold mix, no
      // copy cue — but the cup still rides the stage and keeps its fizz.
      this._wb = null;
      this._wbMats = [];
      this._extra = 0;        // whisky in the cup, on top of the water's level
      this._whiskyOn = false;
      this._hb = document.querySelector('.highball');

      this._dummy = new THREE.Object3D();
      this._initVideoJet();
      this._loadWhisky();
      this._resize();
    }

    /* the shared jet tube becomes the spirit: amber stream, warm splash */
    _whiskyArm() {
      if (this._whiskyOn) return;
      this._whiskyOn = true;
      this._stream.material.color.setHex(0xd9a441);
      this._core.material.color.setHex(0xead9a0);
      this._splash.material.color.setHex(0xdcae5f);
    }

    /* the Higgsfield socket: pour-src names a GREEN-SCREEN video of a real
       water pour. It is chroma-keyed in-shader (despilled, edge-feathered)
       and stretched lip→cup while the bottle pours; the procedural jet
       stands down while it plays. Optional pour-width scales the clip. */
    _initVideoJet() {
      var src = this.getAttribute('pour-src') || this.getAttribute('poursrc');
      if (!src) return;
      var v = document.createElement('video');
      v.muted = true; v.loop = true; v.playsInline = true; v.setAttribute('playsinline', '');
      v.preload = 'auto'; v.crossOrigin = 'anonymous'; v.src = src;
      this._pourVideo = v;
      var tex = new THREE.VideoTexture(v);
      tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
      tex.encoding = THREE.sRGBEncoding;
      var quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false,
        uniforms: { uTex: { value: tex }, uOp: { value: 0 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: [
          'uniform sampler2D uTex; uniform float uOp; varying vec2 vUv;',
          'void main(){',
          '  vec3 c = texture2D(uTex, vUv).rgb;',
          '  float k = clamp(3.0 * (c.g - max(c.r, c.b)), 0.0, 1.0);  // green-screen key',
          '  c.g = mix(c.g, max(c.r, c.b), k);                        // despill',
          '  float edge = smoothstep(0.0, 0.06, vUv.x) * smoothstep(1.0, 0.94, vUv.x);',
          '  gl_FragColor = vec4(c, (1.0 - k) * uOp * edge);',
          '}'].join('\n')
      }));
      quad.renderOrder = 3.2; quad.visible = false; quad.frustumCulled = false;
      this._scene.add(quad);
      this._pourQuad = quad;
    }

    _updateVideoJet(pour, jet, waterY) {
      var q = this._pourQuad;
      if (!q) return false;
      var op = q.material.uniforms.uOp;
      if (pour > 0.01) {
        if (this._pourVideo.paused) { try { this._pourVideo.play(); } catch (e) {} }
        op.value = Math.min(pour, op.value + 0.08);
        var botX = jet.cupX !== undefined ? jet.cupX : jet.x0;
        var len = Math.max(0.2, jet.y0 - waterY);
        q.position.set((jet.x0 + botX) / 2, (jet.y0 + waterY) / 2, 0.02);
        q.rotation.z = -Math.atan2(botX - jet.x0, len);
        var wScale = parseFloat(this.getAttribute('pour-width')) || 1;
        q.scale.set(Math.max(0.35, jet.r0 * 20) * wScale, len * 1.04, 1);
        q.visible = op.value > 0.02;
      } else {
        op.value = Math.max(0, op.value - 0.1);
        if (op.value <= 0.02) { q.visible = false; if (this._pourVideo && !this._pourVideo.paused) this._pourVideo.pause(); }
      }
      return q.visible;
    }

    /* clear reflective glass: BackSide tint + FrontSide clearcoat + a
       normal-blended dark-edge fresnel over one geometry. `facet` marks the
       hard-cut crystal primitives: flat-shaded, hotter env sparkle — and the
       geometry's baked hard normals are NEVER recomputed or welded. */
    _shellify(parent, geo, facet) {
      // clear glass over a light page = almost invisible body, dark edge
      // bands where the wall goes edge-on, hot speculars from the env streaks
      var back = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
        color: 0x87a094, roughness: facet ? 0.02 : 0.06, metalness: 0, transparent: true, opacity: 0.28,
        side: THREE.BackSide, envMapIntensity: 0.9, depthWrite: false, flatShading: !!facet
      }));
      back.renderOrder = 1; parent.add(back);
      var front = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
        color: facet ? 0xf2f7f3 : 0xdfe9e2, roughness: facet ? 0.01 : 0.03, metalness: 0,
        transparent: true, opacity: facet ? 0.22 : 0.14,
        clearcoat: 1, clearcoatRoughness: 0.04, side: THREE.FrontSide,
        envMapIntensity: facet ? 3.0 : 1.9, depthWrite: false, flatShading: !!facet
      }));
      front.renderOrder = 5; parent.add(front);
      var fresnel = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.FrontSide,
        vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        // normal blending with a DARK edge colour: reads as the thick wall of
        // real glass against light paper; the hot term still sparkles white
        fragmentShader: 'varying vec3 vN; varying vec3 vV; void main(){ float d = 1.0 - abs(dot(normalize(vN), normalize(vV))); float f = pow(d, 2.2); float hot = pow(d, 9.0); vec3 edge = vec3(0.33, 0.42, 0.37); gl_FragColor = vec4(mix(edge, vec3(1.0), hot), f * 0.6 + hot * 0.4); }'
      }));
      fresnel.renderOrder = 6; parent.add(fresnel);
      return [back, front, fresnel];
    }

    /* swap the procedural tumbler for the user's rendered glass when given */
    _loadGlassSrc(g) {
      var src = this.getAttribute('glass-src') || this.getAttribute('glasssrc');
      if (!src || !THREE.GLTFLoader) return;
      var self = this;
      this._glbTries = (this._glbTries || 0) + 1;
      new THREE.GLTFLoader().load(src, function (m) {
        m.scene.updateMatrixWorld(true);
        var prims = [];
        m.scene.traverse(function (o) { if (o.isMesh) prims.push(o); });
        var box = new THREE.Box3().setFromObject(m.scene);
        if (!prims.length || box.isEmpty()) return;
        // normalize: base at y=0, height GH, centred on the axis
        var s = GH / (box.max.y - box.min.y);
        var norm = new THREE.Matrix4().makeScale(s, s, s).multiply(
          new THREE.Matrix4().makeTranslation(
            -(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
        if (self._tumblerShells[0]) self._tumblerShells[0].geometry.dispose(); // the three shells share one geometry
        self._tumblerShells.forEach(function (mesh) { g.remove(mesh); mesh.material.dispose(); });
        self._tumblerShells = [];
        prims.forEach(function (o) {
          var name = ((o.material && o.material.name) || '').toLowerCase();
          // the crystal asset ships an interior "refraction core" (30k+ tris)
          // that only pays off with transmission — which renders black on our
          // alpha canvas. Drop it; keep the body and the hard-cut facets.
          if (prims.length > 2 && o.geometry.index && name.indexOf('facet') === -1) return;
          var geo = o.geometry.clone();
          geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld));
          var facet = name.indexOf('facet') !== -1 || name.indexOf('cut') !== -1;
          self._tumblerShells = self._tumblerShells.concat(self._shellify(g, geo, facet));
        });
        // the water now follows the real cavity: straight highball walls over
        // a heavy crystal base (cavity floor ≈ 12.5mm of 160mm)
        var rOut = (box.max.x - box.min.x) / 2 * s;
        self._innerR = function () { return rOut * 0.90; };
        self._waterBase = 0.08;
        self._rebuildWater();
      }, undefined, function () {
        // flaky fetch (1.5MB on mobile): retry the crystal before giving up —
        // the procedural tumbler must only ever be a last resort
        if (self._glbTries < 4) setTimeout(function () { self._loadGlassSrc(g); }, 1800);
      });
    }

    /* ── the whisky vessel: the user's decanter GLB, dropped into _wb so the
       sleeping whisky act (drop-in → tip → amber pour → gold mix) wakes.
       Mirrors _loadGlassSrc: normalise, then render the crystal with the same
       alpha-canvas shell trick (its KHR transmission renders black here), and
       keep the amber liquid. Seated so the pour-mouth — the top of glass_body,
       below the stopper — lands at local y=0.75, the height the act emits its
       jet from; the act tilts _wb about its origin, so the stream always
       leaves the real mouth. Until it loads, _wb stays null and the act sleeps. */
    _loadWhisky() {
      var src = this.getAttribute('whisky-src') || this.getAttribute('whiskysrc');
      if (!src || !THREE.GLTFLoader) return;
      var self = this;
      new THREE.GLTFLoader().load(src, function (m) {
        m.scene.updateMatrixWorld(true);
        var prims = [];
        m.scene.traverse(function (o) { if (o.isMesh) prims.push(o); });
        var whole = new THREE.Box3().setFromObject(m.scene);
        if (!prims.length || whole.isEmpty()) return;

        var VH = 1.5;           // vessel height in world units (~1.5× the cup)
        var MOUTH_Y = 0.75;     // local height the act pours from
        var s = VH / (whole.max.y - whole.min.y);
        var cx = (whole.min.x + whole.max.x) / 2, cz = (whole.min.z + whole.max.z) / 2;
        // the mouth = the lip of the body glass (the stopper sits above it)
        var mouthY = whole.max.y;
        prims.forEach(function (o) {
          var nm = ((o.name || '') + ' ' + ((o.material && o.material.name) || '')).toLowerCase();
          if (nm.indexOf('body') !== -1) mouthY = new THREE.Box3().setFromObject(o).max.y;
        });
        var norm = new THREE.Matrix4().makeTranslation(0, MOUTH_Y - s * (mouthY - whole.min.y), 0)
          .multiply(new THREE.Matrix4().makeScale(s, s, s))
          .multiply(new THREE.Matrix4().makeTranslation(-cx, -whole.min.y, -cz));

        var holder = new THREE.Group();
        var cork = new THREE.Group();       // the stopper, lifted off to pour
        var mats = [];
        var stopperGeos = [];
        prims.forEach(function (o) {
          var nm = ((o.name || '') + ' ' + ((o.material && o.material.name) || '')).toLowerCase();
          var geo = o.geometry.clone();
          geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld));
          if (nm.indexOf('whisk') !== -1 || nm.indexOf('liquid') !== -1) {
            // the pour it holds — a warm, lit amber so it glows through the crystal
            var lm = new THREE.MeshPhysicalMaterial({
              color: 0x9a4d16, roughness: 0.25, metalness: 0,
              emissive: 0x35190a, emissiveIntensity: 0.5,
              transparent: true, opacity: 0.94, envMapIntensity: 1.3, depthWrite: false
            });
            var mesh = new THREE.Mesh(geo, lm); mesh.renderOrder = 3; holder.add(mesh);
            mats.push(lm);
          } else if (nm.indexOf('stopper') !== -1 || nm.indexOf('cap') !== -1 || nm.indexOf('lid') !== -1) {
            stopperGeos.push(geo);          // seated separately so it can pop off
          } else {
            mats = mats.concat(self._whiskyShellify(holder, geo)); // body crystal
          }
        });
        // seat the cork at the stopper's own centre so it lifts (and turns) in
        // place rather than swinging around the vessel's pivot
        if (stopperGeos.length) {
          var cbox = new THREE.Box3();
          stopperGeos.forEach(function (gg) { gg.computeBoundingBox(); cbox.union(gg.boundingBox); });
          var cc = new THREE.Vector3(); cbox.getCenter(cc);
          cork.position.copy(cc);
          self._corkSeat = cc.clone();
          stopperGeos.forEach(function (gg) {
            gg.translate(-cc.x, -cc.y, -cc.z);
            mats = mats.concat(self._whiskyShellify(cork, gg));
          });
          holder.add(cork);
          self._wbCork = cork;
        }
        // the fade contract the act drives: transparent, remember op0, start hidden
        mats.forEach(function (mm) { mm.transparent = true; mm._op0 = (mm.opacity == null ? 1 : mm.opacity); mm.opacity = 0; });

        var wb = new THREE.Group();
        holder.rotation.y = -0.4;   // a cut corner turned toward the camera
        wb.add(holder);
        wb.visible = false;
        self._scene.add(wb);
        self._wbMats = mats;
        self._wb = wb;              // ← wakes the whisky act
      });
    }

    /* crystal on our alpha canvas — the tumbler's own facet-shell look:
       BackSide tint + FrontSide clearcoat + a dark-edge fresnel so the wall
       reads against light paper (without it the vessel washes out to nothing).
       The edge pass is a ShaderMaterial, so its .opacity is wired to a uOp
       uniform — that lets the act's `m.opacity = m._op0 * a2` fade reach it
       too, and the whole vessel comes in and out as one. */
    _whiskyShellify(parent, geo) {
      var back = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
        color: 0x87a094, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.26,
        side: THREE.BackSide, envMapIntensity: 0.9, depthWrite: false, flatShading: true
      }));
      back.renderOrder = 1; parent.add(back);
      var front = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
        color: 0xf2f7f3, roughness: 0.01, metalness: 0, transparent: true, opacity: 0.22,
        clearcoat: 1, clearcoatRoughness: 0.04, side: THREE.FrontSide,
        envMapIntensity: 3.0, depthWrite: false, flatShading: true
      }));
      front.renderOrder = 5; parent.add(front);
      var fres = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.FrontSide,
        uniforms: { uOp: { value: 1 } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'uniform float uOp; varying vec3 vN; varying vec3 vV; void main(){ float d = 1.0 - abs(dot(normalize(vN), normalize(vV))); float f = pow(d, 2.2); float hot = pow(d, 9.0); vec3 edge = vec3(0.33, 0.42, 0.37); gl_FragColor = vec4(mix(edge, vec3(1.0), hot), (f * 0.6 + hot * 0.4) * uOp); }'
      }));
      fres.renderOrder = 6; parent.add(fres);
      Object.defineProperty(fres.material, 'opacity', {
        configurable: true,
        get: function () { return this.uniforms.uOp.value; },
        set: function (v) { this.uniforms.uOp.value = v; }
      });
      return [back.material, front.material, fres.material];
    }

    /* water column lathe from the current cavity profile */
    _waterGeo() {
      var wpts = [new THREE.Vector2(0, this._waterBase)];
      for (var wy = this._waterBase; wy <= 0.97; wy += 0.12) wpts.push(new THREE.Vector2(this._innerR(wy) * 0.995, wy));
      wpts.push(new THREE.Vector2(this._innerR(0.97) * 0.995, 0.97));
      return new THREE.LatheGeometry(wpts, 48);
    }

    _rebuildWater() {
      var old = this._water.geometry;
      this._water.geometry = this._waterGeo();
      old.dispose();
    }

    _resize() {
      var w = this.clientWidth || 1, h = this.clientHeight || 1;
      var dpr = Math.min(window.innerWidth <= 760 ? 1.5 : 2, window.devicePixelRatio || 1);
      this._renderer.setPixelRatio(dpr);
      this._renderer.setSize(w, h, false);
      this._narrow = window.innerWidth <= 760;
      this._needsRender = true;
      // size the camera so the tumbler renders at a chosen pixel height, then
      // park the tumbler on the pour line at the right height of the section
      // sized to hold the bottle's pour: a ~500ml bottle needs a tall glass
      // ratioed to the BOTTLE: 85% of its rendered height (user: the cup
      // was too small next to it). Phones clamp so the cup on the 13% pour
      // line can never clip the left edge (half-width = 0.213/unit height).
      var bPx = _pourHandoff.bPx || 0;
      this._cupSrc = bPx;
      var targetPx;
      if (this._narrow) {
        var maxNarrow = Math.max(120, (0.13 * window.innerWidth - 8) / 0.213);
        targetPx = Math.min(bPx ? bPx * 0.85 : 138, maxNarrow);
      } else {
        targetPx = Math.max(240, Math.min(520, bPx ? bPx * 0.85 : 269));
      }
      this._cupPx = targetPx = Math.round(targetPx);
      // the square aura is CSS — hand it the cup's size so it keeps fitting
      if (this.parentElement) this.parentElement.style.setProperty('--cuppx', targetPx + 'px');
      var z = (GH * h) / (2 * 0.2867 * targetPx);
      this._camera.position.z = z;
      this._camera.aspect = w / h;
      this._camera.updateProjectionMatrix();
      var halfH = z * 0.2867, halfW = halfH * (w / h);
      this._halfW = halfW; this._halfH = halfH;
      this._fxDefault = this._narrow ? 0.13 : 0.30; // the bottle's resting pour line
      if (this._fx === undefined) this._fx = this._fxDefault;
      // the canvas overlaps the hero above (CSS top:-100svh) so the jet never
      // meets a canvas border; the glass itself is still placed against the
      // SECTION, whose top sits E px below the canvas top
      var E = 0;
      if (this.parentElement) {
        var pr = this.parentElement.getBoundingClientRect();
        var sr = this.getBoundingClientRect();
        E = Math.max(0, pr.top - sr.top);
      }
      var secH = Math.max(1, h - E);
      var baseFrac = this._narrow ? 0.40 : 0.62;   // glass BOTTOM, fraction of SECTION height
      var basePx = E + baseFrac * secH;
      this._glass.position.set((this._fx - 0.5) * 2 * halfW, (0.5 - basePx / h) * 2 * halfH, 0);
      this._topY = (0.5 - E / h) * 2 * halfH + 0.4; // default jet entry: just above the section
    }

    _tick() {
      var dt = Math.min(0.05, this._clock.getDelta());
      if (this._hidden || this._offscreen) { _pourHandoff.glassActive = false; return; }
      _pourHandoff.glassActive = true;
      _pourHandoff.beat = performance.now(); // heartbeat: the bottle resumes its own jet if this scene ever stalls
      // tell the bottle whether the CUP itself is on screen — the full
      // transfer is held until the user can actually watch it
      var grA = this.getBoundingClientRect();
      var cupPxY = grA.top + (0.5 - this._glass.position.y / (2 * this._halfH)) * grA.height;
      _pourHandoff.cupSeen = cupPxY > -60 && cupPxY < window.innerHeight + 60;
      // the bottle sized (or resized) after us: retake our ratio from it
      if (_pourHandoff.bPx && Math.abs((this._cupSrc || 0) - _pourHandoff.bPx) > 1) this._resize();
      var t = this._clock.elapsedTime;

      // fill target follows the scroll progress the page writes into --p
      var p = parseFloat(this.style.getPropertyValue('--p'));
      if (isNaN(p)) p = 0;
      var target = this._reduce ? 0.68 : Math.min(0.85, p * 0.95);
      var diff = target - this._level;
      var pour = this._reduce ? 0 : smoothstep(0.001, 0.03, diff);
      var live = _pourHandoff.live && !this._reduce;
      // paired with a bottle, water only ever ARRIVES from its pour — no
      // scroll-conjured jet — though scroll-up still un-pours the glass
      if (_pourHandoff.hasBottle && !live) pour = 0;
      if (live) {
        pour = Math.max(pour, Math.min(1, _pourHandoff.ps * 1.15));
        if (this._level < 0.85) diff = Math.max(diff, 0.05);
      }
      // fill is gated ENTIRELY on the jet: water only accumulates while the
      // stream is visibly delivering it, at a rate the jet's flux can supply,
      // on the same clock as the bottle's ~2.5s drain
      var sy = window.scrollY;
      var goingUp = this._lastSy !== undefined && sy < this._lastSy - 1;
      this._lastSy = sy;
      // THE MIRROR: the cup simply holds whatever the bottle has poured so
      // far — arrive after the pour and it is full; rewind and it empties as
      // the bottle refills. No stream to break, nothing to desynchronize.
      if (_pourHandoff.hasBottle) {
        var t2 = (1 - _pourHandoff.bLevel) / 0.8 * 0.85;
        if (t2 < 0) t2 = 0; else if (t2 > 0.85) t2 = 0.85;
        this._level += (t2 - this._level) * (1 - Math.pow(0.15, dt));
      } else {
        if (diff > 0) this._level += Math.min(diff, dt * 0.38 * pour); // standalone: scroll-driven fill
        else this._level += Math.max(diff, -dt * 0.5);
      }

      // ── the highball act: below the words waits a blank stage. The cup
      // leaves its park, rides the middle of the screen while the words go
      // by, then settles on the stage; a whisky bottle drops in, tips, and
      // splits the drink. All scrubbed by scroll, so it rewinds like
      // everything else on this page.
      var wp = 0, wjet = null;
      this._hbRide = false;
      if (this._hb && _pourHandoff.hasBottle && this.parentElement) {
        this._hbRide = true;
        var hb = this._hb.getBoundingClientRect();
        var vh = window.innerHeight;
        var cupPx = this._cupPx || 269;
        var pr2 = this.parentElement.getBoundingClientRect();
        var base0 = pr2.top + (this._narrow ? 0.40 : 0.62) * Math.max(1, pr2.height); // the herowords park
        // highball progress — computed up here so the cup can react to it (it
        // depends only on the section rect, not on the cup's own position)
        var w = Math.max(0, Math.min(1, (vh * 0.80 - hb.top) / Math.max(1, hb.height - vh * 0.20)));
        // where the cup snaps: a low resting line (not screen-centre), which is
        // exactly where the stationary blue aura sits. baseScr is the cup's
        // BOTTOM screen-Y, so SNAP_FRAC*vh is the cup's centre when locked.
        var SNAP_FRAC = this._narrow ? 0.56 : 0.62;
        var baseLock = vh * SNAP_FRAC + cupPx * 0.5;
        // once the decanter is up, the cup keeps going — down to the bottom of
        // the screen — to open room above it for the vessel and its pour
        var descend = this._wb ? smoothstep(0.14, 0.52, w) : 0;
        var bottomScr = vh - 12;                             // cup bottom at the screen floor
        var lock = baseLock + (bottomScr - baseLock) * descend;
        var M2 = Math.max(8, (vh - cupPx) * 0.5 * (1 - descend)); // margin relaxes as it drops
        var baseScr = Math.min(Math.max(lock, base0), hb.bottom - M2);
        // the cup keeps its longitude: it rides straight down the pour line
        this._glass.position.x = (this._fxDefault - 0.5) * 2 * this._halfW;
        // one smooth glide: low-pass the scroll-driven target into one eased motion
        var rideY = (0.5 - (baseScr - grA.top) / Math.max(1, grA.height)) * 2 * this._halfH;
        if (this._rideY === undefined) this._rideY = rideY;
        this._rideY += (rideY - this._rideY) * (1 - Math.pow(0.0025, dt));
        this._glass.position.y = this._rideY;
        // ── snap: the stationary blue aura sits at the snap line; --snap blooms
        // it as the cup ARRIVES and fades as the cup rides on past to the bottom,
        // so the aura never follows the cup. The first time it locks, the scroll
        // is held a beat so the reader takes it in, then released. One-shot,
        // rewind-safe, capped at SNAP_HOLD so it can never trap.
        var SNAP_HOLD = 0.85;
        var nearSnap = 1 - Math.min(1, Math.abs(baseScr - baseLock) / Math.max(1, cupPx * 1.1));
        var lockAmt = (baseLock >= base0) ? nearSnap * (1 - descend) : 0;
        document.documentElement.style.setProperty('--snap', lockAmt.toFixed(3));
        if (!this._reduce) {
          var atLock = baseLock >= base0 && Math.abs(baseScr - baseLock) <= 3 && descend < 0.08 && (hb.bottom - M2) > baseLock + 4;
          if (atLock && !this._snapDone && !goingUp) {
            if (!this._snapT) { this._snapT = t; this._snapY = window.scrollY; }
            if (t - this._snapT < SNAP_HOLD) { if (window.scrollY > this._snapY) window.scrollTo(0, this._snapY); }
            else this._snapDone = true;
          }
          if (goingUp && baseLock < base0) { this._snapDone = false; this._snapT = 0; }
        }
        // whisky timeline, scrubbed by how deep the stage has been ridden —
        // asleep until the user's bottle file gives us _wb again (w computed above)
        if (this._wb) {
          this._extra = 0.07 * smoothstep(0.50, 0.74, w);
          var a2 = smoothstep(0.06, 0.24, w) * (1 - smoothstep(0.90, 0.995, w));
          if (a2 > 0.002) {
            this._whiskyArm();
            var k2 = smoothstep(0.28, 0.52, w) * (1 - smoothstep(0.76, 0.92, w));
            var rz2 = k2 * 1.45;
            var wbx = this._glass.position.x + (this._narrow ? 0.95 : 1.30) - k2 * 0.45;
            var wby = this._glass.position.y + 0.55 + (1 - a2) * 1.4 + k2 * 0.62;
            this._wb.visible = true;
            this._wb.position.set(wbx, wby, 0);
            this._wb.rotation.z = rz2;
            this._wbMats.forEach(function (m) { m.opacity = m._op0 * a2; });
            // the stopper pops off BEFORE the pour and seats back AFTER — a quiet
            // vertical lift up the neck axis, scrubbed by the same w so it rewinds.
            //   lift  0.20 -> 0.34 : fully off before the pour ramps in at ~0.50
            //   hold  0.34 -> 0.82 : held above the mouth through the whole pour
            //   seat  0.82 -> 0.90 : back on after the pour, before the fade-out
            if (this._wbCork) {
              var s2 = smoothstep(0.20, 0.34, w) * (1 - smoothstep(0.82, 0.90, w));
              this._wbCork.position.set(this._corkSeat.x, this._corkSeat.y + s2 * 0.42, this._corkSeat.z);
            }
            wp = smoothstep(0.50, 0.56, w) * (1 - smoothstep(0.70, 0.78, w));
            if (wp > 0.01) {
              wjet = { x0: wbx - 0.75 * Math.sin(rz2), y0: wby + 0.75 * Math.cos(rz2),
                       vx: -0.25 * k2, vy: -0.6, g: 12.5, r0: 0.022 + 0.02 * wp,
                       cupX: this._glass.position.x };
            }
          } else this._wb.visible = false;
          // hand the copy its cue (CSS reads --hb): the line lands after the pour
          if (Math.abs((this._hbLast || 0) - w) > 0.002) {
            this._hbLast = w;
            this._hb.style.setProperty('--hb', w.toFixed(3));
          }
        }
      } else if (this._wb) this._wb.visible = false;

      // waterline
      var waterY = this._glass.position.y + this._waterBase + Math.min(0.92, this._level + this._extra) * (0.97 - this._waterBase);
      this._waterPlane.constant = waterY;
      var rIn = this._innerR(waterY - this._glass.position.y) * 0.995;
      this._waterTop.position.set(0, waterY + 0.002 - this._glass.position.y, 0); // local to the glass group
      this._waterTop.scale.set(rIn, rIn, 1);
      this._waterTop.visible = this._level + this._extra > 0.02;

      // the whisky folds in: the water warms toward gold as the spirit lands
      if (this._waterC0 === undefined) {
        this._waterC0 = this._water.material.color.clone();
        this._waterC1 = new THREE.Color(0x9a6a34);   // whisky-in-water: warm amber-brown
        this._topC0 = this._waterTop.material.color.clone();
        this._topC1 = new THREE.Color(0xc79a5c);     // a lighter amber on the surface
      }
      var wmix = Math.min(1, this._extra / 0.07) * 0.78;
      this._water.material.color.lerpColors(this._waterC0, this._waterC1, wmix);
      this._waterTop.material.color.lerpColors(this._topC0, this._topC1, wmix);

      // feed the shared water-realism shader uniforms (guarded — they only
      // exist after the first program compile)
      if (this._waterUniforms) {
        this._waterUniforms.uWaterlineY.value = waterY;
        this._waterUniforms.uBaseY.value = this._glass.position.y + this._waterBase;
        this._waterUniforms.uTime.value = t;
        this._waterUniforms.uAgitate.value = Math.max(pour, wp);
      }
      if (this._waterTopUniforms) this._waterTopUniforms.uTime.value = t;

      // reduced-motion is a still-life: once settled with no particles alive,
      // skip the render entirely — a second WebGL context costs nothing idle
      if (this._reduce && Math.abs(diff) < 0.001 && !this._splashData.length &&
          !this._bubData.length && !this._needsRender) return;
      this._needsRender = false;

      // the jet IS the bottle's jet: its exit state arrives in viewport px,
      // converts into this scene's world units, and the whole stream — lip to
      // cup — is drawn by this one overlapping canvas. No border, no cut.
      var jet = this._jet || (this._jet = {});
      var covers = !live; // the default frame-top jet needs no coverage test
      if (live) {
        var gr = this.getBoundingClientRect();
        _pourHandoff.glassTop = gr.top;
        // only take the stream over once this canvas actually COVERS the
        // bottle's mouth — WITH HYSTERESIS: the mouth bobs, and a hard
        // threshold made the two jets flap ownership (the stream blinked)
        covers = this._covers ? (_pourHandoff.my >= gr.top + 12)
                              : (_pourHandoff.my >= gr.top + 70);
        this._covers = covers;
        _pourHandoff.covered = covers; // single source of truth for the bottle's gate
        var w2x = (2 * this._halfW) / Math.max(1, gr.width);
        var w2y = (2 * this._halfH) / Math.max(1, gr.height);
        jet.x0 = ((_pourHandoff.mx - gr.left) / Math.max(1, gr.width) - 0.5) * 2 * this._halfW;
        jet.y0 = (0.5 - (_pourHandoff.my - gr.top) / Math.max(1, gr.height)) * 2 * this._halfH;
        jet.vx = _pourHandoff.vx * w2x;
        jet.vy = -_pourHandoff.vy * w2y;              // back to world, +up
        jet.g = Math.max(0.5, _pourHandoff.g * w2y);
        jet.r0 = Math.max(0.012, _pourHandoff.r * w2y);
      } else {
        jet.x0 = this._glass.position.x; jet.y0 = this._topY;
        jet.vx = 0; jet.vy = -10; jet.g = 12.5;
        jet.r0 = 0.024 + 0.018 * pour;
      }
      // where this ballistic arc lands = where the cup wants to be. The raw
      // landing shivers with the bottle's bob and the glug, so it's low-pass
      // filtered, and the cup GLIDES to it with a deadband — no more darting
      var fall0 = Math.max(0.01, jet.y0 - waterY);
      var vd0 = Math.max(0, -jet.vy);
      var tof0 = (Math.sqrt(vd0 * vd0 + 2 * jet.g * fall0) - vd0) / jet.g;
      var rawLand = jet.x0 + jet.vx * tof0;
      this._landS = this._landS === undefined ? rawLand
                  : this._landS + (rawLand - this._landS) * (1 - Math.pow(0.2, dt));
      var landX = this._landS;
      var fxT = live ? Math.min(0.45, Math.max(0.06, 0.5 + landX / (2 * this._halfW)))
                     : this._fxDefault;
      var dfx = fxT - this._fx;
      if (Math.abs(dfx) > 0.004) this._fx += dfx * (1 - Math.pow(0.45, dt));
      if (!this._hbRide) this._glass.position.x = (this._fx - 0.5) * 2 * this._halfW; // the highball ride owns the cup
      // the stream's tail bends INTO the cup (water guided by its own
      // momentum) — the pour always ends inside the glass, never beside it
      jet.cupX = this._glass.position.x;
      jet.tofl = tof0;
      var jx = this._glass.position.x;
      // if the real-footage pour is present it draws the stream; the
      // procedural jet stands down (droplets, splash and fill continue)
      var jpour = covers ? pour : 0;
      if (wjet) { jet = wjet; jpour = wp; }   // the whisky borrows the jet
      var videoOn = this._updateVideoJet(wjet ? 0 : jpour, jet, waterY);
      this._updateJet(videoOn ? 0 : jpour, jet, waterY, t);
      syncWaterSheen(this._stream, this._sheen);
      this._updateSplash(dt, Math.max(pour, wp), jx, waterY);
      this._updateBubbles(dt, Math.max(pour, wp), jx, waterY, rIn);

      this._renderer.render(this._scene, this._camera);
    }

    /* draws the jet as one ballistic arc from the `jet` entry state — either
       the bottle's live mouth state (converted from viewport px) or the
       default frame-top drop — down to the water surface */
    _updateJet(pour, jet, waterY, time) {
      var stream = this._stream, core = this._core;
      if (pour <= 0.01) {
        stream.material.opacity = Math.max(0, stream.material.opacity - 0.08);
        core.material.opacity = Math.max(0, core.material.opacity - 0.12);
        if (stream.material.opacity <= 0.01) { stream.visible = false; core.visible = false; }
        return;
      }
      var posA = stream.geometry.attributes.position.array;
      var norA = stream.geometry.attributes.normal.array;
      var colA = stream.geometry.attributes.color.array;
      var posC = core.geometry.attributes.position.array;
      var RINGS = this._strRings, SEG = this._strSeg;
      // ── REBUILT FROM SCRATCH: the identical clean column as the bottle's —
      // same ballistic arc, same taper, same ripple phase, same aeration.
      // ONE liquid. A tiny quadratic drift folds the landing into the cup as
      // part of the arc itself — no late elbow.
      var G = jet.g, r0 = jet.r0;
      var fall = Math.max(0.01, jet.y0 - waterY); // guard: sqrt stays real, tofl > 0
      var vd = Math.max(0, -jet.vy);
      var tofl = (Math.sqrt(vd * vd + 2 * G * fall) - vd) / G;
      var dtt = tofl / (RINGS - 1);
      var nr = 0;
      var corr = 0;
      if (jet.cupX !== undefined) {
        corr = jet.cupX - (jet.x0 + jet.vx * tofl);
        if (corr > 0.4) corr = 0.4; else if (corr < -0.4) corr = -0.4;
      }
      for (var i = 0; i < RINGS; i++) {
        var tt = i * dtt;
        var wy = jet.y0 + jet.vy * tt - 0.5 * G * tt * tt;
        var u = time - tt;
        var fr = tt / Math.max(1e-4, tofl);
        // the identical throat flare as the bottle's jet — same birth at the lip
        var thr = 1 - fr / 0.10; if (thr < 0) thr = 0;
        var r = r0 * (1 - 0.22 * fr) * (1 + 0.07 * Math.sin(u * 22.0)) * (1 + 0.35 * thr * thr);
        if (r < 0.008) r = 0.008;
        var wx = jet.x0 + jet.vx * tt + corr * fr * fr;
        for (var j = 0; j < SEG; j++) {
          var a2 = j / SEG * Math.PI * 2;
          var nx = Math.cos(a2), nz = Math.sin(a2);
          var o = (i * SEG + j) * 3;
          var aer = 0.94 + 0.10 * Math.max(0, Math.sin(u * 13.0 + a2 * 0.5));
          colA[o] = aer; colA[o + 1] = aer; colA[o + 2] = aer;
          posA[o] = wx + nx * r; posA[o + 1] = wy; posA[o + 2] = nz * r;
          norA[o] = nx; norA[o + 1] = 0; norA[o + 2] = nz;
          var rc = r * 0.45;
          posC[o] = wx + nx * rc; posC[o + 1] = wy; posC[o + 2] = nz * rc;
        }
        nr = i + 1;
        if (wy <= waterY) break;
      }
      stream.geometry.setDrawRange(0, (nr - 1) * SEG * 6);
      core.geometry.setDrawRange(0, (nr - 1) * SEG * 6);
      stream.geometry.attributes.position.needsUpdate = true;
      stream.geometry.attributes.normal.needsUpdate = true;
      stream.geometry.attributes.color.needsUpdate = true;
      core.geometry.attributes.position.needsUpdate = true;
      stream.visible = true; core.visible = true;
      // full presence instantly — the fade-in ramp read as transparency
      stream.material.opacity = WATER_JET_OP * Math.min(1, 0.35 + pour * 3);
      core.material.opacity = WATER_CORE_OP * Math.min(1, 0.35 + pour * 3);
    }

    _updateSplash(dt, pour, x, waterY) {
      var mesh = this._splash, data = this._splashData, dummy = this._dummy;
      if (pour > 0.05) {
        this._splashClock += dt * 55 * pour;
        var n = Math.floor(this._splashClock);
        this._splashClock -= n;
        for (var k = 0; k < n && data.length < mesh.instanceMatrix.count; k++) {
          var ang = Math.random() * Math.PI * 2;
          var sp = 0.15 + Math.random() * 0.5 * pour;
          var rs = 0.03 + Math.random() * 0.02; // the ejecta sheet starts at the jet's rim, not its core
          data.push({
            x: x + Math.cos(ang) * rs, y: waterY + 0.005, z: Math.sin(ang) * rs,
            vx: Math.cos(ang) * sp, vy: 1.5 + Math.random() * 1.8 * pour, vz: Math.sin(ang) * sp,
            life: 0.55, s: 0.5 + Math.random() * 0.9
          });
        }
      }
      var gx0 = this._glass.position.x, gy0 = this._glass.position.y;
      for (var i = data.length - 1; i >= 0; i--) {
        var q = data[i];
        q.vy -= 12.5 * dt; // same stylized gravity as the jet
        q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
        q.life -= dt;
        // the glass is a wall: droplets that reach it wet it and die there
        var lrr = Math.sqrt((q.x - gx0) * (q.x - gx0) + q.z * q.z);
        var hitWall = (q.y - gy0) < GH && lrr > this._innerR(q.y - gy0) * 0.95;
        if (q.life <= 0 || hitWall || (q.vy < 0 && q.y < waterY)) { data[i] = data[data.length - 1]; data.pop(); }
      }
      mesh.count = data.length;
      for (var m = 0; m < data.length; m++) {
        var d = data[m];
        dummy.position.set(d.x, d.y, d.z);
        var vm = Math.sqrt(d.vx * d.vx + d.vy * d.vy + d.vz * d.vz);
        var sc = d.s * Math.min(1, d.life * 3);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(sc, sc * (1 + Math.min(0.8, vm * 0.5)), sc);
        dummy.updateMatrix();
        mesh.setMatrixAt(m, dummy.matrix);
      }
      if (data.length) mesh.instanceMatrix.needsUpdate = true;
    }

    _updateBubbles(dt, pour, x, waterY, rIn) {
      var mesh = this._bub, data = this._bubData, dummy = this._dummy;
      // bead positions are LOCAL to the glass group: the cup rides the page
      // (its world position changes every frame), and world-anchored beads
      // smeared down the screen behind it — locals travel with the drink
      var gx = this._glass.position.x, gy = this._glass.position.y;
      var floorY = this._waterBase + 0.015;
      var wyr = waterY - gy;
      if (pour > 0.05 && wyr - floorY > 0.05) {
        this._bubClock += dt * 26 * pour;
        var n = Math.floor(this._bubClock);
        this._bubClock -= n;
        for (var k = 0; k < n && data.length < mesh.instanceMatrix.count; k++) {
          data.push({
            x: (x - gx) + (Math.random() - 0.5) * 0.08,
            y: Math.max(floorY, wyr - 0.10 - Math.random() * 0.25),
            z: (Math.random() - 0.5) * 0.08,
            v: 0.30 + Math.random() * 0.35, w: Math.random() * Math.PI * 2,
            s: 0.5 + Math.random() * 1.1
          });
        }
      }
      // it's SPARKLING water: fine carbonation beads nucleate across the
      // glass floor and lower walls and climb whenever the cup holds any —
      // slower and smaller than the pour churn, champagne-style
      if (!this._reduce && wyr - floorY > 0.04) {
        this._fizzClock = (this._fizzClock || 0) + dt * 13;
        var nf = Math.floor(this._fizzClock);
        this._fizzClock -= nf;
        for (var kf = 0; kf < nf && data.length < mesh.instanceMatrix.count; kf++) {
          var fa = Math.random() * Math.PI * 2;
          var fr = Math.sqrt(Math.random()) * rIn * 0.85;
          data.push({
            x: Math.cos(fa) * fr,
            y: floorY + Math.random() * Math.max(0.02, (wyr - floorY) * 0.5),
            z: Math.sin(fa) * fr,
            v: 0.10 + Math.random() * 0.16, w: Math.random() * Math.PI * 2,
            s: 0.5 + Math.random() * 0.75
          });
        }
      }
      for (var i = data.length - 1; i >= 0; i--) {
        var b = data[i];
        b.w += dt * 6;
        b.y += b.v * dt;
        b.x += Math.sin(b.w) * 0.01 * dt * 60 * 0.016 * 4;
        // stay inside the tumbler wall
        var rr = Math.sqrt(b.x * b.x + b.z * b.z);
        var rMax = this._innerR(b.y) * 0.92;
        if (rr > rMax && rr > 0) { b.x *= rMax / rr; b.z *= rMax / rr; }
        if (b.y >= wyr - 0.004) { data[i] = data[data.length - 1]; data.pop(); continue; }
      }
      mesh.count = data.length;
      for (var m = 0; m < data.length; m++) {
        var q = data[m];
        dummy.position.set(gx + q.x, gy + q.y, q.z);
        var sq = 1 + Math.sin(q.w * 1.7) * 0.15;
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(q.s * sq, q.s / sq, q.s * sq);
        dummy.updateMatrix();
        mesh.setMatrixAt(m, dummy.matrix);
      }
      if (data.length) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  customElements.define('bottle-3d', Bottle3D);
  customElements.define('glass-3d', Glass3D);
})();
