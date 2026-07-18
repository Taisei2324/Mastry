/* Mastry service worker — GitHub Pages, base /Mastry/ (no server header control).
   Repeat-visit accelerator + offline layer. NOT a first-paint fix: the page that
   installs the SW is uncontrolled, so the tier + 2.5s timeout engine owns first paint.
   Strategy:
     - HTML navigations: NETWORK-FIRST (fresh inline router + fresh ?v= tags), cache
       fallback keyed WITHOUT the ?desktop/?mobile query, and a minimal inline offline
       page (NO head router) as the last resort so phones cannot enter a redirect loop.
     - Curated same-origin static (GLBs + label*.jpg, vendor/*.js, versioned engine/
       page CSS+JS): CACHE-FIRST. Everything else same-origin (images/**, *.obj) and
       ALL cross-origin (fonts, jsdelivr): PASSTHROUGH — images/ alone is ~86MB and
       would blow the ~50MB iOS Cache Storage quota and evict the GLBs this SW keeps.
     - Invalidation: cache name carries SW_VERSION; activate purges every other cache.
       BUMP SW_VERSION in the SAME commit that changes any assets/*.glb or label*.jpg. */
'use strict';

/* >>> bump on every deploy that changes a cached binary; keep in lockstep with the
   ?v= tag bumps on the pages. <<< */
var SW_VERSION = '20260718sw7';
var CACHE = 'mastry-' + SW_VERSION;

/* Intentionally EMPTY. Never precache bottle.glb — it would fight the LITE tier skip
   and bloat install. Everything a visit needs is captured by the cache-first path. */
var PRECACHE = [];

var MAX_BYTES = 5 * 1024 * 1024; // skip caching a response larger than this unless it is a whitelisted GLB

self.addEventListener('install', function () { self.skipWaiting(); });

self.addEventListener('activate', function (e) {
  e.waitUntil((async function () {
    var keys = await caches.keys();
    await Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
    if (self.registration.navigationPreload) { try { await self.registration.navigationPreload.enable(); } catch (x) {} }
    await self.clients.claim();
  })());
});

function isHTMLNav(req) {
  return req.mode === 'navigate' ||
    (req.method === 'GET' && (req.headers.get('accept') || '').indexOf('text/html') !== -1);
}

/* curated cache-first allowlist (same-origin only). Everything else -> passthrough. */
function isCacheableStatic(url) {
  var p = url.pathname;
  if (p.indexOf('/Mastry/assets/') === 0) return /\.glb$/.test(p) || /label(-full)?\.jpg$/.test(p); // NOT cap.obj
  if (p.indexOf('/Mastry/vendor/') === 0) return /\.js$/.test(p);
  var base = p.slice(p.lastIndexOf('/') + 1);
  return base === 'bottle-3d.js' || base === 'script.js' || base === 'mobile.js' ||
         base === 'style.css' || base === 'mobile.css';
}
function isWhitelistedGLB(url) { return /\/Mastry\/assets\/.+\.glb$/.test(url.pathname); }

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;                 // never touch POST/PUT/etc.
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // cross-origin (fonts, jsdelivr): passthrough

  /* 1) HTML navigations -> network-first (fresh router + fresh ?v=), cache fallback
        keyed without the view query, minimal inline offline page (no router) last. */
  if (isHTMLNav(req)) {
    e.respondWith((async function () {
      var key = new Request(url.origin + url.pathname); // drop ?desktop/?mobile from the cache key
      try {
        var preload = ('preloadResponse' in e) ? await e.preloadResponse : null;
        var net = preload || await fetch(req);
        if (net && net.ok && net.type !== 'opaque') {
          var c = await caches.open(CACHE); c.put(key, net.clone());
        }
        return net;
      } catch (err) {
        var cached = await caches.match(key, { ignoreSearch: true });
        if (cached) return cached;
        return new Response(
          '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">' +
          '<title>Offline — MASTRY</title><body style="margin:0;background:#0d0f0d;color:#e8e4d8;' +
          'font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh">' +
          '<div style="text-align:center"><h1 style="font-weight:400;letter-spacing:.3em">MASTRY</h1>' +
          '<p>You are offline.</p></div>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  /* 2) images/**, *.obj, and anything not on the allowlist -> passthrough (HTTP cache). */
  if (!isCacheableStatic(url)) return;

  /* 3) curated same-origin static -> cache-first, populate on miss (size-guarded). */
  e.respondWith((async function () {
    var cached = await caches.match(req);
    if (cached) return cached;
    try {
      var net = await fetch(req);
      if (net && net.status === 200 && (net.type === 'basic' || net.type === 'cors')) {
        var len = +(net.headers.get('content-length') || 0);
        if (isWhitelistedGLB(url) || !len || len <= MAX_BYTES) {
          var c = await caches.open(CACHE); c.put(req, net.clone());
        }
      }
      return net;
    } catch (err) {
      return cached || Response.error();
    }
  })());
});

self.addEventListener('message', function (e) { if (e.data === 'skipWaiting') self.skipWaiting(); });
