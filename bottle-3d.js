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
  // taken over and the page ALWAYS opens fresh. NO exceptions — not even a
  // #hash: a hash left in the URL by a nav tap (/#story) made every RELOAD
  // reopen mid-story, which kept reading as "starts in the middle of the
  // animation" on phones (user: "every reload starts at the beginning —
  // no saved position, no anything"). The hash is stripped before the
  // browser can anchor to it — browsers re-anchor repeatedly while content
  // loads, so fighting the scroll without removing the hash is not enough.
  // In-page nav links still glide normally once the page is up.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  // INSTANT jump to the top — overriding the site's scroll-behavior:smooth.
  // (A plain scrollTo(0,0) ANIMATES up through the whole choreography, which
  // read as "the screen slowly goes up by itself" on phones. Never animate
  // a reset.)
  // INSTANT programmatic scroll — the site's scroll-behavior:smooth would
  // otherwise ANIMATE every clamp, and each animated clamp re-fires scroll
  // events that re-clamp: a rubber-band feedback loop that reads as glitchy,
  // fighting scroll (THE WALL's original sin). Snap, never glide.
  function snapScroll(y) {
    var de = document.documentElement, pb = de.style.scrollBehavior;
    de.style.scrollBehavior = 'auto';
    window.scrollTo(0, y);
    de.style.scrollBehavior = pb;
  }
  function snapTop() { snapScroll(0); }
  /* STAGE-1 READY: the hero bottle's body path has COMMITTED (the real GLB —
     glass + label + cap — or the procedural fallback). The page loader HOLDS
     until this fires (script.js/mobile.js), so the reader never meets a
     half-built bottle; stage-2 assets (the decanter) also key off it. */
  function markHeroReady() {
    if (window.__heroReady) return;
    window.__heroReady = true;
    try { document.dispatchEvent(new CustomEvent('mastry:heroready')); } catch (e) {}
  }
  // drop any #hash BEFORE the browser anchors to it (see above) — the URL
  // stays clean so later reloads can't reopen mid-story either
  if (location.hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
  snapTop();
  // MOBILE: browsers (iOS Safari especially) restore the old position
  // ASYNCHRONOUSLY — even SECONDS later on a slow connection, after any
  // short guard has expired. So the top is enforced until the reader's own
  // first REAL SCROLL GESTURE, with a generous 8s ceiling.
  //
  // "Real scroll gesture" means wheel, a MOVING finger, or a key — NOT a
  // bare touchstart/pointerdown. Readers idly tap or rest a finger while a
  // slow page loads; that tap used to disarm the guard, and the browser's
  // seconds-late restore then landed the page mid-choreography (the
  // recurring "opens mid-animation" mobile bug — 507820d's root cause,
  // regressed when 38d05e7 put touchstart back in the disarm list).
  var freshPin = true;
  var disarmFresh = function () { freshPin = false; };
  ['wheel', 'touchmove', 'keydown'].forEach(function (t) {
    window.addEventListener(t, disarmFresh, { passive: true, once: true });
  });
  // a real mouse press is a deliberate desktop gesture and may disarm; taps
  // arrive with pointerType 'touch' and must NOT (see above)
  window.addEventListener('pointerdown', function (e) { if (e.pointerType === 'mouse') freshPin = false; }, { passive: true });
  // the restore can land while rAF is throttled (backgrounded tab, low-power
  // mode) — catch it on the scroll event itself, not only in the rAF loop
  var undoRestore = function () { if (freshPin && window.scrollY > 1) snapTop(); };
  window.addEventListener('scroll', undoRestore, { passive: true });
  var freshT0 = Date.now();
  (function enforceTop() {
    if (!freshPin) { window.removeEventListener('scroll', undoRestore); return; }
    if (window.scrollY > 1) snapTop();
    if (Date.now() - freshT0 < 8000) requestAnimationFrame(enforceTop);
    else {
      // ceiling reached with NO reader gesture yet: any scroll standing here
      // is the browser's late restore (it can land while the tab is hidden
      // and this loop is paused) — one final snap, then stand down
      if (window.scrollY > 1) snapTop();
      freshPin = false;
      window.removeEventListener('scroll', undoRestore);
    }
  })();
  window.addEventListener('pageshow', function (e) {
    // EVERY show opens at the top — reloads, bfcache returns, hash or no hash
    if (location.hash) { try { history.replaceState(null, '', location.pathname + location.search); } catch (err) {} }
    if (e.persisted || freshPin) snapTop(); // bfcache return, or still pre-gesture — never yank a reader who already scrolled
    var b = document.querySelector('bottle-3d');
    if (e.persisted && b) { b._level = 1; b._wallT = 0; } // bfcache: full bottle, wall re-armed
  });

  // nav/CTA anchor links glide with scroll-behavior:smooth; THE WALL must stand
  // down while one is in flight or the glide dies mid-pour (script.js stamps
  // __anchorGlide on every in-page link click)
  function anchorGlideActive() { return window.__anchorGlide && Date.now() - window.__anchorGlide < 1500; }
  // Is the script.js CONDUCTOR still GOVERNING the page? When a conductor is
  // live (wait | tween | hold) it owns the pour cut-scene itself — it tweens to
  // the very same wallY and runs its own drain-hold there — so our lock must
  // stand aside for its ENTIRE run, not just its tween: engaging in its wake
  // (the sliver between its drain threshold 0.25 and ours 0.245) would stack a
  // second ~1.2s freeze on the guided reader. The lock is the keeper only when
  // NO conductor governs: the conductor is 'done' (End key / nav / the final
  // hand-off retired it), or there is no conductor at all (?noguide, a
  // deep-linked hash load, reduced-motion). Then every native descent past the
  // pour is ours to catch.
  function conductorLive() {
    var c = window.__conductor;
    return !!(c && c.state !== 'done');
  }

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
  /* hot-path sampler: the per-particle loops used to linear-scan the 45-entry
     PROFILE per bubble per frame. Sampled once into a 512-entry LUT (linear
     inside — sub-millimetre error on this smooth silhouette); radiusAt stays
     for exact one-off calls. */
  var R_LUT_N = 512, R_LUT = new Float32Array(R_LUT_N + 1);
  for (var _ri = 0; _ri <= R_LUT_N; _ri++) R_LUT[_ri] = radiusAt(H * _ri / R_LUT_N);
  function radiusAtFast(y) {
    if (y <= 0) return 0.3;
    if (y >= H) return R_LUT[R_LUT_N];
    var f = y * (R_LUT_N / H), i = f | 0, t = f - i;
    return R_LUT[i] + (R_LUT[i + 1] - R_LUT[i]) * t;
  }
  /* pre-allocated particle pool slot: spawns REUSE dead slots (swap-pop on
     death) instead of allocating an object literal per particle — at ~200
     spawns/s the churn was a GC tick source mid-pour */
  function poolTake(pool, data) {
    if (data.length >= pool.length) return null;
    var o = pool[data.length];
    data.push(o);
    return o;
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
     Body: Beer-Lambert depth absorption with a lifted reflection floor
     (mix(1,absorb,0.68)) so grazing env highlights never dull to mud —
     re-solved UP for the espresso-dark speakeasy stage, where a full
     Beer-Lambert body would just sink into the near-black backdrop,
     fresnel silhouette density, and a caustic band pinned to
     uWaterlineY. Alpha is capped at 0.72 so the fill never goes inky
     over the candle pool; the LIQUID now reads from its carved fresnel
     edge + warmed strip glare, not from the body fill. */
  function installWaterBodyShader(mat, holder) {
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uWaterlineY = { value: 2.32 };
      shader.uniforms.uBaseY = { value: 0.0 };
      shader.uniforms.uTime = { value: 0.0 };
      shader.uniforms.uAgitate = { value: 0.0 };
      holder._waterUniforms = shader.uniforms;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPosW;\nvarying vec3 vWNorW;')
        .replace('#include <begin_vertex>',
                 '#include <begin_vertex>\n  vWPosW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n  vWNorW = mat3( modelMatrix ) * normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', [
          '#include <common>',
          'varying vec3 vWPosW;',
          'varying vec3 vWNorW;',
          'uniform float uWaterlineY, uBaseY, uTime, uAgitate;',
          // cheap 3-octave trig noise — drifting caustic webs, no texture fetch
          'float liqN( vec3 p ){ return sin( p.x ) * sin( p.y ) * sin( p.z ); }',
          'float liqCaustic( vec3 p, float t ){',
          '  float n = liqN( p * 7.0 + vec3( 0.0, -t * 1.3, t * 0.7 ) );',
          '  n += 0.5 * liqN( p * 15.0 + vec3( t * 0.9, -t * 2.1, 0.0 ) );',
          '  n += 0.25 * liqN( p * 29.0 + vec3( -t * 1.7, 0.0, t * 1.1 ) );',
          '  return n;',
          '}',
          // two world-space studio strip lights: the vessel rotates under them,
          // so the glare sweeps the liquid exactly as the glass tilts
          'vec3 liqStripGlare( vec3 Nw, vec3 wpos ){',
          '  vec3 V = normalize( cameraPosition - wpos );',
          '  vec3 R = reflect( -V, normalize( Nw ) );',
          '  float s1 = pow( max( dot( R, normalize( vec3( -0.45, 0.80, 0.42 ) ) ), 0.0 ), 90.0 );',
          '  float s2 = pow( max( dot( R, normalize( vec3( 0.62, 0.30, 0.72 ) ) ), 0.0 ), 220.0 );',
          // candle-tinted warm-white (never pure white — that reads fluorescent
          // on the dark stage); brighter s1 key so the sheen carries the liquid
          '  return vec3( 1.0, 0.92, 0.78 ) * ( s1 * 1.25 + s2 * 0.7 );',
          '}'
        ].join('\n'))
        .replace('#include <output_fragment>', [
          'vec3  V     = normalize( vViewPosition );',
          'float ndv   = abs( dot( normalize( normal ), V ) );',
          'float fres  = pow( 1.0 - ndv, 3.0 );',
          'float wy    = vWPosW.y;',
          // turbulence: the meniscus band itself wanders with the liquid
          'float turb  = liqCaustic( vWPosW * 2.6, uTime * 1.4 );',
          'float d     = wy - uWaterlineY + turb * 0.012 * ( 0.35 + uAgitate );',
          'float depth = clamp( ( uWaterlineY - wy ) / max( 0.05, uWaterlineY - uBaseY ), 0.0, 1.0 );',
          'float thick = depth * 0.9 + fres * 0.8;',
          'vec3  absorb = exp( -vec3( 0.42, 0.14, 0.28 ) * thick );',
          // lifted floor (0.75 -> 0.68): on the espresso stage a fuller absorb
          // sank the body to mud; this keeps the cool-sage fill barely alive
          'vec3  col    = outgoingLight * mix( vec3( 1.0 ), absorb, 0.68 );',
          // caustic light webs drifting through the body, agitation-bright
          'float ca   = liqCaustic( vWPosW * 1.7, uTime );',
          'float web  = smoothstep( 0.25, 1.0, 0.5 + 0.5 * ca );',
          'col += vec3( 0.30, 0.42, 0.36 ) * web * ( 0.05 + 0.30 * uAgitate ) * ( 0.35 + depth );',
          'float line   = exp( -( d * d ) / ( 0.020 * 0.020 ) );',
          'float shim   = 0.7 + 0.3 * sin( wy * 38.0 + uTime * 5.0 );',
          'col += vec3( 0.34, 0.40, 0.36 ) * line * ( 0.35 + 0.5 * uAgitate ) * shim;',
          'col += vec3( 0.30, 0.36, 0.33 ) * line * fres * 0.5;',
          // strip-light glare — moves with the tilt, hottest at the silhouette
          // widened the base sheen (0.30->0.45) so the glare rides even the
          // flatter faces — the moving candle streak is the liquid's read on dark
          'col += liqStripGlare( vWNorW, vWPosW ) * ( 0.45 + 0.70 * fres ) * ( 0.50 + 0.55 * min( 1.0, uAgitate + 0.35 ) );',
          // carve the silhouette harder (fres 0.42->0.55): a bright rim is how
          // the eye reads a body of water against the near-black candle pool
          'float a = clamp( diffuseColor.a + fres * 0.55 + line * 0.34 + depth * 0.10 + web * 0.05, 0.0, 0.72 );',
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
      shader.uniforms.uRipAmp = { value: 0.0 };  // impact ripple strength (pour/glug-fed)
      shader.uniforms.uRipPh = { value: 0.0 };   // ripple phase, advanced per frame
      holder._waterTopUniforms = shader.uniforms;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vR;\nvarying vec2 vP;\nvarying vec3 vWW;\nvarying vec3 vWN;\nuniform float uDiscR;')
        .replace('#include <begin_vertex>',
                 '#include <begin_vertex>\n  vR = length( position.xy ) / uDiscR;\n  vP = position.xy / uDiscR;\n  vWW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n  vWN = mat3( modelMatrix ) * normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', [
          '#include <common>',
          'varying float vR;',
          'varying vec2 vP;',
          'varying vec3 vWW;',
          'varying vec3 vWN;',
          'uniform float uTime, uRipAmp, uRipPh;',
          'vec3 topStripGlare( vec3 Nw, vec3 wpos ){',
          '  vec3 V = normalize( cameraPosition - wpos );',
          '  vec3 R = reflect( -V, normalize( Nw ) );',
          '  float s1 = pow( max( dot( R, normalize( vec3( -0.45, 0.80, 0.42 ) ) ), 0.0 ), 110.0 );',
          '  float s2 = pow( max( dot( R, normalize( vec3( 0.62, 0.30, 0.72 ) ) ), 0.0 ), 260.0 );',
          // candle warm-white so the surface catches the room, not a fluorescent glint
          '  return vec3( 1.0, 0.92, 0.78 ) * ( s1 * 1.2 + s2 * 0.75 );',
          '}'
        ].join('\n'))
        .replace('#include <output_fragment>', [
          'vec3  V    = normalize( vViewPosition );',
          'float fres = pow( 1.0 - abs( dot( normalize( normal ), V ) ), 4.0 );',
          'float rim  = smoothstep( 0.80, 0.99, vR );',
          'float rip  = 0.5 + 0.5 * sin( vR * 24.0 - uTime * 2.2 );',
          // impact ripple train — expanding rings off the strike point,
          // amplitude follows the pour; two wavelengths read as real ripples
          'float rr    = length( vP );',
          'float ring  = sin( rr * 30.0 - uRipPh * 7.0 ) * exp( -rr * 2.2 ) * uRipAmp;',
          'float ring2 = sin( rr * 14.0 - uRipPh * 4.2 ) * exp( -rr * 1.4 ) * uRipAmp * 0.5;',
          // sparkling micro-boiling — the surface never sits dead still
          'float boil = sin( vP.x * 34.0 + uTime * 3.3 ) * sin( vP.y * 31.0 - uTime * 2.7 );',
          'boil = ( 0.5 + 0.5 * boil ) * 0.5;',
          'vec3  col  = outgoingLight;',
          'col += vec3( 0.42, 0.52, 0.47 ) * fres * 0.38;',
          'col += vec3( 0.78, 0.90, 0.84 ) * rim * ( 0.30 + 0.10 * rip + abs( ring ) * 0.30 );',
          'col += vec3( 0.55, 0.68, 0.60 ) * ( ring * 0.5 + ring2 * 0.3 );',
          'col += vec3( 0.60, 0.72, 0.66 ) * boil * 0.10;',
          // sky/studio glare lying ON the surface, sweeping with any tilt
          'col += topStripGlare( vWN, vWW ) * ( 0.35 + 0.65 * fres + uRipAmp * 0.4 );',
          'float a = clamp( diffuseColor.a + fres * 0.38 + rim * 0.42 + abs( ring ) * 0.22 + boil * 0.04, 0.0, 0.78 );',
          'gl_FragColor = vec4( col, a );'
        ].join('\n'));
    };
    mat.needsUpdate = true;
  }

  /* the hero pour's LIT stream: world-space strip glare that slides down the
     swaying jet (normals turn under fixed lights) — the wet highlight a real
     falling column catches from the room */
  function installStreamGlareShader(mat) {
    mat.onBeforeCompile = function (shader) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSWPos;\nvarying vec3 vSWNor;')
        .replace('#include <begin_vertex>',
                 '#include <begin_vertex>\n  vSWPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n  vSWNor = mat3( modelMatrix ) * normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\nvarying vec3 vSWPos;\nvarying vec3 vSWNor;')
        .replace('#include <output_fragment>', [
          'vec3 sV = normalize( cameraPosition - vSWPos );',
          'vec3 sN = normalize( vSWNor );',
          'vec3 sR = reflect( -sV, sN );',
          // widened the key lobe (exp 70->52) so the wet highlight is a fatter
          // moving band down the jet — additive over the dark stage is nearly
          // free contrast, so this is where the pour buys its visibility
          'float sg1 = pow( max( dot( sR, normalize( vec3( -0.45, 0.80, 0.42 ) ) ), 0.0 ), 52.0 );',
          'float sg2 = pow( max( dot( sR, normalize( vec3( 0.62, 0.30, 0.72 ) ) ), 0.0 ), 150.0 );',
          // THE PEWTER-RIBBON FIX, take 2 — the persistent warm rim was moved
          // OFF this material onto an additive streamSheen pass (see _buildPour).
          // WHY: everything written to gl_FragColor HERE is still ACES tone-mapped
          // downstream (this is a lit MeshPhysicalMaterial, toneMapped:true), so
          // cranking the rim did nothing — exposure 1.12 rolled a 2.6 rim onto a
          // 1.6 rim, the neutralised hairline in the captures. The sheath now keeps
          // only its honest job: the two moving wet lobes (its real strip glare)
          // plus a faint self-edge. Alpha lifts under the LOBES (the wet streak
          // stays opaque) but NOT across the whole silhouette, so the body + edge
          // stay see-through for the additive rim to carve — no dark opaque
          // hairline for it to fight. Grammar unchanged: transparent tube +
          // glowing edges + moving sheen, never a solid fill.
          'float sfr = 1.0 - abs( dot( sV, sN ) );',
          'float sEdge = pow( sfr, 1.7 );',
          'vec3 sWarm = vec3( 1.0, 0.92, 0.78 );',
          'vec3 sSpec = sWarm * ( sg1 * 1.8 + sg2 * 1.1 ) + sWarm * sEdge * 0.45;',
          'float sA = max( diffuseColor.a, ( sg1 + sg2 ) * 0.75 );',
          'gl_FragColor = vec4( outgoingLight + sSpec, sA );'
        ].join('\n'));
    };
    mat.needsUpdate = true;
  }

  /* the decanter's contained whisky: slow amber currents ("inner fire") and
     strip-light glare that sweeps the spirit as the vessel tips. Uniforms are
     collected on holder._wbShaderU and fed per frame from the act's tick. */
  function installWhiskyLiquidShader(mat, holder) {
    mat.onBeforeCompile = function (shader) {
      shader.uniforms.uTime = { value: 0.0 };
      shader.uniforms.uAgitate = { value: 0.0 };
      (holder._wbShaderU = holder._wbShaderU || []).push(shader.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWkPos;\nvarying vec3 vWkNor;')
        .replace('#include <begin_vertex>',
                 '#include <begin_vertex>\n  vWkPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n  vWkNor = mat3( modelMatrix ) * normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>',
          '#include <common>\nvarying vec3 vWkPos;\nvarying vec3 vWkNor;\nuniform float uTime, uAgitate;')
        .replace('#include <output_fragment>', [
          'vec3 wV = normalize( cameraPosition - vWkPos );',
          'vec3 wR = reflect( -wV, normalize( vWkNor ) );',
          'float ws1 = pow( max( dot( wR, normalize( vec3( -0.45, 0.80, 0.42 ) ) ), 0.0 ), 60.0 );',
          'float ws2 = pow( max( dot( wR, normalize( vec3( 0.62, 0.30, 0.72 ) ) ), 0.0 ), 140.0 );',
          // slow amber currents rolling through the spirit — alive, never flat
          'float fire = sin( vWkPos.y * 9.0 + uTime * 1.6 + sin( vWkPos.x * 7.0 - uTime * 1.1 ) * 1.5 );',
          'fire = 0.5 + 0.5 * fire;',
          'vec3 wcol = outgoingLight;',
          'wcol += vec3( 0.55, 0.26, 0.05 ) * fire * ( 0.10 + 0.28 * uAgitate );',
          'wcol += vec3( 1.0, 0.93, 0.78 ) * ( ws1 * 0.8 + ws2 * 0.5 ) * ( 0.45 + 0.55 * uAgitate );',
          'gl_FragColor = vec4( wcol, diffuseColor.a );'
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
  // RE-SOLVED for the espresso-dark speakeasy stage. These unlit passes are
  // compositing math over the page, NOT lit geometry — every value the old
  // build "solved from pixels" against cream (#F9F5E9) is void. The backdrop
  // behind the bottle is now the frozen candle pool (#201812 edges → #4A3A24
  // centre), flat #14100C elsewhere. Water-on-dark grammar: the eye reads the
  // liquid from bright EDGES/SHEEN/GLINTS, so the body stays a DESATURATED,
  // slightly-cool pale mastic (cool vs. the warm room says "water" and keeps it
  // distinct from the amber whisky act) at or below the old opacity — all the
  // visibility budget goes to the additive sheen pass, never to fill.
  var WATER_JET_TINT = 0xbcd0c6;   // pale COOL sage — restrained body; sheen carries it (was 0xd0e1d8, milky on dark)
  var WATER_CORE_TINT = 0xdaeae2;  // bright cool core reads as solid liquid; knocked off pure-white so it never fluoresces
  var WATER_DROP_TINT = 0xdcebe2;  // droplets, satellites, splash, mist — brightened 0xcfe2d8->0xdcebe2 so the breakup sparkles harder on the dark stage (colour only, counts untouched)
  var WATER_JET_OP = 0.58;         // ceiling 0.80->0.58: 0.80 over near-black composited to a solid mid-grey FILL (the ribbon read as poured pewter). Thinned so the dark shows THROUGH the column — it now reads as a see-through glass tube defined by its edges, not a matte band. uK is a RATIO (opacity/WATER_JET_OP) so the sheen strength is untouched.
  var WATER_CORE_OP = 0.20;        // core 0.26->0.20: a darker see-through interior so the sheath + core stop reading as two flat strips; the edges carry the light
  function waterJetMaterial() {
    // toneMapped:false — ACES would compress the pale sage and, more to the
    // point, these passes must composite as authored over the transparent
    // canvas regardless of the scene's candle relight
    return new THREE.MeshBasicMaterial({ color: WATER_JET_TINT, transparent: true, opacity: 0.0, depthWrite: false, toneMapped: false, vertexColors: true });
  }
  function waterSheenMesh(geo) {
    // fresnel definition pass — THE lever on the dark stage: a CONSTANT bright
    // cool-sage edge (normal blend can never fall darker than this authored
    // colour — no env, no black) plus a candle hot sparkle toward grazing, PLUS
    // two world-space strip lights so the glare slides down the jet as it sways
    // (the tube's normals turn under the fixed lights — wet glass moving). On
    // near-black this additive-ish edge is nearly free contrast, so it is
    // brightened and widened here to make the water stream unmistakable.
    var m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.NormalBlending, side: THREE.FrontSide,
      uniforms: { uK: { value: 0 } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vWN; varying vec3 vWW; void main(){ vN = normalize(normalMatrix * normal); vWN = mat3(modelMatrix) * normal; vec4 wp = modelMatrix * vec4(position, 1.0); vWW = wp.xyz; vec4 mv = viewMatrix * wp; vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: [
        'uniform float uK; varying vec3 vN; varying vec3 vV; varying vec3 vWN; varying vec3 vWW;',
        'void main(){',
        '  float d = 1.0 - abs(dot(normalize(vN), normalize(vV)));',
        '  float f = pow(d, 1.7); float hot = pow(d, 7.0);',   // widened fresnel band (2.0->1.7) — fatter bright edge on dark
        '  vec3 V = normalize(cameraPosition - vWW);',
        '  vec3 R = reflect(-V, normalize(vWN));',
        '  float s1 = pow(max(dot(R, normalize(vec3(-0.45, 0.80, 0.42))), 0.0), 60.0);',
        '  float s2 = pow(max(dot(R, normalize(vec3(0.62, 0.30, 0.72))), 0.0), 170.0);',
        '  vec3 warm = vec3(1.0, 0.92, 0.78);',
        '  vec3 spec = warm * (s1 + s2 * 0.7);',   // candle warm-white glints, not fluorescent white
        // cool-sage fresnel edge (water identity) PLUS a persistent candle-warm
        // rim scaled by the same fresnel f — now that the body is thinned this
        // rim is what makes a STILL frame read "lit water": a fine warm line on
        // the tube silhouette that is always present, not just under the moving lobe
        '  vec3 base = mix(vec3(0.62, 0.76, 0.69), vec3(1.0), hot) + warm * f * 0.45;',
        '  gl_FragColor = vec4(base + spec * 1.5, (f * 0.92 + hot * 0.40 + (s1 + s2) * 0.34) * uK);',   // firmer persistent edge (f 0.85->0.92) so the thinned tube keeps a defined lit silhouette
        '}'
      ].join('\n')
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
      // no WebGL (hardware accel off, VMs): the renderer constructor throws,
      // the static hero photo stays (bottle3d-on never lands) — and the page
      // LOADER must not wait 8s for a hero that can never come: mark ready.
      try { this._initThree(); } catch (e) { markHeroReady(); _pourHandoff.hasBottle = false; return; }
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
      if (this._lockActive) this._releaseLock(); // detached mid-cut-scene: drop the capture listeners + html.cutscene
      cancelAnimationFrame(this._raf);
      if (this._glbTimer) { clearTimeout(this._glbTimer); this._glbTimer = null; } // a pending GLB-timeout must not fire onto a disposed renderer
      if (this._ro) this._ro.disconnect();
      if (this._io) this._io.disconnect();
      if (this._classMO) this._classMO.disconnect();
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
        this._drops.count = Math.min(this._dropMax || 240, Math.round(this._condensation * 70)); // ceiling follows the tier's allocated pool, not a hard 240
        this._drops.visible = this._drops.count > 0;
      }
    }

    /* ---------- scene ---------- */
    _initThree() {
      if (!_v1) { _v1 = new THREE.Vector3(); _v2 = new THREE.Vector3(); _v3 = new THREE.Vector3(); _v4 = new THREE.Vector3(); _v5 = new THREE.Vector3(); _v6 = new THREE.Vector3(); _v7 = new THREE.Vector3(); _vZ = new THREE.Vector3(0, 0, 1); _vY = new THREE.Vector3(0, 1, 0); _q1 = new THREE.Quaternion(); _q2 = new THREE.Quaternion(); }
      // at DPR>=2 pixel density already smooths edges — dropping MSAA halves
      // fill cost on this full-viewport canvas (same call the glass makes)
      var renderer = new THREE.WebGLRenderer({ canvas: this._canvas, alpha: true, antialias: (window.devicePixelRatio || 1) < 2 });
      renderer.setClearColor(0x000000, 0);
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;   // lifted 1.05->1.12: the lit glass + water fill must read against the near-black candlelit stage
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

      // CANDLELIT RIG (re-solved for the espresso stage). Warm amber key,
      // a LIFTED cool-pale rim to carve the glass silhouette out of the dark,
      // a warm point glint for candle sparkle, and a faint low amber bounce
      // (candle pooling up from below the vessel). Kept low-ambient so the
      // glints stay the brightest thing in frame.
      scene.add(new THREE.AmbientLight(0xffdca8, 0.30));            // warm, restrained fill
      var key = new THREE.DirectionalLight(0xffce96, 1.28);         // candle key (was 0xfff8ee 1.15), brighter for the dark stage
      key.position.set(3, 5, 4);
      scene.add(key);
      var rim = new THREE.DirectionalLight(0xdfe9ff, 0.72);         // cool pale rim, LIFTED 0.4->0.72 to edge the glass against near-black
      rim.position.set(-4, 2, -3);
      scene.add(rim);
      var glint = new THREE.PointLight(0xffdca4, 1.0, 30);          // warm candle specular glint (was 0xffffff 0.85)
      glint.position.set(2.4, 3.4, 3.2);
      scene.add(glint);
      var bounce = new THREE.DirectionalLight(0xE0A458, 0.18);      // faint candle-amber bounce from below/front
      bounce.position.set(0, -3, 3);
      scene.add(bounce);

      // Groups: root (drift/tilt) > spin (twist) > bottle (pivot-centred)
      var root = new THREE.Group();
      var spin = new THREE.Group();
      var bottle = new THREE.Group();
      bottle.position.y = -CY;
      spin.add(bottle); root.add(spin); scene.add(root);
      this._root = root; this._spin = spin; this._bottle = bottle;

      // MAX-LOD gate: the owner pulled every budget into the liquid, but only
      // the fast DESKTOP path may spend it. LITE (slow links) and any narrow /
      // forced-mobile viewport stay on the exact old counts — byte-identical.
      // Decided ONCE here so every pool below sizes from the same verdict.
      // innerWidth can be 0 at init (background-tab pre-render, unsized pane) —
      // that's "not laid out yet", not "phone" (phones never reach this page:
      // the router sends them to mobile.html), so fall through to screen.width.
      var vw = window.innerWidth || (window.screen && window.screen.width) || 1280;
      this._fast = !this._isLite() && !(window.__forceMobile || vw <= 760);

      this._buildCapGroups(bottle);
      this._buildBottle(bottle);
      this._buildBubbles(bottle);
      this._buildFizz(bottle);
      this._buildCondensation(bottle);
      this._buildPour(scene);
      this._buildShadow(scene);

      // state
      this._pin = this.closest('.heropin'); // pinned-hero container drives the pour timeline
      this._measurePin();
      this._vel = 0; this._lastScroll = window.scrollY;
      this._frontY = -0.35; // yaw that centres the label's front graphic on camera
      this._rotY = this._frontY; this._driftX = 0; this._driftY = 0; this._tiltV = 0;
      this._capT = 0; this._tiltT = 0;
      this._syncAttrs();
      this._resize();
    }

    _buildBottle(parent) {
      this._buildWater(parent);
      // glass + label + cap come from the user's Blender GLB when provided; the
      // runtime lathe (same silhouette) is the fallback. On a slow connection a
      // pending 3.97MB GLB never fires onError, so a hard timeout + the LITE
      // skip guarantee the glass body ALWAYS renders. _glassBuilt is the
      // single-writer race gate (set ONLY by the two body builders — never in
      // _addGlassShells, which _buildWater also uses for the neck run).
      this._glassBuilt = false; this._latheBuilt = false; this._glbTimer = null;
      this._decideBody(parent);
    }

    // LITE (slow) tier? window.__mastryLite (set in the page head) is
    // authoritative; the self-contained fallback keeps the engine correct even
    // standalone. Auto-detect only ever downgrades PHONES — the bug is mobile.
    _isLite() {
      if (typeof window.__mastryLite === 'boolean') return window.__mastryLite;
      try {
        var t = localStorage.getItem('mastry-tier');
        if (t === 'slow') return true;
        if (t === 'fast') return false;
        if (!(window.__forceMobile || window.innerWidth <= 760)) return false;
        var ts = +localStorage.getItem('mastry-net-ts') || 0;
        if (localStorage.getItem('mastry-net') === 'slow' && Date.now() - ts < 6048e5) return true; // measured, <7d
        var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (c) {
          if (c.saveData) return true;
          if (/(^|-)2g$|(^|-)3g$/.test(c.effectiveType || '')) return true;
          if (c.downlink > 0 && c.downlink < 4.5) return true;         // just under DevTools "Fast 4G"
          if (c.rtt > 300 && c.effectiveType !== '4g') return true;
        }
      } catch (e) {}
      return false;
    }

    // exactly one body path, decided once. FAST/desktop → the modelled GLB
    // (with the 2.5s safety net). LITE → the instant procedural lathe, UNLESS
    // the real GLB is already in the SW cache (reuse it, zero network).
    _decideBody(parent) {
      var bottleSrc = this.getAttribute('bottle-src') || this.getAttribute('bottlesrc');
      if (!bottleSrc || !THREE.GLTFLoader) { this._buildLatheGlass(parent); return; }
      if (!this._isLite()) { this._buildFromGLB(bottleSrc, parent); return; }
      var self = this, decided = false;
      var toLathe = function () { if (decided || !self._started) return; decided = true; self._buildLatheGlass(parent); };
      var toGLB = function () { if (decided || !self._started) return; decided = true; self._buildFromGLB(bottleSrc, parent); };
      try {
        var href = new URL(bottleSrc, location.href).href;
        if (window.caches && caches.match) { setTimeout(toLathe, 200); caches.match(href).then(function (hit) { hit ? toGLB() : toLathe(); }, toLathe); }
        else toLathe();
      } catch (e) { toLathe(); }
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
        envMapIntensity: 1.45, depthWrite: false   // 1.2->1.45: hotter clearcoat glints so the glass sparkles on the candle stage
      }));
      front.renderOrder = 5;
      parent.add(front);
      var fresnel = new THREE.Mesh(glassGeo, new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
        // world-space strip lights: the bottle spins/tilts under them, so the
        // glare travels the glass exactly like a studio softbox would paint it
        vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vWN; varying vec3 vWW; void main(){ vN = normalize(normalMatrix * normal); vWN = mat3(modelMatrix) * normal; vec4 wp = modelMatrix * vec4(position, 1.0); vWW = wp.xyz; vec4 mv = viewMatrix * wp; vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: [
          'varying vec3 vN; varying vec3 vV; varying vec3 vWN; varying vec3 vWW;',
          'void main(){',
          '  float d = 1.0 - abs(dot(normalize(vN), normalize(vV)));',
          '  float f = pow(d, 2.0); float hot = pow(d, 6.5);',   // widened rim band (2.4->2.0): additive over dark carves the glass edge for free
          '  vec3 tint = vec3(0.62, 0.88, 0.72);',
          '  vec3 V = normalize(cameraPosition - vWW);',
          '  vec3 R = reflect(-V, normalize(vWN));',
          '  float s1 = pow(max(dot(R, normalize(vec3(-0.45, 0.80, 0.42))), 0.0), 60.0);',
          '  float s2 = pow(max(dot(R, normalize(vec3(0.62, 0.30, 0.72))), 0.0), 160.0);',
          '  float streak = pow(max(dot(normalize(vWN), normalize(vec3(-0.45, 0.80, 0.42))), 0.0), 18.0);',
          // green rim glow brightened (0.78->1.05); speculars candle-tinted, not pure white
          '  vec3 col = tint * f * 1.05 + vec3(1.0, 0.94, 0.82) * hot * 0.62 + vec3(1.0, 0.92, 0.78) * (s1 * 1.1 + s2 * 0.7) + tint * streak * 0.38;',
          '  gl_FragColor = vec4(col, f * 0.92 + hot * 0.5 + (s1 + s2) * 0.48 + streak * 0.12);',
          '}'
        ].join('\n')
      }));
      fresnel.renderOrder = 6;
      parent.add(fresnel);
    }

    _buildFromGLB(src, parent) {
      var self = this;
      function commitLathe() { if (self._glassBuilt || !self._started || !self._renderer) return; self._glbTimer = null; self._buildLatheGlass(parent); }
      // SAFETY NET: a slow GLB never fires onError (pending ≠ failed), so
      // guarantee the glass within 2.5s with the procedural lathe. A GLB that
      // resolves AFTER this is ignored wholesale (the _glassBuilt guard) — no
      // double bottle. THIS is the fix for "only water and lid on slow wifi".
      // ...EXCEPT while the page LOADER still covers the stage: behind the
      // veil nobody can see an empty hero, so waiting longer for the REAL
      // bottle (glass + label + cap) is free — keep re-checking up to 7s
      // (user: "make sure the bottle loads; if it doesn't, make the loading
      // screen a little longer"). The moment the veil lifts, the 2.5s
      // visible-stage guarantee is back in force.
      var glbT0 = Date.now();
      function loaderUp() { var l = document.getElementById('loader'); return !!(l && !l.classList.contains('done')); }
      function netCheck() {
        self._glbTimer = null;
        if (self._glassBuilt || !self._started || !self._renderer) return;
        if (Date.now() - glbT0 < 7000 && loaderUp()) { self._glbTimer = setTimeout(netCheck, 400); return; }
        commitLathe();
      }
      self._glbTimer = setTimeout(netCheck, 2500);
      // test hook: ?glbdelay=N delays the fetch by N ms (verification only)
      var dm = /[?&]glbdelay=(\d+)/.exec(location.search);
      var loadGLB = function () { new THREE.GLTFLoader().load(src, onGLB, undefined, fail); };
      if (dm) setTimeout(loadGLB, Math.min(20000, +dm[1])); else loadGLB();
      function onGLB(g) {
        if (self._glassBuilt || !self._started || !self._renderer) return; // lathe already committed, or detached mid-load
        if (self._glbTimer) { clearTimeout(self._glbTimer); self._glbTimer = null; }
        g.scene.updateMatrixWorld(true);
        var prims = [];
        g.scene.traverse(function (o) { if (o.isMesh) prims.push(o); });
        var box = new THREE.Box3().setFromObject(g.scene);
        if (!prims.length || box.isEmpty()) return fail();
        self._glassBuilt = true; // committing to the modelled bottle — the timeout/lathe stands down
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
        markHeroReady();   // real bottle committed: glass + label (+ cap) are in
      }
      function fail() { if (self._glbTimer) { clearTimeout(self._glbTimer); self._glbTimer = null; } commitLathe(); }
    }

    _buildLatheGlass(parent) {
      if (this._latheBuilt || this._glassBuilt) return; // idempotent: called from _decideBody, the 2.5s timeout, AND fail() — build exactly once
      this._latheBuilt = true; this._glassBuilt = true;
      var pts = PROFILE.map(function (p) { return new THREE.Vector2(p[0], p[1]); });
      this._addGlassShells(parent, new THREE.LatheGeometry(pts, 144));
      // label: wrap texture on a PROFILE-sized cylinder (the glass shells render
      // WITHOUT it, so a slow label never gates the glass-body guarantee)
      var tex = new THREE.TextureLoader().load((this.getAttribute('label-src') || 'assets/label-full.jpg'));
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
      markHeroReady();   // fallback body committed (label/cap streams fill in)
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
      // max-LOD OBJ cap (assets/cap.obj); procedural fallback below.
      // Phones skip the 6.7MB download outright — at hand-held size the
      // procedural cap reads identically, and cellular gets its bandwidth back.
      if (window.innerWidth <= 760 || window.__mastryLite) return this._buildProceduralCap(); // LITE desktop: don't newly fetch the 6.7MB cap.obj on the lathe path
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
      var COUNT = this._fast ? 320 : 180; // fast desktop: fat headroom for the cap-off surge; LITE/narrow keep 180
      var mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.016, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xe0eee7, transparent: true, opacity: 0.3, depthWrite: false, clippingPlanes: [this._waterPlane] }), COUNT); // pale cool sage, re-solved for the dark fill (was 0xeaf6ef on cream)
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
      var MAX = this._fast ? 300 : 150; // fast desktop: a denser gulp/air-channel train; LITE/narrow keep 150
      // bright cool air so the gulp reads clearly against the sage water (a
      // submerged air bubble catches the light as a pale sphere) — knocked off
      // pure-white so it doesn't fluoresce as a toneMapped:false pass on dark
      var mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.013, 8, 8),
        new THREE.MeshBasicMaterial({ color: 0xe8f4ee, transparent: true, opacity: 0.78, depthWrite: false, toneMapped: false, clippingPlanes: [this._waterPlane] }), MAX);
      mesh.count = 0;
      mesh.renderOrder = 4;
      parent.add(mesh);
      this._fizz = mesh;
      this._fizzData = [];
      this._fizzPool = [];
      for (var fi = 0; fi < MAX; fi++) {
        this._fizzPool.push({ x: 0, y: 0, z: 0, dx: 0, dy: 1, dz: 0, v: 0, s: 0, life: 0, w: 0, pop: false });
      }
    }

    _buildCondensation(parent) {
      // real droplets: tiny glass hemispheres that condense, grow, run down the
      // glass under gravity, and shrink away once they reach the bottom
      var MAX = this._fast ? 460 : 240; // fast desktop: a richer condensation film; LITE/narrow keep 240
      this._dropMax = MAX; // _syncAttrs clamps the live count to THIS, not the old hard 240
      var mesh = new THREE.InstancedMesh(
        new THREE.SphereGeometry(1, 8, 6),
        new THREE.MeshPhysicalMaterial({
          color: 0xeef6f0, transparent: true, opacity: 0.55,
          roughness: 0.04, metalness: 0, envMapIntensity: 3.2, // 2.4->3.2: hotter clearcoat sparkle — condensation glint is a MAX-budget target on the dark stage
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
      var r = radiusAtFast(d.y) + d.sc * 0.18;
      dummy.position.set(Math.cos(d.a) * r, d.y, Math.sin(d.a) * r);
      dummy.lookAt(Math.cos(d.a) * (r + 1), d.y, Math.sin(d.a) * (r + 1));
      var sag = d.sliding ? 1.65 : 1.0 + (d.sc / (d.target || 1)) * 0.3; // heavy drops sag, runners stretch
      dummy.scale.set(d.sc, d.sc * sag, d.sc * 0.5); // flattened against the glass
      dummy.updateMatrix();
      this._drops.setMatrixAt(i, dummy.matrix);
    }

    _buildPour(scene) {
      // shared instanced pool: pour droplets, satellite drops, cap-off mist
      var MAX = this._fast ? 560 : 300; // fast desktop: more breakup drops + mist in flight; LITE/narrow keep 300
      var mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.02, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xeff8f2, transparent: true, opacity: 0.9, depthWrite: false }), MAX); // pale cool droplets read as glints on dark; brightened 0xe2efe8->0xeff8f2 @ 0.75->0.9 so the breakup sparkles harder against near-black (count untouched)
      mesh.renderOrder = 7;
      mesh.count = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this._pour = mesh;
      this._pourData = [];
      // slot pool: spawns reuse pre-allocated slots (swap-pop on death) —
      // no per-particle object literals at ~200 spawns/s
      this._pourPool = [];
      for (var pi = 0; pi < MAX; pi++) {
        this._pourPool.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, l0: 0, s: 0, g: 0, drag: 0, mist: false });
      }
      this._pourClock = 0;
      this._glugPhase = 0; this._glugCool = 0;
      this._fizzBurst = 0; this._fizzArmed = false; this._fizzClock = 0;
      // continuous jet: pre-allocated tube whose ring positions are rewritten
      // in place each frame — no geometry churn. The jet tapers as gravity
      // accelerates it (mass conservation), a Plateau–Rayleigh varicose wave
      // deepens down-stream, and past the breakup length it hands over to
      // the droplet pool above.
      var RINGS = this._strRings = this._fast ? 192 : 64, SEG = this._strSeg = this._fast ? 16 : 10; // pour LOD: fast desktop spends 3x rings + a rounder tube silhouette; LITE/narrow keep 64/10
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
      // ══ the lit clearcoat sheath (now relit as candlelight — its wet
      // highlight comes from the warmed/widened installStreamGlareShader) over
      // the espresso stage + the bright solid-liquid core ══
      var stream = new THREE.Mesh(tubeGeo(true), new THREE.MeshPhysicalMaterial({
        // envMapIntensity 2.0->1.1: the grey studio env reflected off this thin
        // tube WAS the pewter fill (a flat mid-grey the whole ribbon read as poured
        // metal). Cut it so the body goes see-through over the dark stage; the wet
        // read now comes from the glare shader's persistent candle-warm fresnel rim
        // + moving lobes, not from a solid reflected fill.
        color: 0xdceede, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.0,
        envMapIntensity: 1.1, clearcoat: 1, clearcoatRoughness: 0.06, depthWrite: false
      }));
      installStreamGlareShader(stream.material);
      stream.renderOrder = 7;
      stream.visible = false;
      stream.frustumCulled = false;
      scene.add(stream);
      this._stream = stream;
      // bright inner core — reads as solid liquid inside the sheath; cool pale,
      // off pure-white so it doesn't blow out over the dark stage (was 0xfbfefb)
      var core = new THREE.Mesh(tubeGeo(false), new THREE.MeshBasicMaterial({
        color: 0xe6f0ea, transparent: true, opacity: 0.0, depthWrite: false
      }));
      core.renderOrder = 8;
      core.visible = false;
      core.frustumCulled = false;
      scene.add(core);
      this._streamCore = core;
      // ── the PERSISTENT warm edge, lifted OFF the tone-mapped sheath ──────
      // Glass3D's fresnel sheen pass (waterSheenMesh) reused on the hero jet:
      // a ShaderMaterial that writes gl_FragColor directly, so it BYPASSES the
      // renderer's ACES tone mapping that was neutralising the sheath's rim —
      // and ADDITIVE over the near-black stage, so its warm fresnel rim + the
      // two sliding strip-lights only ever brighten. A frozen frame now reads
      // lit glassy water: see-through tube, unmistakable warm edge, moving
      // sheen. Shares the jet geometry + drawRange (normals are rewritten each
      // frame in _updateStream); drawn on top of the sheath + core.
      var streamSheen = waterSheenMesh(stream.geometry);
      streamSheen.material.blending = THREE.AdditiveBlending;
      streamSheen.material.toneMapped = false;
      streamSheen.renderOrder = 9;
      scene.add(streamSheen);
      this._streamSheen = streamSheen;
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
      // ── CUT-SCENE LOCK input handlers, bound ONCE here, attached/detached by
      //    _engageLock/_releaseLock only for the lock's brief duration. Capture
      //    phase + passive:false so the preventDefault actually kills the scroll
      //    (a passive listener can't). While locked, every scroll gesture is
      //    swallowed — but we still READ its direction: a clear UPWARD push
      //    after the minimum hold is an escape request (a trapped-feeling reader
      //    is worse than a broken cut scene), tallied into _lockUpIntent and
      //    consumed in _tick.
      this._lockUpIntent = 0; this._lockTouchY = null;
      this._lockWheel = function (e) {
        if (e.cancelable) e.preventDefault();
        if (e.deltaY < 0) self._lockUpIntent += -e.deltaY;      // wheel up = escape intent
      };
      this._lockTouch = function (e) {
        if (e.cancelable) e.preventDefault();
        var t = e.touches && e.touches[0]; if (!t) return;
        if (self._lockTouchY != null) {
          var d = t.clientY - self._lockTouchY;                 // finger sliding DOWN = scroll-up intent
          if (d > 0) self._lockUpIntent += d;
        }
        self._lockTouchY = t.clientY;
      };
      this._lockKey = function (e) {
        // never hijack a key meant for a focused control (mirrors the conductor)
        var tgt = e.target;
        if (tgt && (/^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName) || tgt.isContentEditable)) return;
        var k = e.key;
        var up = (k === 'ArrowUp' || k === 'PageUp' || k === 'Home');
        var down = (k === 'ArrowDown' || k === 'PageDown' || k === 'End' || k === ' ' || k === 'Spacebar');
        if (up || down) { e.preventDefault(); if (up) self._lockUpIntent += 999; } // an up-key is an unambiguous escape
      };
      this._onScroll = function () {
        var y = window.scrollY;
        // CUT-SCENE LOCK, scroll-event side: a violent flick can outrun the
        // ticker (or land while the bottle is briefly offscreen), so pre-arm the
        // lock here too — same gate as _tick, idempotent (_engageLock no-ops if
        // already locked). Snapping onto wallY here catches the overshoot the
        // instant it arrives; the ticker then owns the hold.
        if (!self._lockActive && self._pin && !self._noWall && self._sawHero && self._level > 0.245 &&
            !anchorGlideActive() && !conductorLive() &&
            (!self._wallT || self._clock.elapsedTime - self._wallT < 8)) {
          var wy = (self._pinTop || 0) + 0.88 * Math.max(1, (self._pinH || 1) - window.innerHeight);
          if (y >= wy - 2) { self._engageLock(self._clock.elapsedTime); y = window.scrollY; }
        }
        // backstop clamp: while the lock holds, kill every leak (scrollbar drag,
        // iOS momentum) INSTANTLY onto the composition — a snap, never a glide,
        // so it never re-fires into a rubber-band loop.
        if (self._holdY != null && y > self._holdY && !anchorGlideActive()) {
          snapScroll(self._holdY);
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
      // re-measure the cached pin geometry when layout can shift without an
      // element resize: full load (fonts/late images) and documentElement
      // class flips (bottle3d-on changes the pin's svh height)
      window.addEventListener('load', function () { self._measurePin(); }, { once: true });
      this._classMO = new MutationObserver(function () { self._measurePin(); });
      this._classMO.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      // perf guards: don't render when the tab is hidden or the element is offscreen
      this._onVis = function () { self._hidden = document.hidden; };
      document.addEventListener('visibilitychange', this._onVis);
      this._io = new IntersectionObserver(function (entries) {
        if (entries[0]) self._offscreen = !entries[0].isIntersecting;
      });
      this._io.observe(this);
    }

    /* ---------- THE CUT-SCENE LOCK ---------- */
    // Owner's order: "its the cut scene — dont allow the user to scroll for a
    // second so they are forced to watch the animation." When a reader crosses
    // the pour line coming DOWN with the bottle still holding water, we don't
    // rubber-band their scroll position — we take their INPUT away outright for
    // a cinematic beat, so the tilt-and-pour plays out in front of them, then
    // hand scrolling straight back. _engageLock arms the capture-phase input
    // trap; _releaseLock tears it down and restores the page. _holdY stays
    // published throughout (script.js's freeze gate reads it: "never freeze
    // while the WALL holds") and html.cutscene is a styling/telemetry hook.
    _engageLock(t) {
      if (this._lockActive) return;
      this._lockActive = true;
      this._lockT0 = t || 0.001;                 // clock seconds — the minimum-hold anchor
      this._lockUpIntent = 0; this._lockTouchY = null;
      if (!this._wallT) this._wallT = t || 0.001; // reuse the failsafe timer (was 12s, now 8s)
      // publish the hold NOW (not next frame) so a scroll event landing before
      // the next _tick already has a clamp target
      this._holdY = (this._pinTop || 0) + 0.88 * Math.max(1, (this._pinH || 1) - window.innerHeight);
      snapScroll(this._holdY);                   // pull a fast flinger's overshoot back onto the composition
      window.addEventListener('wheel', this._lockWheel, { passive: false, capture: true });
      window.addEventListener('touchmove', this._lockTouch, { passive: false, capture: true });
      window.addEventListener('keydown', this._lockKey, true);
      document.documentElement.classList.add('cutscene');
    }
    _releaseLock() {
      if (!this._lockActive) return;
      this._lockActive = false;
      window.removeEventListener('wheel', this._lockWheel, true);
      window.removeEventListener('touchmove', this._lockTouch, true);
      window.removeEventListener('keydown', this._lockKey, true);
      document.documentElement.classList.remove('cutscene');
      this._holdY = null;                        // scroll feels normal again immediately
    }

    /* pin geometry cached: offsetTop/offsetHeight force layout, so they are
       re-read only on resize / load / documentElement class shifts (the
       bottle3d-on class changes the pin's svh height), never per frame or
       per scroll event. Scroll-driven math uses window.scrollY + these. */
    _measurePin() {
      if (!this._pin) return;
      this._pinTop = this._pin.offsetTop;
      this._pinH = this._pin.offsetHeight;
    }

    _resize() {
      var w = this.clientWidth || 1, h = this.clientHeight || 1;
      // fast DESKTOP now buys native crispness (up to 2.5) — the owner wants
      // max fidelity and the glare/ripple detail earns the pixels. LITE/narrow
      // stay pinned at 1.5 (byte-identical). setPixelRatio reallocates the
      // drawing buffer, so fire it ONLY when the ratio actually changes.
      var dpr = Math.min(this._fast ? 2.5 : 1.5, window.devicePixelRatio || 1);
      if (this._dpr !== dpr) { this._renderer.setPixelRatio(dpr); this._dpr = dpr; }
      this._renderer.setSize(w, h, false);
      this._measurePin(); // pin geometry is only re-read here + on load/class shifts, never per frame
      this._narrow = window.__forceMobile || window.innerWidth <= 760; // the dedicated mobile page pins this true at any width
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
        // progress through the pinned hero (≈3 screens of scroll) — cached
        // pin geometry; offsetTop/offsetHeight are never read per frame
        var span = Math.max(1, (this._pinH || 1) - window.innerHeight);
        p = Math.min(1, Math.max(0, (window.scrollY - (this._pinTop || 0)) / span));
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
      // THE CUT-SCENE LOCK, ticker side. Engagement is INDEPENDENT of
      // __conducted now (the old wall dropped the moment any reader touched the
      // wheel — they lost both the guide AND the hold and scrubbed straight
      // through). It stands under the same POSITIONAL truth as before — a reader
      // who came down through the hero (_sawHero) is at/over the pour line
      // (wallY) with the bottle still pouring (_level > 0.245) — but now it
      // seizes INPUT rather than clamping position. It stays out of the
      // conductor's way: while a conductor is LIVE it owns the pour hold itself,
      // so conductorLive() keeps us out for its whole run (anchorGlideActive()
      // is the extra belt for its tween + any nav glide). We keep only when the
      // conductor is retired or absent. Reduced-motion (_noWall) is exempt.
      // Mobile pages have no .heropin → _pin null → never runs.
      var wallY = (this._pinTop || 0) + 0.88 * Math.max(1, (this._pinH || 1) - window.innerHeight);
      if (!this._lockActive) {
        var canArm = this._sawHero && !this._noWall && this._pin && this._level > 0.245 &&
                     !anchorGlideActive() && !conductorLive() &&
                     (!this._wallT || t - this._wallT < 8);   // 8s failsafe: once it fires, no re-trap until refill re-zeroes _wallT
        if (canArm && window.scrollY >= wallY - 2) this._engageLock(t);
      } else {
        // HELD — release when the cut scene has done its job. BOTH a cinematic
        // minimum (~1.2s, the owner's "for a second") AND the pour has drained;
        // OR the hard 8s failsafe; OR, once the minimum has passed, the reader
        // pushes clearly UPWARD (escape hatch — never trap them). Also bail
        // instantly if reduced-motion flipped on mid-hold.
        var held = t - this._lockT0;
        var minGone = held >= 1.2;
        var drained = this._level <= 0.245;
        var escaped = minGone && this._lockUpIntent > 40;      // a deliberate up-push, tallied by the locked input handlers
        var failed = this._wallT && (t - this._wallT > 8);
        if (this._noWall || (minGone && drained) || escaped || failed) this._releaseLock();
      }
      // _holdY mirrors the lock every frame (also absorbs a resize that shifts
      // wallY) — script.js's freeze gate keeps reading it; the scroll handler's
      // backstop clamp keys off it.
      this._holdY = this._lockActive ? wallY : null;

      // RELOAD-ON-RE-ENTRY: after a pour cycle the failsafe timer (_wallT) is
      // spent, so the cut-scene lock won't re-arm. A reader who scrolls back UP
      // to the full bottle should get to watch the whole pour again — when they
      // genuinely return to the very top with the bottle refilled, re-zero
      // _wallT so the lock can catch the next descent. STATE ONLY — never a
      // scroll write. __conducted is cleared alongside so the conductor's guide
      // is available again too (the lock itself no longer reads it).
      if (p > 0.85) this._leftHero = true;                       // they went through the hero
      if (this._leftHero && p < 0.08 && this._level > 0.9 &&
          !anchorGlideActive() && !this._noWall) {               // back at the full-bottle top, invisibly
        this._leftHero = false;                                  // one re-arm per genuine round-trip
        window.__conducted = false;                              // guide available again
        this._wallT = 0;                                         // cut-scene lock re-armed for the next pour
      }

      // twist: scroll up → twist right, scroll down → twist left (reversed)
      // scroll-reactive twist. PHONES get ~1/6th the coupling: a touch flick
      // covers the short mobile pin in a couple of screens of fast scroll,
      // which whipped the bottle around (user: "it spins a lot — slow it
      // down by a lot"). Drag-to-spin and the home-return are untouched.
      // during a conductor auto-glide the machine-driven scroll pumps vel high;
      // use the gentle (phone) coupling then so the bottle doesn't whip around.
      this._rotY += -vel * ((this._narrow || anchorGlideActive()) ? 0.0003 : 0.0018) * dt * 60 * 0.016;
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
      // Hero resting fill: a full, sealed bottle should read filled up into
      // the neck (a little headspace under the cap), not stopped at the
      // shoulder — that shoulder gap made the hero bottle look half-empty.
      // The lift only applies while nearly full (lvl≈1, the capped hero); the
      // moment the pour begins draining (lvl<0.9) it decays back to the
      // original 0.712 mapping, so the tuned pour/drain choreography is untouched.
      var surfFrac = 0.712 * lvl + 0.141 * smoothstep(0.90, 1.0, lvl);
      var h = lerp(minY, maxY, surfFrac) + (this._surfBob || 0); // pooled water height, heaving with the glug
      this._waterPlane.constant = h;
      // surface disc rides the waterline along the bottle axis, always world-level
      if (dyPer > 0.25) { // upright-ish ONLY: inverted, the disc escaped the silhouette as a floating bar
        var yLoc = Math.min(2.80, Math.max(0.12, (h - _v2.y) / dyPer)); // 2.80: let the disc follow the raised full-fill up into the neck
        this._waterLocalY = yLoc;
        this._waterTop.visible = true;
        this._waterTop.position.y = yLoc;
        var rs = radiusAtFast(yLoc) / radiusAtFast(2.32);
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
      if (this._waterTopUniforms) {
        this._waterTopUniforms.uTime.value = t;
        // the surface speaks: glug heaves, the fizz burst and any tilt send
        // ripple rings across it; phase advances faster the harder it's hit
        var ripH = this._waterTopUniforms.uRipAmp;
        var ripT = Math.min(1, (this._glugKick || 0) * 0.9 + this._fizzBurst * 0.6 +
                               Math.abs(this._surfBob || 0) * 6.0 + tiltT * 0.15);
        ripH.value += (ripT - ripH.value) * (1 - Math.pow(0.12, dt));
        this._waterTopUniforms.uRipPh.value =
          (this._waterTopUniforms.uRipPh.value + dt * (3 + 5 * ripH.value)) % 100;
      }

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
      // only the LIVE instances are stepped + uploaded — the pool is 180 deep
      // but the visible count usually hovers near 90 (0 while pouring)
      var liveN = this._bubbles.count;
      for (var i = 0; i < liveN; i++) {
        var b = bd[i];
        b.y += (b.v * (1 + surge)) * dt;
        b.w += dt * 2;
        if (b.y > wrapY) { b.y = 0.1; b.a = Math.random() * Math.PI * 2; b.rf = Math.pow(Math.random(), 0.5) * 0.8; }
        var r = radiusAtFast(b.y) * 0.85 * b.rf;
        dummy.position.set(Math.cos(b.a + Math.sin(b.w) * 0.15) * r, b.y, Math.sin(b.a) * r);
        var s = b.s * (0.7 + 0.3 * Math.sin(b.w));
        dummy.scale.set(s, s, s);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        this._bubbles.setMatrixAt(i, dummy.matrix);
      }
      if (liveN) this._bubbles.instanceMatrix.needsUpdate = true;

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
          var rr = Math.max(0.15, radiusAtFast(d.y) + 0.006);
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
        this._level = Math.max(0.20, this._level - dt * (0.055 + 0.176 * ps * flow)); // tempo +10% (was 0.05/0.16): a small drain bump on top of the shorter pin so the pour reads "a little faster", not rushed
      } else {
        this._glugAmp = 0;
        this._surfBob = (this._surfBob || 0) * Math.pow(0.02, dt); // settle when not pouring
      }

      var bk = this._updateStream(pouring, ps, flow, time);
      // the reused edge pass shares the jet's geometry + drawRange; only its
      // visibility + strength track here (one chokepoint covers every
      // _updateStream return path). uK is normalised by the sheath's opacity
      // ceiling (0.46) so the warm rim reaches full strength at the song's peak
      // pour, then ebbs WITH the jet as the sheath fades.
      if (this._streamSheen) {
        this._streamSheen.visible = this._stream.visible;
        this._streamSheen.material.uniforms.uK.value = this._stream.material.opacity / 0.46;
      }

      // past the breakup point the jet pinches into main drops + satellites
      if (pouring && bk) {
        this._pourClock += dt * (24 + 190 * ps);
        var n = Math.floor(this._pourClock);
        this._pourClock -= n;
        for (var k = 0; k < n && data.length < mesh.instanceMatrix.count - 60; k++) {
          var sat = Math.random() < 0.35;
          var jr = bk.r * 1.4;
          var nd = poolTake(this._pourPool, data);
          if (!nd) break;
          nd.x = bk.x + (Math.random() - 0.5) * jr; nd.y = bk.y + (Math.random() - 0.5) * jr; nd.z = bk.z + (Math.random() - 0.5) * jr;
          nd.vx = bk.vx + (Math.random() - 0.5) * 0.22;
          nd.vy = bk.vy + (Math.random() - 0.5) * 0.22;
          nd.vz = bk.vz + (Math.random() - 0.5) * 0.22;
          nd.life = 1.6; nd.l0 = 1.6;
          nd.s = Math.min(3.8, (sat ? 0.42 : 0.95) * bk.r * 94 * (0.8 + Math.random() * 0.4));
          nd.g = 16; nd.drag = 0.9; nd.mist = false;
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
        // swap-pop back into the pool — no splice realloc mid-loop
        if (pt.life <= 0 || pt.y < -8.5) { data[i] = data[data.length - 1]; data.pop(); }
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
        var mp = poolTake(this._pourPool, data);
        if (!mp) break;
        mp.x = _v1.x + (Math.random() - 0.5) * 0.05;
        mp.y = _v1.y + (Math.random() - 0.5) * 0.02;
        mp.z = _v1.z + (Math.random() - 0.5) * 0.05;
        mp.vx = _v3.x * sp; mp.vy = _v3.y * sp; mp.vz = _v3.z * sp;
        mp.life = life; mp.l0 = life;
        mp.s = spit ? 0.5 + Math.random() * 0.4 : 0.13 + Math.random() * 0.2;
        mp.g = spit ? 7.5 : 0.8; mp.drag = spit ? 0.55 : 0.008; mp.mist = !spit;
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
        var sl = poolTake(this._fizzPool, fd);
        if (sl) {
          sl.x = Math.cos(a0) * r0; sl.y = 2.98 + Math.random() * 0.12; sl.z = Math.sin(a0) * r0;
          sl.dx = _v1.x; sl.dy = _v1.y; sl.dz = _v1.z;
          sl.v = 1.7 + Math.random() * 0.6; sl.s = 9.5 + Math.random() * 3.5;
          sl.life = 1.7; sl.w = Math.random() * Math.PI * 2; sl.pop = false;
        }
      }
      // the train: bubbles shed off the slug as it tears up the neck
      var n = 3 + Math.floor(Math.random() * 4);
      for (var i = 0; i < n && fd.length < cap; i++) {
        var ang = Math.random() * Math.PI * 2, rr = Math.random() * 0.075;
        var tb = poolTake(this._fizzPool, fd);
        if (!tb) break;
        tb.x = Math.cos(ang) * rr; tb.y = 2.55 + Math.random() * 0.45; tb.z = Math.sin(ang) * rr;
        tb.dx = _v1.x; tb.dy = _v1.y; tb.dz = _v1.z;
        tb.v = 1.0 + Math.random() * 0.9; tb.s = 2.0 + Math.random() * 2.2;
        tb.life = 1.4; tb.w = Math.random() * Math.PI * 2; tb.pop = false;
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
        var ab = poolTake(this._fizzPool, fd);
        if (!ab) break;
        ab.x = sx * off - sz * jit; ab.y = 2.86 + Math.random() * 0.24; ab.z = sz * off + sx * jit;
        ab.dx = _v1.x; ab.dy = _v1.y; ab.dz = _v1.z;
        ab.v = 1.2 + Math.random() * 0.5; ab.s = 1.3 + Math.random() * 1.1;
        ab.life = 1.3; ab.w = Math.random() * Math.PI * 2; ab.pop = false;
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
          var rr = radiusAtFast(y) * (wall ? 0.80 + Math.random() * 0.08 : Math.random() * 0.5);
          var nb = poolTake(this._fizzPool, fd);
          if (!nb) break;
          nb.x = Math.cos(ang) * rr; nb.y = y; nb.z = Math.sin(ang) * rr;
          nb.dx = 0; nb.dy = 1; nb.dz = 0;
          nb.v = 0.5 + Math.random() * 0.8; nb.s = 1.0 + Math.random() * 1.6;
          nb.life = 6; nb.w = Math.random() * Math.PI * 2; nb.pop = true;
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
        var rMax = radiusAtFast(Math.min(Math.max(b.y, 0), H)) * 0.84;
        var rr = Math.sqrt(b.x * b.x + b.z * b.z);
        if (rr > rMax && rr > 0) { b.x *= rMax / rr; b.z *= rMax / rr; }
        // once the bottle tilts to pour, any lingering cap-off bubbles are
        // culled fast so the pour is clean water (no fizz in the bottle)
        b.life -= dt * (1 + 60 * smoothstep(0.34, 0.60, this._tiltT || 0));
        if (b.life <= 0 || (b.pop && b.y >= wrap)) { fd[i] = fd[fd.length - 1]; fd.pop(); continue; }
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
        this._tubeWarm = false; this._lastBk = null; // the next pour's first frame always re-solves
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
      // THE LIP, solved like the decanter's: the water must WELL OUT of the
      // rolled-lip bead, not hang a thread inboard of the glass. RIMR is the
      // lip torus's centreline radius (TorusGeometry(0.176,…) at y=3.14); the
      // head is born just off the mouth centre toward the LOW edge and the
      // throat flare below fattens the first rings out to LIPWRAP so they
      // overlap the bead — zero daylight at the exit, at onset, song, and ebb.
      var RIMR = 0.176, LIPWRAP = RIMR * 0.82;
      var ex = _v1.x + _v3.x * 0.05, ey = _v1.y + _v3.y * 0.05, ez = _v1.z + _v3.z * 0.05;
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

      // the tube re-solves at HALF rate: the pour evolves slowly enough that
      // a 30Hz ribbon reads identical to 60Hz, and this skips the ring solve
      // + three buffer uploads every other frame. Opacity/visibility still
      // ramp every frame and droplet integration is untouched — the breakup
      // hand-off just reuses the last solved point for one frame.
      this._tubeFlip = !this._tubeFlip;
      if (this._tubeFlip && this._tubeWarm) {
        stream.visible = true; core.visible = true;
        var kf = Math.min(1, 0.3 + ps * 4);
        stream.material.opacity = Math.min(0.46 * kf, stream.material.opacity + 0.14); // ceiling 0.55->0.46 (0.40 vanished on capture): the thinned sheath now reads as a see-through glass tube, not poured pewter; +0.14 onset RATE unchanged (a slow fade left the lip ghosted, reading as a gap)
        core.material.opacity = Math.min(0.34 * kf, core.material.opacity + 0.18);      // core ceiling 0.5->0.34 (0.30 vanished on capture): a darker see-through interior — the edges carry the light, the core no longer reads as a separate flat band
        return this._lastBk;
      }

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
        // THE LIP WRAP (meniscus): over the first ~0.12 of arclength the
        // column flares out to the wetted-mouth radius, so the head WELLS over
        // the rolled-lip bead — water clinging to the glass as it leaves, never
        // a thread floating inboard of the mouth (the "big wide gap"). Eases to
        // 0 by the throat's end; the mass-conservation taper downstream is
        // untouched, and it sits BEFORE the pinch-off neck (frac>0.78, far below).
        var thr = 1 - s / 0.12; if (thr < 0) thr = 0;
        if (thr > 0) { var wf = thr * thr; r = r * (1 - wf) + Math.max(r, LIPWRAP) * wf; }
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
      if (nr < 2) { stream.visible = false; core.visible = false; this._tubeWarm = false; this._lastBk = bk; return bk; }
      stream.geometry.setDrawRange(0, (nr - 1) * SEG * 6);
      core.geometry.setDrawRange(0, (nr - 1) * SEG * 6);
      stream.geometry.attributes.position.needsUpdate = true;
      stream.geometry.attributes.normal.needsUpdate = true;
      core.geometry.attributes.position.needsUpdate = true;
      stream.visible = true; core.visible = true;
      // faint for a dribble, solid for a committed pour — but always
      // translucent enough to read as water, not paint
      var k = Math.min(1, 0.3 + ps * 4);
      stream.material.opacity = Math.min(0.46 * k, stream.material.opacity + 0.14); // ceiling 0.55->0.46 (0.40 vanished on capture): thinned sheath reads see-through, not poured pewter; +0.14 onset RATE unchanged
      core.material.opacity = Math.min(0.34 * k, core.material.opacity + 0.18);      // core ceiling 0.5->0.34 (0.30 vanished on capture): darker see-through interior, light carried by the edges
      this._tubeWarm = true;   // half-rate rebuilds may now reuse this tube
      this._lastBk = bk;
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

  /* shared soft studio light-box → PMREM env for glass/metal/water. Warmed
     toward candlelight for the espresso stage: the soft fill panels take an
     amber cast (so glass/water reflect a warm room), while the tall highlight
     STREAKS stay near-neutral and hot — those are the crisp glints that carve
     the glass edges, and a coloured glint reads as dirt, not sparkle. Box
     darkened slightly so the glass has a dim surround to stand its edges against. */
  function makeStudioEnv(renderer) {
    var env = new THREE.Scene();
    env.add(new THREE.Mesh(new THREE.BoxGeometry(20, 20, 20),
      new THREE.MeshBasicMaterial({ color: 0x817a70, side: THREE.BackSide })));   // warmer + a touch darker than 0x9a9a94
    function panel(x, y, z, w, h, c) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0], c[1], c[2]), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); return m;
    }
    panel(0, 9, 0, 8, 8, [7, 6.3, 5.0]);         // warm candle key panel (was neutral [7,7,6.6])
    panel(-8, 2, 3, 3, 9, [3.4, 3.0, 2.4]);      // warm side fill
    panel(8, 1, -2, 3, 9, [2.2, 2.0, 1.7]);      // warm side fill
    panel(0, 1, 9, 5, 2.4, [1.6, 1.45, 1.2]);    // warm front fill
    panel(-3, 2, 7, 0.7, 11, [10, 9.8, 9.3]);    // tall vertical highlight streak — kept near-neutral + hot (glass-edge glint)
    panel(4.5, 2, 6, 0.5, 11, [5.5, 5.4, 5.1]);  // secondary streak, near-neutral
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
      // re-measure the cached layout rects when the document can shift without
      // an element resize: full load, late-loading images (capture-phase load
      // sees every <img>), webfonts, and documentElement class flips
      // (bottle3d-on changes the pin/highball svh heights)
      window.addEventListener('load', function () { self._measureRects(); }, { once: true });
      this._onDocLoad = function () { self._measureRects(); };
      document.addEventListener('load', this._onDocLoad, true);
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { if (self._started) self._measureRects(); });
      }
      this._classMO = new MutationObserver(function () { self._measureRects(); });
      this._classMO.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
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
      // MAX-LOD gate (mirrors the bottle's): only the fast DESKTOP path spends
      // the freed budget. __mastryLite and any narrow / forced-mobile viewport
      // stay byte-identical to today. This class has no _isLite(); __mastryLite
      // is authoritative here, exactly as the whisky-load path already treats it.
      // Same zero-width guard as the bottle's gate: 0 = not laid out, not phone.
      var vw = window.innerWidth || (window.screen && window.screen.width) || 1280;
      this._fast = !window.__mastryLite && !(window.__forceMobile || vw <= 760);
      // at DPR>=2 pixel density already smooths edges — dropping MSAA halves fill cost
      var renderer = new THREE.WebGLRenderer({ canvas: this._canvas, alpha: true, antialias: (window.devicePixelRatio || 1) < 2 });
      renderer.setClearColor(0x000000, 0);
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;   // matched to the hero: the tumbler glass + water must read on the near-black stage
      renderer.localClippingEnabled = true;
      this._renderer = renderer;
      var scene = new THREE.Scene();
      this._scene = scene;
      var camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
      camera.position.set(0, 0, 8);
      camera.lookAt(0, 0, 0);
      this._camera = camera;
      scene.environment = makeStudioEnv(renderer);
      // CANDLELIT RIG — identical recipe to the hero act (warm key, lifted cool
      // rim to carve the crystal, warm glint, faint amber bounce from below)
      scene.add(new THREE.AmbientLight(0xffdca8, 0.30));
      var key = new THREE.DirectionalLight(0xffce96, 1.28);
      key.position.set(3, 5, 4); scene.add(key);
      var rim = new THREE.DirectionalLight(0xdfe9ff, 0.72);
      rim.position.set(-4, 2, -3); scene.add(rim);
      var glint = new THREE.PointLight(0xffdca4, 1.0, 30);
      glint.position.set(2.4, 3.4, 3.2); scene.add(glint);
      var bounce = new THREE.DirectionalLight(0xE0A458, 0.18);
      bounce.position.set(0, -3, 3); scene.add(bounce);

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
      var RINGS = this._strRings = this._fast ? 176 : 64, SEG = this._strSeg = this._fast ? 16 : 8; // pour LOD: fast desktop gets finer rings (same reach — dtt spreads across the fall) + a rounder tube; LITE/narrow keep 64/8
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
        new THREE.MeshBasicMaterial({ color: WATER_DROP_TINT, transparent: true, opacity: 0.92, depthWrite: false, toneMapped: false }), this._fast ? 300 : 150); // impact crown; opacity 0.8->0.92 so the splash glints sparkle on dark. fast desktop: fuller crown; LITE/narrow keep 150 (count untouched)
      splash.count = 0; splash.renderOrder = 3.7; splash.frustumCulled = false;
      scene.add(splash);
      this._splash = splash; this._splashData = []; this._splashClock = 0;

      // bubbles churned under the impact, rising through the water
      var bub = new THREE.InstancedMesh(new THREE.SphereGeometry(0.013, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xe6f2ec, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false, clippingPlanes: [this._waterPlane] }), this._fast ? 240 : 120); // cool pale churn, off pure-white so it won't fluoresce on dark (was 0xf2fbf5); fast desktop: more churn; LITE/narrow keep 120
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
      // Lazy-load the USER'S decanter GLB: never at first paint (it must not
      // compete with the hero bottle). Fetch on the first scroll — plenty of
      // lead time before the pour stage two sections down — with a timer
      // backstop so it always arrives. ?nowhisky disables the whole act.
      if (!/[?&]nowhisky/.test(location.search)) (function (self) {
        var fired = false, go = function () { if (fired) return; fired = true; self._loadWhisky(); };
        if (window.__mastryLite) {
          // LITE: never during the hero. Wait for the first real scroll, THEN
          // watch the actual pour stage (.highball) approach; a 12s backstop
          // guarantees the whisky act still plays if the reader never scrolls.
          window.addEventListener('scroll', function () {
            var stage = document.querySelector('.highball') || self;
            try {
              var io = new IntersectionObserver(function (en) { if (en[0].isIntersecting) { io.disconnect(); go(); } }, { rootMargin: '0px 0px 100% 0px' });
              io.observe(stage);
            } catch (e) { go(); }
          }, { once: true, passive: true });
          setTimeout(go, 12000);
        } else {
          window.addEventListener('scroll', go, { once: true, passive: true });
          // STAGE 2: the old flat 3.5s backstop fired while the hero GLB was
          // still downloading and the 2.9MB decanter STOLE ITS BANDWIDTH on
          // slow links (part of "sometimes the bottle doesn't load"). The
          // backstop now waits for the hero to be READY first, +2.5s of calm;
          // a 15s absolute ceiling still guarantees the whisky act arrives.
          var back = function () { setTimeout(go, 2500); };
          if (window.__heroReady) back();
          else document.addEventListener('mastry:heroready', back, { once: true });
          setTimeout(go, 15000);
        }
      })(this);
      this._resize();
    }

    /* the shared jet tube becomes the spirit: amber stream, warm splash.
       REVERSIBLE — _stream/_core are the hero water pour's own tube, so the
       clear colours are cached and restored when the act sleeps, or free
       upward scroll would replay an amber water pour. */
    _whiskyArm() {
      if (this._whiskyOn) return;
      this._whiskyOn = true;
      if (!this._jetC0) this._jetC0 = {
        s: this._stream.material.color.getHex(),
        c: this._core.material.color.getHex(),
        p: this._splash.material.color.getHex()
      };
      this._stream.material.color.setHex(0xe4b962);   // lighter honey-gold — was 0xd9a441 (user: the pour read too brown)
      this._core.material.color.setHex(0xf2e6bd);
      this._splash.material.color.setHex(0xe7c074);
    }
    _whiskyDisarm() {
      if (!this._whiskyOn || !this._jetC0) return;
      this._whiskyOn = false;
      this._stream.material.color.setHex(this._jetC0.s);
      this._core.material.color.setHex(this._jetC0.c);
      this._splash.material.color.setHex(this._jetC0.p);
    }

    /* ── the whisky vessel: the USER'S decanter GLB, dropped into _wb so the
       sleeping whisky act (drop-in → lid off → tip → amber pour → gold mix)
       wakes. Normalised so the body's mouth sits at local y=0.75 — the exact
       height the act pours from. The GLB's transmission materials would render
       BLACK on this alpha canvas, so only the geometry is kept: the body gets
       the crystal shell treatment, the liquid becomes a clip-plane-levelled
       amber column, and the stopper is seated in world space to pop off. */
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
            // realistic CONTAINED liquid: a lathe that follows the vessel's own
            // INSCRIBED interior profile (the decanter is faceted + necks in, so
            // we bin the body verts by height and take the MIN radius per band,
            // inset ~10%). The column lives inside the interior volume and turns
            // rigidly with the holder, so it can never poke through the walls at
            // any tilt; a WORLD-horizontal clip plane keeps the surface level
            // (and drains it on the pour). Sampled from the BODY geo, normalized
            // into this same space. Replaces the old straight cylinder, which
            // ignored the shoulder taper and jutted through the neck when tipped.
            var bodyPrim = null;
            prims.forEach(function (p) {
              var pn = ((p.name || '') + ' ' + ((p.material && p.material.name) || '')).toLowerCase();
              if (pn.indexOf('body') !== -1) bodyPrim = p;
            });
            var prof = [];   // Vector2(radius, y), base -> up
            if (bodyPrim) {
              var bgeo = bodyPrim.geometry.clone();
              bgeo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(norm, bodyPrim.matrixWorld));
              bgeo.computeBoundingBox();
              var by0 = bgeo.boundingBox.min.y, by1 = bgeo.boundingBox.max.y, BN = 26;
              var bp = bgeo.attributes.position, bnr = bgeo.attributes.normal, mn = [];
              for (var bi = 0; bi < BN; bi++) mn[bi] = 1e9;
              for (var vi = 0; vi < bp.count; vi++) {
                // WALLS ONLY: the mouth is modelled with a flat closed centre
                // face (and the collar has flat top rings) whose vertices span
                // r 0..rim and used to poison the min-radius of the top bands.
                // Flat faces point along the axis (|ny|≈1); walls point out.
                if (bnr && Math.abs(bnr.getY(vi)) > 0.88) continue;
                var vx = bp.getX(vi), vy = bp.getY(vi), vz = bp.getZ(vi);
                var rr = Math.sqrt(vx * vx + vz * vz), yi = Math.floor((vy - by0) / (by1 - by0) * BN);
                if (yi < 0) yi = 0; if (yi >= BN) yi = BN - 1;
                if (rr < mn[yi]) mn[yi] = rr;
              }
              // the column runs base → MOUTH (the hero bottle's "ONE liquid"
              // lesson — a lathe stopping short showed an EMPTY neck under a
              // full stream), and it follows the REAL inscribed bore the whole
              // way: a constant-radius neck extension poked through the wall
              // where the neck tightens (user: "whiskey popping out of the
              // neck"). Fill lines stay keyed to the 90% mark as before.
              var lastR = 0;
              for (var pi = 0; pi < BN; pi++) {
                var yy = by0 + (pi + 0.5) / BN * (by1 - by0);
                var rIns = (mn[pi] < 1e8 ? mn[pi] : lastR / 0.90) * 0.90;
                if (pi > BN * 0.6 && lastR > 0 && rIns > lastR) rIns = lastR; // neck only narrows, never balloons back out
                lastR = rIns;
                prof.push(new THREE.Vector2(Math.max(0.003, rIns), yy));
              }
              self._wbBase = by0;
              self._wbTopY = by0 + 0.90 * (by1 - by0);
            }
            if (!prof.length) {   // fallback: straight cylinder from the liquid bbox
              geo.computeBoundingBox(); var gb = geo.boundingBox;
              var r0 = Math.max(Math.abs(gb.max.x), Math.abs(gb.min.x), Math.abs(gb.max.z), Math.abs(gb.min.z)) * 0.8;
              self._wbBase = gb.min.y - 0.04; self._wbTopY = 0.66;
              prof = [new THREE.Vector2(r0, self._wbBase), new THREE.Vector2(r0, 0.66)];
            }
            prof.unshift(new THREE.Vector2(0.002, self._wbBase));   // closed bottom
            // resting/empty fill lines (offsets from the vessel origin; fed to
            // the level plane per frame, and drained during the pour)
            self._wbFillRest = self._wbBase + 0.62 * (self._wbTopY - self._wbBase);
            self._wbFillLow  = self._wbBase + 0.56 * (self._wbTopY - self._wbBase);   // pours only a LITTLE (62% -> 56%) — decanter stays mostly full
            self._wbFill = self._wbFillRest;
            self._wbLiquidPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), self._wbFillRest);
            var lgeo = new THREE.LatheGeometry(prof, 48);
            var lm = new THREE.MeshPhysicalMaterial({
              // whisky amber rendered FAITHFULLY like the unlit pour stream
              // (toneMapped:false). The lit path + ACES tone mapping was
              // desaturating the warm amber toward white through the frosted
              // crystal shells, so it read pale/thin (user: "the liquid in the
              // decanter is too thin"). The colour is carried by the emissive so
              // it stays a rich gold regardless of the studio lighting/frost.
              // Emissive lifted 1.15->1.35 for the dark stage: candlelight
              // suits amber, so let the decanter glow read as its own light source.
              color: 0x1c0e02, roughness: 0.35, metalness: 0,
              emissive: 0xc8842c, emissiveIntensity: 1.35, toneMapped: false,
              transparent: true, opacity: 0.9, envMapIntensity: 0.35, depthWrite: false,
              side: THREE.DoubleSide, clippingPlanes: [self._wbLiquidPlane]
            });
            installWhiskyLiquidShader(lm, self);
            var lmesh = new THREE.Mesh(lgeo, lm);
            lmesh.renderOrder = 3;
            holder.add(lmesh);
            mats.push(lm);
          } else if (nm.indexOf('stopper') !== -1 || nm.indexOf('cap') !== -1 || nm.indexOf('lid') !== -1) {
            stopperGeos.push(geo);          // seated separately so it can pop off
          } else {
            if (nm.indexOf('body') !== -1) self._captureLip(geo, holder); // remember the real pouring lip
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
          var corkMat0 = mats.length; // the cork's own mats — it fades on its own schedule (never re-seats)
          stopperGeos.forEach(function (gg) {
            gg.translate(-cc.x, -cc.y, -cc.z);
            mats = mats.concat(self._whiskyShellify(cork, gg));
          });
          self._wbCorkMats = mats.slice(corkMat0);
          // cork lives in WORLD space (not under the tilting vessel) so it can
          // pop off, wait at the side while the decanter tips and pours, then
          // seat back on when the decanter returns upright.
          cork.visible = false;
          self._scene.add(cork);
          self._wbCork = cork;
          self._wbHolder = holder;   // to compute where the cork WOULD sit seated
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
       BackSide tint + FrontSide clearcoat + a BRIGHT-edge fresnel so the wall
       carves out of the espresso stage (the old dark edge was solved for light
       paper; on near-black a dark edge is invisible, so it's lifted to a cool
       candle-pale rim — a bright edge is how the eye reads glass against dark).
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
        // world-space strip lights: the decanter tips under them mid-act, so
        // the glare rakes across the cut crystal exactly as the pour happens
        vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vWN; varying vec3 vWW; void main(){ vN = normalize(normalMatrix * normal); vWN = mat3(modelMatrix) * normal; vec4 wp = modelMatrix * vec4(position, 1.0); vWW = wp.xyz; vec4 mv = viewMatrix * wp; vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: [
          'uniform float uOp; varying vec3 vN; varying vec3 vV; varying vec3 vWN; varying vec3 vWW;',
          'void main(){',
          '  float d = 1.0 - abs(dot(normalize(vN), normalize(vV)));',
          '  float f = pow(d, 2.0); float hot = pow(d, 9.0);',   // widened rim (2.2->2.0) for the dark stage
          '  vec3 edge = vec3(0.56, 0.66, 0.61);',   // BRIGHT cool-pale crystal edge (was dark 0.33,0.42,0.37 for light paper)
          '  vec3 V = normalize(cameraPosition - vWW);',
          '  vec3 R = reflect(-V, normalize(vWN));',
          '  float s1 = pow(max(dot(R, normalize(vec3(-0.45, 0.80, 0.42))), 0.0), 55.0);',
          '  float s2 = pow(max(dot(R, normalize(vec3(0.62, 0.30, 0.72))), 0.0), 150.0);',
          '  vec3 col = mix(edge, vec3(1.0), hot) + vec3(1.0, 0.92, 0.78) * (s1 * 0.95 + s2 * 0.55);',   // candle-tinted glints
          '  gl_FragColor = vec4(col, (f * 0.78 + hot * 0.4 + (s1 + s2) * 0.44) * uOp);',   // fatter edge alpha so the crystal wall reads on dark
          '}'
        ].join('\n')
      }));
      fres.renderOrder = 6; parent.add(fres);
      Object.defineProperty(fres.material, 'opacity', {
        configurable: true,
        get: function () { return this.uniforms.uOp.value; },
        set: function (v) { this.uniforms.uOp.value = v; }
      });
      return [back.material, front.material, fres.material];
    }

    /* remember the decanter's pouring LIP so the whisky leaves the real spout,
       not the mouth's axis centre. The mouth is a near-circle; we fit it once
       (centre C at the top edge + outer radius R) and solve the lowest rim
       point analytically per frame during the pour — smooth, no facet jitter. */
    _captureLip(geo, holder) {
      var pos = geo.attributes.position; if (!pos) return;
      geo.computeBoundingBox();
      var topY = geo.boundingBox.max.y, minY = geo.boundingBox.min.y;
      var band = Math.max(0.02, (topY - minY) * 0.04); // a thin ring at the mouth
      var sx = 0, sz = 0, n = 0, rMax = 0;
      for (var i = 0; i < pos.count; i++) {
        var y = pos.getY(i); if (y < topY - band) continue;
        var x = pos.getX(i), z = pos.getZ(i);
        sx += x; sz += z; n++;
        var r = Math.sqrt(x * x + z * z); if (r > rMax) rMax = r;
      }
      if (!n) return;
      this._wbLipC = new THREE.Vector3(sx / n, topY, sz / n); // rim centre, at the top edge
      this._wbLipR = rMax;                                    // outer lip radius (where it spills)
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
      // clear glass over the espresso stage = almost invisible body, BRIGHT
      // candle-pale edge bands where the wall goes edge-on, hot speculars from
      // the env streaks (the edge was dark for light paper — see the fresnel below)
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
        // normal blending with a BRIGHT cool-pale edge colour: reads as the
        // thick wall of real glass carved out of the near-black stage (a dark
        // edge, the old light-paper solve, would vanish on dark); the hot term
        // sparkles candle-white. World-space strip lights add moving glare on top.
        vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vWN; varying vec3 vWW; void main(){ vN = normalize(normalMatrix * normal); vWN = mat3(modelMatrix) * normal; vec4 wp = modelMatrix * vec4(position, 1.0); vWW = wp.xyz; vec4 mv = viewMatrix * wp; vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
        fragmentShader: [
          'varying vec3 vN; varying vec3 vV; varying vec3 vWN; varying vec3 vWW;',
          'void main(){',
          '  float d = 1.0 - abs(dot(normalize(vN), normalize(vV)));',
          '  float f = pow(d, 2.0); float hot = pow(d, 9.0);',   // widened rim (2.2->2.0) for the dark stage
          '  vec3 edge = vec3(0.56, 0.66, 0.61);',   // BRIGHT cool-pale glass edge (was dark 0.33,0.42,0.37 for light paper)
          '  vec3 V = normalize(cameraPosition - vWW);',
          '  vec3 R = reflect(-V, normalize(vWN));',
          '  float s1 = pow(max(dot(R, normalize(vec3(-0.45, 0.80, 0.42))), 0.0), 60.0);',
          '  float s2 = pow(max(dot(R, normalize(vec3(0.62, 0.30, 0.72))), 0.0), 160.0);',
          '  vec3 col = mix(edge, vec3(1.0), hot) + vec3(1.0, 0.92, 0.78) * (s1 * 0.9 + s2 * 0.5);',   // candle-tinted glints
          '  gl_FragColor = vec4(col, f * 0.78 + hot * 0.4 + (s1 + s2) * 0.42);',   // fatter edge alpha so the wall reads on dark
          '}'
        ].join('\n')
      }));
      fresnel.renderOrder = 6; parent.add(fresnel);
      return [back, front, fresnel];
    }

    /* swap the procedural tumbler for the user's rendered glass when given */
    _loadGlassSrc(g) {
      var src = this.getAttribute('glass-src') || this.getAttribute('glasssrc');
      if (!src || !THREE.GLTFLoader || window.__mastryLite) return; // LITE keeps the procedural tumbler (saves 1.5MB); the pour target survives
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

    /* layout rects CACHED in document space: getBoundingClientRect forces
       layout, and _tick used to call it up to 4x/frame. Everything the scene
       needs is a pure function of window.scrollY plus these offsets — they
       are re-measured on resize, full load, late image/font loads, and
       documentElement class flips (bottle3d-on changes section svh heights),
       never per frame. _syncRects derives this frame's viewport rects from
       scrollY + the cache. */
    _measureRects() {
      var sy = window.scrollY;
      var r = this.getBoundingClientRect();
      /* phones pin this canvas to the VIEWPORT (position:fixed — the <=760px
         rule in style.css/mobile.css): its screen top never moves with
         scroll, so the document-space replay (top = docTop - scrollY) would
         drag the cup and decanter off-screen until the next incidental
         re-measure — the "cup disappears / teleports" glitch. Remember the
         mode and keep the viewport-space top for the fixed case. */
      this._grFixed = window.getComputedStyle(this).position === 'fixed';
      this._grTopV = r.top;
      this._grTopDoc = r.top + sy; this._grLeftDoc = r.left;
      this._grW = r.width; this._grH = r.height;
      if (this.parentElement) {
        var pr = this.parentElement.getBoundingClientRect();
        this._parTopDoc = pr.top + sy; this._parH = pr.height;
      }
      if (this._hb) {
        var hr = this._hb.getBoundingClientRect();
        this._hbTopDoc = hr.top + sy; this._hbH = hr.height;
      }
      var box = this._heroBox || (this._heroBox = document.querySelector('.herowords .hero__copy'));
      if (box) {
        // the copy rides a data-speed parallax (script.js choreograph):
        // transform = (base + h/2 - (sy + vh/2)) * sp, so its measured top is
        //   top = (base - sy) * (1 + sp) + (h/2 - vh/2) * sp
        // invert to the UNTRANSFORMED document top and replay it per frame.
        // reduced-motion gets no transform; phones get the attribute stripped.
        var sp = this._reduce ? 0 : (parseFloat(box.dataset.speed) || 0);
        var br = box.getBoundingClientRect();
        this._boxSp = sp;
        this._boxH = br.height;
        this._boxTopDoc = (br.top - (br.height / 2 - window.innerHeight / 2) * sp) / (1 + sp) + sy;
        this._boxLeft = br.left; this._boxW = br.width; // the parallax is translateY-only — x is scroll- and transform-independent
      }
    }

    /* this frame's viewport-space rects from scrollY + the cached document
       offsets — same numbers getBoundingClientRect would have returned */
    _syncRects(sy) {
      if (this._grTopDoc === undefined) this._measureRects();
      var vh2 = window.innerHeight;
      var g = this._grA || (this._grA = { top: 0, left: 0, width: 1, height: 1, bottom: 0 });
      g.top = this._grFixed ? this._grTopV : this._grTopDoc - sy; g.left = this._grLeftDoc;
      g.width = this._grW; g.height = this._grH; g.bottom = g.top + g.height;
      var pr = this._parR || (this._parR = { top: 0, height: 1, bottom: 0 });
      pr.top = (this._parTopDoc || 0) - sy; pr.height = this._parH || 1; pr.bottom = pr.top + pr.height;
      var hb = this._hbR || (this._hbR = { top: 0, height: 1, bottom: 0 });
      hb.top = (this._hbTopDoc || 0) - sy; hb.height = this._hbH || 1; hb.bottom = hb.top + hb.height;
      var bx = this._boxR || (this._boxR = { top: 0, height: 0, bottom: 0, left: 0, width: 0 });
      if (this._boxTopDoc !== undefined) {
        var sp = this._boxSp || 0;
        bx.height = this._boxH;
        bx.top = (this._boxTopDoc - sy) * (1 + sp) + (this._boxH / 2 - vh2 / 2) * sp;
        bx.bottom = bx.top + bx.height;
        bx.left = this._boxLeft; bx.width = this._boxW;
      }
      return g;
    }

    _resize() {
      var w = this.clientWidth || 1, h = this.clientHeight || 1;
      // full dpr on phones too: the viewport-fixed canvas is ~10x smaller
      // than the old section-spanning one, so crispness is affordable now.
      // Fast DESKTOP climbs one more stop to 2.5 for the lip/pour detail;
      // narrow/LITE keep their exact 2.0 cap. setPixelRatio reallocates the
      // buffer — fire it ONLY on an actual change.
      var dpr = Math.min(this._fast ? 2.5 : 2, window.devicePixelRatio || 1);
      if (this._dpr !== dpr) { this._renderer.setPixelRatio(dpr); this._dpr = dpr; }
      this._renderer.setSize(w, h, false);
      this._narrow = window.__forceMobile || window.innerWidth <= 760; // the dedicated mobile page pins this true at any width
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
        // phones: a bigger cup that rides down the LEFT column, beside the
        // compact text box on the right (they must not overlap). 0.58vw
        // (was 0.46) — the cup read "very small next to the text"; at the
        // 0.17vw pour line its half-width (0.213/unit height) still clears
        // both the left edge and the 63vw text box with a whisker to spare.
        targetPx = Math.max(140, Math.min(bPx ? bPx * 0.95 : 200, 0.58 * window.innerWidth, 255));
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
      this._fxDefault = this._narrow ? 0.17 : 0.30; // phones: cup on the LEFT pour line, beside the right-hand text box; desktop: the pour line
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
      this._measureRects(); // refresh the cached document-space layout (resize path)
    }

    _tick() {
      var dt = Math.min(0.05, this._clock.getDelta());
      if (this._hidden || this._offscreen) { _pourHandoff.glassActive = false; return; }
      _pourHandoff.glassActive = true;
      _pourHandoff.beat = performance.now(); // heartbeat: the bottle resumes its own jet if this scene ever stalls
      // tell the bottle whether the CUP itself is on screen — the full
      // transfer is held until the user can actually watch it
      // cached layout: getBoundingClientRect forces layout, so document-space
      // rects are re-measured on resize/load/class-flip (_measureRects) and
      // replayed against scrollY here — never read per frame
      var sy = window.scrollY;
      var grA = this._syncRects(sy);
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
      var goingUp = this._lastSy !== undefined && sy < this._lastSy - 1;
      this._lastSy = sy;
      // THE MIRROR: the cup simply holds whatever the bottle has poured so
      // far — arrive after the pour and it is full; rewind and it empties as
      // the bottle refills. No stream to break, nothing to desynchronize.
      var settleGap = Math.abs(diff); // how far the fill is from rest — the mirror path measures against ITS target
      if (_pourHandoff.hasBottle) {
        var t2 = (1 - _pourHandoff.bLevel) / 0.8 * 0.85;
        if (t2 < 0) t2 = 0; else if (t2 > 0.85) t2 = 0.85;
        settleGap = Math.abs(t2 - this._level);
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
      this._storyLive = true; // default VISIBLE — only a fresh in-block measure may hide (a stale latch once froze the canvas hidden)
      this._hbRide = false;
      if (this._hb && _pourHandoff.hasBottle && this.parentElement) {
        this._hbRide = true;
        var hb = this._hbR; // cached rect — measured on resize/load, replayed against scrollY (no per-frame layout read)
        // phones: use the CANVAS height (100lvh, stable) as the viewport
        // height — window.innerHeight breathes ±60-100px with the iOS URL
        // bar, which made every vh-derived target (lock point, gates, fades)
        // drift mid-scroll
        var vh = this._narrow ? (grA.height || window.innerHeight) : window.innerHeight;
        var cupPx = this._cupPx || 269;
        var pr2 = this._parR; // cached parent (herowords) rect — replayed against scrollY
        // phones: the canvas is viewport-FIXED (style.css) — it must vanish
        // outside the cup's chapters or it would sit over every later
        // section. Generous range + hysteresis (below): show instantly,
        // hide only after a stable run of off-story ticks, never strobe.
        this._storyLive = pr2.top < vh * 2.5 && hb.bottom > -1.5 * vh;
        // the herowords park. Phones CAP the park depth in absolute screens:
        // the section is ~3 screens taller there (the walk-to-centre runway),
        // and a pure fraction would sink the park far below the hero pour —
        // the cup must still wait ~half a screen into the section to catch it.
        // phones: the cup waits OFF-SCREEN below (user: "it's supposed to be
        // off screen"), DEEP enough that it cannot poke in while the bottle
        // act is still on stage — park 1.35 screens into the section, so the
        // cup's top edge only enters once herowords fully owns the viewport
        // (user: "it's still in the bottle animation — I did not want it in
        // there"). It rides INTO view with the scroll and locks at the midline.
        var base0 = pr2.top + (this._narrow ? 1.35 * vh : 0.62 * Math.max(1, pr2.height));
        var baseLock = vh * 0.5 + cupPx * 0.5;               // cup centred on screen
        var M2 = Math.max(20, (vh - cupPx) * 0.5);           // sticky margin inside the stage
        var baseScr = Math.min(Math.max(baseLock, base0), hb.bottom - M2);
        // ── while the "Two ancient islands / One clear water" title is framed, sit
        // the cup's MIDLINE exactly on the title's midline (measured live, so it holds
        // at any viewport). Off-title (down on the stage), the normal ride resumes.
        // ── keep the cup beside the framed "Two ancient islands / One clear
        //    water" title, then hand it smoothly to the centre of the screen as
        //    the title's centre rises past the top. This is a POSITION blend
        //    (a function of where the title is), NOT a time filter — so while the
        //    title is framed the cup sits EXACTLY on title-mid + drop; its
        //    placement never lags or floats during a scroll, and the old ~140px
        //    teleport at the title→stage handoff is smoothed out.
        this._fxClamp = undefined; // refreshed each tick while the title box is on stage (desktop horizontal guard below)
        var box = this._heroBox || (this._heroBox = document.querySelector(".herowords .hero__copy"));
        if (box) {
          var brr = this._boxR; // cached copy-box rect — its data-speed parallax transform is replayed analytically in _syncRects
          if (brr.height && brr.top < vh && brr.bottom > 0) {
            var boxMid = brr.top + brr.height * 0.5;                    // the whole copy block's vertical centre — NOT just the title
            if (this._narrow) {
              // phones: NO box-lock — the title box waits at the BOTTOM of
              // the frame and the cup rides SCREEN CENTRE above it, the same
              // still the user approved at "Splits beautifully". The box bows
              // out as it lifts off the frame; position-driven, so it rewinds.
              box.style.opacity = smoothstep(0.10 * vh, 0.45 * vh, boxMid).toFixed(3);
              // user: lift the cup a little on the "Two ancient islands" still.
              // Active only while the title box sits LOW in the frame (that still);
              // eases to 0 as the title rises off the top, so the later "Splits
              // beautifully" still keeps its screen-centre placement. Position-
              // driven → rewinds cleanly. Live-tunable in px via ?coords __cupLift.
              var titleFramed = smoothstep(0.50 * vh, 0.72 * vh, boxMid);
              var lift = (typeof window.__cupLift === "number") ? window.__cupLift : 0; // user: cup DEAD-CENTRE (v+h) on the "Two ancient islands" still — was vh*0.075. Live-tunable via ?coords __cupLift.
              baseScr -= lift * titleFramed;
            } else {
              var drop = (typeof window.__cupDrop === "number") ? window.__cupDrop : Math.min(170, Math.round(vh * 0.2125)) - 200; // BELOW the text-box midline, minus a 5cm lift (≈200px at the user's ~40px/cm) — the framed cup sat a little low. DESKTOP ONLY (the else branch). Live-tunable in px via ?coords
              var baseOn = boxMid + cupPx * 0.5 + drop;                 // cup visual centre = boxMid + drop
              // wt=1 while the text box is framed (cup locked beside it); eases to
              // 0 (centre-follow) as the box's centre rises past the top.
              var wt = smoothstep(-0.05 * vh, 0.30 * vh, boxMid);
              baseScr = baseScr + (baseOn - baseScr) * wt;
              // horizontal guard: the cup rides the fixed 0.30 pour line, but
              // below ~1150px viewport that line lands INSIDE the centred copy
              // block (the reported "cup overlaps Two ancient islands"). While
              // the title is framed (wt→1), slide the cup left just enough to
              // keep a clear gap to the box's left edge — and never off the
              // screen's left edge. Position-blended → smooth, rewinds clean.
              if (brr.left !== undefined) {
                var cupHalfPx = 0.213 * cupPx; // rendered half-width: 0.213 per unit of cup px-height (see _resize)
                var safeFx = (brr.left - 36 - cupHalfPx) / Math.max(1, grA.width);
                var minFx = (cupHalfPx + 12) / Math.max(1, grA.width);
                var fxGuard = Math.max(minFx, Math.min(this._fxDefault, safeFx));
                this._fxClamp = this._fxDefault + (fxGuard - this._fxDefault) * wt;
              }
            }
          }
        }
        // ── glide, don't teleport: ease the cup toward its target over TIME
        //    instead of tracking scroll rigidly. Any jump in the target (branch
        //    handoff, the pour catch, a fast scroll) becomes a slow, smooth slide
        //    into place — never a snap-cut. Bigger __cupGlide = slower / more
        //    deliberate (ms time-constant, live-tunable via the ?coords panel).
        //    It settles exactly at rest, so the framed placement stays perfect,
        //    and nothing here touches scrollY — scrolling back up is always free.
        // PHONES: NO glide. On the viewport-fixed canvas every narrow target
        // is continuous (bottom-wait -> page ride -> midline lock -> stage
        // clamp all meet without jumps), and the low-pass was the "cup keeps
        // sinking" bug: chasing a page-anchored target during momentum lags
        // it by scrollspeed x tau — hundreds of px below its spot. Direct
        // placement tracks the page 1:1 and sits pixel-still when locked.
        if (this._narrow) {
          this._rideY = baseScr; // keep fresh in case the viewport crosses 760px
        } else {
          var tauMs = (typeof window.__cupGlide === "number") ? window.__cupGlide : 280;
          var tau = Math.max(20, tauMs) / 1000;
          if (this._rideY === undefined) this._rideY = baseScr;
          else {
            this._rideY += (baseScr - this._rideY) * (1 - Math.exp(-dt / tau));
            if (Math.abs(baseScr - this._rideY) < 0.5) this._rideY = baseScr; // land exactly on the perfect spot
          }
          baseScr = this._rideY;
        }
        this._glass.position.y = (0.5 - (baseScr - grA.top) / Math.max(1, grA.height)) * 2 * this._halfH;
        // hand the copy its cue whether or not a whisky vessel exists — CSS
        // reads --hb to fade in "Splits beautifully with a little whisky";
        // gating this on _wb left the stage wordless while the act sleeps
        var w0 = Math.max(0, Math.min(1, (vh * 0.80 - hb.top) / Math.max(1, hb.height - vh * 0.20)));
        if (Math.abs((this._hbLast || 0) - w0) > 0.002) {
          this._hbLast = w0;
          this._hb.style.setProperty('--hb', w0.toFixed(3));
        }
        // DESKTOP: the cup keeps its longitude — it rides straight down the
        // pour line, never drifting toward the centre (the user was firm).
        // PHONES: the cup's longitude tells the story arc — it catches the
        // pour on the LEFT line, WALKS to centre across the ~3 quiet screens
        // before the title (user-directed), presents centred above the
        // bottom title box, steps BACK to the pour line as the whisky act
        // begins (the tipped decanter needs ~0.75 units of side stage a
        // phone doesn't have at centre), and returns to centre as the
        // decanter exits — both framed stills show a centred cup. All
        // position/scrub-driven, so every move rewinds.
        var fxRide = (this._fxClamp === undefined) ? this._fxDefault : this._fxClamp;
        if (this._narrow) {
          var walk = Math.min(1, Math.max(0, (-pr2.top - 0.15 * vh) / (1.1 * vh))); // progress through the (shortened) herowords run-up — completes ~1.25 screens in
          var centred = Math.max(walk * (1 - smoothstep(0.02, 0.20, w0)), smoothstep(0.88, 0.985, w0));
          fxRide += (0.5 - this._fxDefault) * smoothstep(0, 1, centred);
          this._glass.position.x = (fxRide - 0.5) * 2 * this._halfW;
        } else {
          // desktop: glide the longitude too — the title guard engages as the
          // copy box walks on stage, and a clamp that SNAPS would teleport the
          // cup sideways (same time constant as the vertical __cupGlide)
          var tauX = Math.max(20, (typeof window.__cupGlide === "number" ? window.__cupGlide : 280)) / 1000;
          if (this._rideFx === undefined) this._rideFx = fxRide;
          else {
            this._rideFx += (fxRide - this._rideFx) * (1 - Math.exp(-dt / tauX));
            if (Math.abs(fxRide - this._rideFx) < 0.0006) this._rideFx = fxRide;
          }
          this._glass.position.x = (this._rideFx - 0.5) * 2 * this._halfW;
        }
        // whisky timeline, scrubbed by how deep the stage has been ridden —
        // asleep until the user's decanter file gives us _wb. The decanter
        // drops in ABOVE the pinned cup with the lid ON, the lid lifts off to
        // the side, THEN it tips and pours, rights itself, and the lid seats
        // back on. All scrubbed by w, so scrolling up rewinds the whole act.
        if (this._wb) {
          var w = w0;
          this._extra = 0.05 * smoothstep(0.60, 0.78, w);        // cup gets a LITTLE whisky ("one part whisky · four parts mastry")
          var a2 = smoothstep(0.05, 0.20, w) * (1 - smoothstep(0.86, 0.93, w)); // drops in, holds, then DISSOLVES as it finishes righting — gone before the "Splits beautifully" still is composed (cup + copy only)
          if (a2 > 0.002) {
            this._whiskyArm();
            var k2 = smoothstep(0.42, 0.56, w) * (1 - smoothstep(0.74, 0.88, w)); // tip in, brief hold for the splash, then rights back up (a measured pour, not a dump)
            var rz2 = k2 * 1.2;   // gentler pour angle — tips enough to splash, not to empty
            // BOTTLE PHYSICS: as it tips, the decanter swings UP and OVER so its
            // mouth ends just above the cup — the whisky then simply FALLS in,
            // near-vertical like the hero pour (no sideways squirt, no bent
            // stream). Clearance comes from HEIGHT: the tipped body rides well
            // above the cup's rim, so the vessels still never touch.
            var wbx = this._glass.position.x + (this._narrow ? 1.05 : 1.45) - k2 * (this._narrow ? 0.26 : 0.66);
            var wby = this._glass.position.y + 0.45 + (1 - a2) * 1.1 + k2 * 0.95;
            this._wb.visible = true;
            this._wb.position.set(wbx, wby, 0);
            // liquid SURFACE: level in the world, DRAINING as it pours, with a
            // small settling slosh. Baseline is a pure function of w (so scrub /
            // rewind is deterministic); slosh is a decaying, tightly-clamped
            // overlay driven by scrub speed that settles to level when idle.
            if (this._wbLiquidPlane) {
              var drain = smoothstep(0.58, 0.76, w);                              // a brief splash — the level drops only a little (rest 0.62 -> 0.52)
              var fill = this._wbFillRest + (this._wbFillLow - this._wbFillRest) * drain;
              var dw = w - (this._wLast == null ? w : this._wLast); this._wLast = w;
              var sv = (this._sloshV || 0);
              sv += dw * 62;                                                       // scrub speed kicks the surface — harder, the spirit has weight
              sv -= (this._sloshA || 0) * 0.20;                                    // spring back to level
              sv *= 0.83;                                                          // lighter damping: a longer, wetter settle
              var sa = (this._sloshA || 0) + sv * Math.min(1, dt * 60);
              sa = Math.max(-0.085, Math.min(0.085, sa));                          // clamp <= ~5deg (still never pokes the wall)
              if (Math.abs(dw) < 0.0004) sa *= 0.86;                              // settle to level when the scroll stops
              this._sloshV = sv; this._sloshA = sa;
              var n = this._wbLiquidPlane.normal.set(sa, -1, 0); n.normalize();
              this._wbLiquidPlane.constant = -n.y * (wby + fill);                  // surface through (0, wby+fill, 0), tilted by slosh
            }
            this._wb.rotation.z = rz2;
            this._wbMats.forEach(function (m) { m.opacity = m._op0 * a2; });
            // the stopper: on 0.06→0.34 seated · off 0.34→0.48 lifts aside ·
            // then it DISAPPEARS during the pour (0.55→0.70) and never comes
            // back — no re-seat (user: "let the cap come off and let it
            // disappear forever"). Scrub-driven, so rewinding restores it.
            if (this._wbCork && this._wbHolder) {
              var corkK = 1 - smoothstep(0.56, 0.72, w);
              if (this._wbCorkMats) for (var ci = 0; ci < this._wbCorkMats.length; ci++) this._wbCorkMats[ci].opacity *= corkK;
              this._wbCork.visible = corkK > 0.002;
              var off = smoothstep(0.28, 0.44, w);
              this._wb.updateMatrixWorld(true);
              // seated pose: where the cork sits ON the vessel (follows its tilt)
              // (cached matrices — two fresh Matrix4 per frame used to churn here)
              var seatM = (this._corkM1 || (this._corkM1 = new THREE.Matrix4())).multiplyMatrices(
                this._wbHolder.matrixWorld,
                (this._corkM2 || (this._corkM2 = new THREE.Matrix4())).makeTranslation(this._corkSeat.x, this._corkSeat.y, this._corkSeat.z));
              var _sp = this._corkSP || (this._corkSP = new THREE.Vector3());
              var _sq = this._corkSQ || (this._corkSQ = new THREE.Quaternion());
              var _ss = this._corkSS || (this._corkSS = new THREE.Vector3());
              seatM.decompose(_sp, _sq, _ss);
              // waiting pose: upright, off to the outer side, held level in the world
              var upX = this._glass.position.x + (this._narrow ? 1.05 : 1.45);
              var upY = this._glass.position.y + 0.55;
              var restW = this._corkRest || (this._corkRest = new THREE.Vector3());
              restW.set(upX + 0.48, upY + 0.55, 0.34); // waits low at the side, fully in frame
              var upQ = this._corkUpQ || (this._corkUpQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.4, 0)));
              this._wbCork.position.copy(_sp).lerp(restW, off);
              this._wbCork.quaternion.copy(_sq).slerp(upQ, off);
              this._wbCork.scale.copy(_ss);
            }
            wp = smoothstep(0.58, 0.64, w) * (1 - smoothstep(0.72, 0.78, w)); // a brief SPLASH, not a long pour (copy: "a little whisky")
            if (wp > 0.01) {
              // emit from the decanter's ACTUAL lip: the lowest point of the
              // mouth rim under the vessel's live tilt (fit at load, solved
              // analytically here — no facet jitter).
              var lipX, lipY, dxu = 0, dyu = -1;
              if (this._wbLipC && this._wbHolder) {
                this._wbHolder.updateWorldMatrix(true, false);
                var M = this._wbHolder.matrixWorld;
                var Cw = this._wbTmpC || (this._wbTmpC = new THREE.Vector3());
                var Uw = this._wbTmpU || (this._wbTmpU = new THREE.Vector3());
                var Vw = this._wbTmpV || (this._wbTmpV = new THREE.Vector3());
                Cw.copy(this._wbLipC).applyMatrix4(M);
                Uw.set(1, 0, 0).transformDirection(M);   // rim-plane basis in world (unit — M is rotation only)
                Vw.set(0, 0, 1).transformDirection(M);
                var a = Uw.y, b = Vw.y, mag = Math.sqrt(a * a + b * b), R = this._wbLipR;
                if (mag > 1e-4) {                          // lowest circle point: minimise (a·cosθ + b·sinθ)
                  var cT = -a / mag, sT = -b / mag;
                  lipX = Cw.x + R * (cT * Uw.x + sT * Vw.x);
                  lipY = Cw.y + R * (cT * Uw.y + sT * Vw.y);
                  dxu = (lipX - Cw.x) / R; dyu = (lipY - Cw.y) / R; // unit downhill direction IN the rim plane
                } else { lipX = Cw.x; lipY = Cw.y; } // vessel upright — no defined low point
              } else {                                  // fallback: the old axis-mouth point
                lipX = wbx - 0.75 * Math.sin(rz2);
                lipY = wby + 0.75 * Math.cos(rz2);
              }
              // REALISTIC EXIT (user: "there should be a curve from the lip to
              // the stream, not a straight cut-off"): the liquid doesn't drop
              // off the lip point — it SLIDES ACROSS the tilted mouth and
              // launches TANGENT to it. Start the arc a little INSIDE the
              // mouth (the head overlaps the liquid surface — no seam) with
              // velocity along the rim plane's downhill direction; gravity
              // then bends it over the lip into the fall — the nappe curve.
              // The jet's built-in throat flare widens the first 10%, so the
              // head visually wraps the lip edge. All pure functions of w.
              var inset = (this._wbLipR || 0.15) * 0.85;   // head starts deep INSIDE the mouth — the stream visibly wells out of the lip, never a mid-air seam
              var sp = 0.55 + 0.75 * wp;                 // exit speed grows with the pour
              wjet = { x0: lipX - dxu * inset, y0: lipY - dyu * inset,
                       vx: dxu * sp, vy: Math.min(-0.12, dyu * sp),
                       g: 12.5, r0: 0.03 + 0.022 * wp,   // a fatter head that wraps the lip glass
                       wrapR: (this._wbLipR || 0.15) * 0.9, // the throat flares out to nearly the FULL mouth radius so the head plugs the bead — the old 1.35x flare left a thin thread floating inside the wide mouth (the "big wide gap")
                       organic: true,   // the hero pour's physics: varicose wave, breakup, droplets
                       cupX: this._glass.position.x };
            }
          } else { this._wb.visible = false; if (this._wbCork) this._wbCork.visible = false; this._sloshV = 0; this._sloshA = 0; this._wLast = null; this._whiskyDisarm(); }
        }
      } else if (this._wb) { this._wb.visible = false; if (this._wbCork) this._wbCork.visible = false; this._whiskyDisarm(); }

      // waterline
      var waterY = this._glass.position.y + this._waterBase + Math.min(0.92, this._level + this._extra) * (0.97 - this._waterBase);
      this._waterPlane.constant = waterY;
      var rIn = this._innerR(waterY - this._glass.position.y) * 0.995;
      this._waterTop.position.set(0, waterY + 0.002 - this._glass.position.y, 0); // local to the glass group
      this._waterTop.scale.set(rIn, rIn, 1);
      this._waterTop.visible = this._level + this._extra > 0.02;

      // the whisky folds in: the water warms toward a rich amber and the
      // clear tumbler walls take on a matching brown cast as the spirit lands
      if (this._waterC0 === undefined) {
        this._waterC0 = this._water.material.color.clone();
        this._waterC1 = new THREE.Color(0xb0520f);   // rich whiskey amber, redder + less green (was 0xa5611a). The body shader's green-biased Beer-Lambert absorb (exp(-vec3(0.42,0.14,0.28))) preserves green most, dragging the old target to khaki-olive on the dark stage; pushing the target red-heavy (R:G ~2.1) so it lands on rich amber AFTER absorption
        this._topC0 = this._waterTop.material.color.clone();
        this._topC1 = new THREE.Color(0xd8933a);      // warmer amber surface sheen (was 0xd39a44) — richer gold on the meniscus
        this._glassTint = new THREE.Color(0x8e5119);  // warmer brown wash for the glass walls (was 0x8a561f)
      }
      var whiskyAmt = Math.min(1, this._extra / 0.05); // 0 → 1 as the cup takes its pour
      var wmix = whiskyAmt * 0.90;                     // deeper blend (was *0.85 → *0.7 originally)
      this._water.material.color.lerpColors(this._waterC0, this._waterC1, wmix);
      this._waterTop.material.color.lerpColors(this._topC0, this._topC1, wmix);

      // tint the glass itself: the clear tumbler warms brown with the whisky.
      // Skip the fresnel ShaderMaterial (no .color); cache each material's base
      // colour so a loaded glass-src GLB tints from its own hue too.
      if (this._tumblerShells) {
        var gt = whiskyAmt * 0.44; // stronger warm wash (was 0.30) — still reads as glass
        for (var si = 0; si < this._tumblerShells.length; si++) {
          var sm = this._tumblerShells[si].material;
          if (!sm || !sm.color) continue;
          if (!sm.userData._baseCol) sm.userData._baseCol = sm.color.clone();
          sm.color.lerpColors(sm.userData._baseCol, this._glassTint, gt);
        }
      }

      // feed the shared water-realism shader uniforms (guarded — they only
      // exist after the first program compile)
      if (this._waterUniforms) {
        this._waterUniforms.uWaterlineY.value = waterY;
        this._waterUniforms.uBaseY.value = this._glass.position.y + this._waterBase;
        this._waterUniforms.uTime.value = t;
        this._waterUniforms.uAgitate.value = Math.max(pour, wp);
      }
      if (this._waterTopUniforms) {
        this._waterTopUniforms.uTime.value = t;
        // impact ripples: the falling jet (water or whisky) drives expanding
        // rings; stray splash droplets keep the surface talking after
        var ripC = this._waterTopUniforms.uRipAmp;
        var ripTarget = Math.min(1, Math.max(pour, wp) * 1.1 + Math.min(0.35, this._splashData.length * 0.012));
        ripC.value += (ripTarget - ripC.value) * (1 - Math.pow(0.10, dt));
        this._waterTopUniforms.uRipPh.value =
          (this._waterTopUniforms.uRipPh.value + dt * (4 + 6 * ripC.value)) % 100;
      }
      // the decanter's spirit: time + agitation (pour strength and the
      // surface slosh) feed its inner fire and glare
      if (this._wbShaderU) {
        var wAg = Math.min(1, wp + Math.abs(this._sloshA || 0) * 8);
        for (var wu = 0; wu < this._wbShaderU.length; wu++) {
          this._wbShaderU[wu].uTime.value = t;
          this._wbShaderU[wu].uAgitate.value = wAg;
        }
      }

      // phones: hide the viewport-fixed canvas (and skip the GPU) outside
      // the cup's chapters — desktop's canvas is section-bound and self-clips.
      // HYSTERESIS: show instantly, hide only after 12 consecutive off-story
      // ticks — a boundary jitter (URL bar, bursty rects) must never strobe it.
      // This runs BEFORE the idle gate: an idle early-return must never be
      // able to skip the hide (stale canvas parked over later sections) or
      // the un-hide (cup never coming back) on the fixed mobile canvas.
      if (this._narrow && this._storyLive === false) {
        this._storyOff = (this._storyOff || 0) + 1;
        if (this._storyOff >= 12) {
          if (!this._cvsHidden) { this._cvsHidden = true; this._renderer.domElement.style.visibility = 'hidden'; }
          return;
        }
      } else this._storyOff = 0;
      if (this._cvsHidden) { this._cvsHidden = false; this._renderer.domElement.style.visibility = ''; }

      // idle gate (EVERY visitor, not just reduced-motion): with no jet, no
      // particles, a settled fill and no recent input, the scene is a still
      // life — skip the GPU frame entirely. A ~18MP canvas re-rendered 60x/s
      // while nothing moves was the single biggest constant drain. Any input
      // change (scroll, fill-target shift, resize) re-arms a short settle
      // window so every ease/fade completes before the gate closes; a cup
      // holding water keeps its ambient bubbles, and they keep it live.
      if (this._settle === undefined) { this._settle = 45; this._lastIdleSy = -1; }
      var levelMoving = Math.abs(this._level - (this._lastLevel === undefined ? this._level : this._lastLevel)) > 0.0005;
      var targetMoved = this._lastTarget === undefined || Math.abs(target - this._lastTarget) > 0.0005;
      this._lastLevel = this._level; this._lastTarget = target;
      if (sy !== this._lastIdleSy || targetMoved || this._needsRender) this._settle = 45;
      this._lastIdleSy = sy;
      if (this._settle > 0) this._settle--;
      if (pour <= 0 && wp <= 0 && settleGap < 0.001 && (!levelMoving || settleGap < 0.01) &&
          !this._splashData.length && !this._bubData.length &&
          this._settle <= 0 && !this._needsRender &&
          this._stream.material.opacity <= 0.011 && this._core.material.opacity <= 0.011) return;
      this._needsRender = false;

      // the jet IS the bottle's jet: its exit state arrives in viewport px,
      // converts into this scene's world units, and the whole stream — lip to
      // cup — is drawn by this one overlapping canvas. No border, no cut.
      var jet = this._jet || (this._jet = {});
      var covers = !live; // the default frame-top jet needs no coverage test
      if (live) {
        var gr = grA; // same element — reuse this frame's cached rect (no second layout read)
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
        this._jetBk = null;
        this._tubeWarm = false; // the next pour's first frame always re-solves
        stream.material.opacity = Math.max(0, stream.material.opacity - 0.08);
        core.material.opacity = Math.max(0, core.material.opacity - 0.12);
        if (stream.material.opacity <= 0.01) { stream.visible = false; core.visible = false; }
        return;
      }
      // half-rate tube solve (mirrors the bottle's jet): the pour evolves
      // slowly enough that a 30Hz ribbon reads identical to 60Hz — this skips
      // the ring solve + four buffer uploads every other frame. Opacity still
      // ramps every frame and droplet integration is untouched.
      this._tubeFlip = !this._tubeFlip;
      if (this._tubeFlip && this._tubeWarm) {
        stream.visible = true; core.visible = true;
        stream.material.opacity = WATER_JET_OP * Math.min(1, 0.35 + pour * 3);
        core.material.opacity = WATER_CORE_OP * Math.min(1, 0.35 + pour * 3);
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
      // ── ORGANIC (whisky) mode: the HERO pour's physics, copied verbatim
      // from Bottle3D._updateStream (user: "just like the one above it") —
      // mass-conservation taper, a Plateau–Rayleigh varicose wave that
      // DEEPENS downstream, the same breakup length, the neck-in at the
      // pinch-off, and the lateral wander. Past the breakup the tube ends
      // and _updateSplash rains it on as prolate droplets (this._jetBk).
      var organic = !!jet.organic;
      var v0m = Math.max(0.2, Math.sqrt(jet.vx * jet.vx + jet.vy * jet.vy));
      var Lb = Math.min(6.5, Math.max(0.14, 26 * v0m * Math.pow(r0, 0.75)));
      var s = 0, bk = null;
      for (var i = 0; i < RINGS; i++) {
        var tt = i * dtt;
        var wy = jet.y0 + jet.vy * tt - 0.5 * G * tt * tt;
        var u = time - tt;
        var fr = tt / Math.max(1e-4, tofl);
        var cvx = jet.vx + 2 * corr * fr / Math.max(1e-4, tofl);   // includes the cup-bend drift
        var cvy = jet.vy - G * tt;
        var spd = Math.sqrt(cvx * cvx + cvy * cvy);
        if (i > 0) s += spd * dtt;
        // the identical throat flare as the bottle's jet — same birth at the lip
        var thr = 1 - fr / 0.10; if (thr < 0) thr = 0;
        var wx = jet.x0 + jet.vx * tt + corr * fr * fr;
        var r;
        if (organic) {
          var rBase = r0 * Math.sqrt(v0m / Math.max(v0m, spd));    // mass conservation: gravity stretches, the jet thins
          var frac = s / Lb;
          r = rBase * (1 + (0.08 + 0.95 * frac * frac) * 0.42 * Math.sin(s * 10.5 - time * 30));
          if (frac > 0.78) r *= Math.max(0.10, 1 - (frac - 0.78) * 3.6); // necks into the pinch-off
          // THE LIP WRAP: when the emitter hands a real mouth radius (the whisky
          // pour off the decanter's spout), flare the first 10% of the fall out
          // to it so the head WELLS over the bead with zero daylight — mirrors
          // the hero bottle's meniscus. The frame-top water jet has no lip here
          // (the bottle owns its own), so it keeps the gentle 1.35x nappe.
          if (jet.wrapR) { var wf = thr * thr; r = r * (1 - wf) + Math.max(r, jet.wrapR) * wf; }
          else r *= (1 + 0.35 * thr * thr);
          if (r < 0.003) r = 0.003;
          wx += Math.sin(s * 7.5 - time * 11) * 0.016 * frac;      // lateral wander grows down-stream
        } else {
          r = r0 * (1 - 0.22 * fr) * (1 + 0.07 * Math.sin(u * 22.0)) * (1 + 0.35 * thr * thr);
          if (r < 0.008) r = 0.008;
        }
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
        if (organic && s >= Lb && fr > 0.12 && wy > waterY + 0.05) {
          // pinched off mid-air: hand the rest of the fall to droplets
          bk = { x: wx, y: wy, vx: cvx, vy: cvy };
          break;
        }
        if (wy <= waterY) break;
      }
      this._jetBk = bk; this._jetBkPour = pour;
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
      this._tubeWarm = true;   // half-rate solves may now reuse this tube
    }

    _updateSplash(dt, pour, x, waterY) {
      var mesh = this._splash, data = this._splashData, dummy = this._dummy;
      if (pour > 0.05) {
        this._splashClock += dt * 40 * pour;                 // calmer: ~40% fewer ejecta (user: turn the splash down)
        var n = Math.floor(this._splashClock);
        this._splashClock -= n;
        for (var k = 0; k < n && data.length < mesh.instanceMatrix.count; k++) {
          var ang = Math.random() * Math.PI * 2;
          var sp = 0.14 + Math.random() * 0.42 * pour;       // tighter spray cone — droplets stay near the impact
          var rs = 0.026 + Math.random() * 0.026; // the ejecta sheet crowns at the jet's rim
          var vy0 = 1.25 + Math.random() * 1.4 * pour;       // lower crown — a wet burble, not a volcano
          var life0 = 0.55, s0 = 0.5 + Math.random() * 0.9;
          if (Math.random() < 0.12) { // fine spray haze riding above the crown
            s0 *= 0.45; vy0 *= 0.55; life0 = 0.95;
          }
          data.push({
            x: x + Math.cos(ang) * rs, y: waterY + 0.005, z: Math.sin(ang) * rs,
            vx: Math.cos(ang) * sp, vy: vy0, vz: Math.sin(ang) * sp,
            life: life0, s: s0
          });
        }
      }
      // past the whisky jet's Plateau–Rayleigh pinch-off (this._jetBk, set by
      // _updateJet's organic mode), the column rains on as prolate droplets —
      // the hero pour's exact hand-over. They inherit the breakup velocity
      // (cup-bend included), fall under the same gravity, and die at the
      // water where the splash ejecta above takes over the impact.
      var bk = this._jetBk;
      if (bk) {
        this._dripClock = (this._dripClock || 0) + dt * (26 + 40 * (this._jetBkPour || 0));
        var nd = Math.floor(this._dripClock); this._dripClock -= nd;
        for (var kd = 0; kd < nd && data.length < mesh.instanceMatrix.count; kd++) {
          data.push({
            x: bk.x + (Math.random() - 0.5) * 0.02, y: bk.y, z: (Math.random() - 0.5) * 0.02,
            vx: bk.vx + (Math.random() - 0.5) * 0.12, vy: bk.vy + (Math.random() - 0.5) * 0.3, vz: (Math.random() - 0.5) * 0.1,
            life: 0.9, s: 0.55 + Math.random() * 0.75
          });
        }
      }
      var gx0 = this._glass.position.x, gy0 = this._glass.position.y;
      for (var i = data.length - 1; i >= 0; i--) {
        var q = data[i];
        q.vy -= 12.5 * dt; // same stylized gravity as the jet
        // turbulent air: droplets wobble off their perfect arcs (gentler now)
        q.vx += Math.sin(q.y * 26.0 + q.life * 31.0) * 0.18 * dt;
        q.vz += Math.cos(q.y * 23.0 + q.life * 27.0) * 0.18 * dt;
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
        this._fizzClock = (this._fizzClock || 0) + dt * 17;
        var nf = Math.floor(this._fizzClock);
        this._fizzClock -= nf;
        // persistent nucleation sites: real sparkling water beads climb in
        // visible TRAINS off the same specks on the glass, not from everywhere
        var sites = this._fizzSites || (this._fizzSites = [
          { a: 0.8, r: 0.58 }, { a: 2.5, r: 0.50 }, { a: 4.3, r: 0.62 }
        ]);
        for (var kf = 0; kf < nf && data.length < mesh.instanceMatrix.count; kf++) {
          this._fizzN = (this._fizzN || 0) + 1;
          var fa, fr;
          if (this._fizzN % 5 < 3) { // most beads come from the trains
            var st = sites[this._fizzN % sites.length];
            fa = st.a + (Math.random() - 0.5) * 0.14;
            fr = rIn * (st.r + (Math.random() - 0.5) * 0.10);
          } else {
            fa = Math.random() * Math.PI * 2;
            fr = Math.sqrt(Math.random()) * rIn * 0.85;
          }
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
