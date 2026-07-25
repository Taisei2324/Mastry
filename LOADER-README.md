# MASTRY loader — what's live on drinkmastry.com

This branch is an **archive of the loader work**, not a deploy source. See "How this
actually deploys" below — it is not Git-based.

## The loader

- The splash bottle spins for as long as the hero reel takes to buffer, then winds
  down (~2s) and comes to rest **label-front on every exit** — fast, slow or impatient.
- It is **pinned to the hero bottle's exact on-screen spot**, so it never moves; the
  splash then **disperses outward** (bloom + soften) to reveal the hero.
- Measured on the live site: spin → `is-leaving` at 0.8s → at rest facing front by
  2.8s → hero fully revealed at 3.8s.

Implementation notes worth keeping:

- **Canvas sprite sheet, not animated WebP.** `images/loader-sheet-{dark,light}.webp`
  is an 8x8 grid of 320x480 tiles = a 64-frame turntable, **frame 0 = label-front**.
  A rAF driver blits it, so the rest pose is ours to command; the old animated WebP
  had its rest moment baked at export time and stuttered against the 505-frame prefetch.
- **It always lands front.** The earlier `__loaderSpinLand` bailed on a short/impatient
  fade and left the bottle frozen mid-spin (it was observed resting on the *back*).
  `__loaderSpinStop` also force-draws `REST_FRAME` as a hard guarantee.
- **iPhone:** `placeSpin()` measures the **hero canvas's own box**, never
  `window.innerHeight`. On iOS Safari the URL bar makes `innerHeight` disagree with the
  canvas — on a 375x812 iPhone that sized the splash bottle **26.8px too tall and 39.4px
  too low** versus the hero bottle. Canvas-based it is **0.01px**. It also re-pins on
  `visualViewport` resize/scroll and for ~2s after load.
- **Disperse:** the bloom/blur must sit on the **contents**, never on `#loader`. A
  `filter`/`transform` there makes it the containing block for the `position:fixed`
  bottle and snaps it (measured 4px left / 13px up) at the handoff.
- **Never distort the type.** A `scaleY` on the rotated wordmark thickened vertical
  strokes but not horizontals, so the letterforms were misshapen. Width comes from
  tracking and weight.

## Mobile vs desktop (deliberately different)

| | mobile (<=760px) | desktop |
|---|---|---|
| indicator | a 1px hairline set to the bottle's **exact** vertical span, with a mastic-olive light travelling down it | three pulsing dots |
| wordmark | 24px, weight 300, wide tracking — a quiet label | large, weight 800 |

The mobile rule derives from the same reel fractions `placeSpin` uses (`.3095`–`.6285`
of a portrait frame), so the hairline lands on the bottle's top and bottom exactly.

## How this actually deploys (NOT Git)

The Vercel project has **no repository connected** — pushing branches deploys nothing.
Project `final` (domains `drinkmastry.com` + `drinkmastry.jp`), static, root `.`.

Deploys are made with the Vercel CLI from a full-site folder:

```
export PATH="$HOME/.local/node/bin:$PATH"     # Node installed locally, no admin needed
cd ~/mastry-live-deploy                        # full mirror of live + the loader
vercel deploy --yes                            # preview (preview URLs are 302-protected)
vercel promote <preview-url> --yes             # -> production, live in ~20s
```

Rollback: `vercel promote <older-production-url> --yes`.

`~/mastry-live-deploy` is the site mirrored from drinkmastry.com (both reels: `frames/`
505 + `mobile-hq/` 505, plus `favicon.ico`, which is referenced nowhere in the HTML and
is easy to miss) with the loader files copied over it.

## Known follow-ups

- `www.drinkmastry.com` and `drinkmastry.jp` do not resolve (no DNS pointing at Vercel).
- The two `loader-sheet-*.webp` kept their filenames but changed contents, and
  `/images/*` is served `immutable` — a returning visitor can get the old bottle from
  cache. Rename to `.v2.webp` (and update the two references) to force the update.
