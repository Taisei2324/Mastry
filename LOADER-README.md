# MASTRY loader — ready to deploy (2026-07-25)

8 files. Drop them into the site root, keeping the `images/` path. Nothing else changes.

```
index.html
mobile.html
script.js
style.css
images/loader-sheet-dark.webp
images/loader-sheet-light.webp
images/loader-solid-dark-still.webp
images/loader-solid-light-still.webp
```

## What's in it
- Bottle spins continuously the whole time the hero reel buffers.
- Winds down (~2s) and comes to rest **facing forward**, every exit — fast, slow, or impatient.
- Bottle is **pinned to the hero bottle's exact spot** and never moves; the splash then
  **disperses outward** (blooms + softens) to reveal the hero.
- Big vertical **LOADING** on the left. Works in both cream and espresso themes.

## iPhone fix (important)
`placeSpin()` now measures the **hero canvas's own box**, never `window.innerHeight`.
On iOS Safari the URL bar makes `innerHeight` disagree with the canvas — measured on a
375x812 iPhone with the bar showing, the old code put the splash bottle **26.8px too tall
and 39.4px too low** vs the hero bottle. Canvas-based: **0.01px**. Also re-pins on
`visualViewport` resize/scroll and for ~2s after load (the bar settles late), and the
vertical LOADING respects `env(safe-area-inset-left)` incl. landscape notch.

## Cache-bust
The two `loader-sheet-*.webp` keep their filenames but the CONTENTS changed (new render +
label contrast fix). Returning visitors can be served the old cached sheet. Either:
- rename to `loader-sheet-{dark,light}.v2.webp` and update the two references in
  `index.html` / `mobile.html`, **or**
- confirm the host sends `must-revalidate` for `images/*.webp`.

There is no service worker on this build, so otherwise a deploy is instant.

## Why this wasn't pushed from the machine that built it
drinkmastry.com is on Vercel, but the live build matches **no branch** of
`github.com/Taisei2324/Mastry` (live `scrubber.js` is 140+ lines ahead of the closest
branch), there is no `.vercel` link, and no `vercel`/`node`/`gh` CLI on the Mac. The
deploy source could not be identified, so pushing would have been a guess against
production. Point at the Vercel project's Git branch (or drag this folder's files into
the dashboard) to ship it.
