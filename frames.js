// MASTRY scroll-scrub hero — frame manifest (Station 1 output).
// Loaded via <script src="frames.js"></script>. Defines one global, no exports.
// Frame i (1-based) = <tier dir> + String(i).padStart(pad,"0") + "." + ext
// scrubber.js picks the tier: SHAPE follows the DEVICE (a phone — coarse pointer
// with a phone-sized shorter side, ANY orientation — loads the pre-trimmed
// portrait center-crop tiers, cut on disk so the ~70% of each landscape frame a
// phone never shows is never downloaded); CONNECTION picks resolution WITHIN the
// chosen shape. Phones now have TWO portrait tiers: baseP (mobile-hd/, native
// 608x1080) is the default, and basePLow (mobile-final-render/, 400x810) is the
// lighter fallback a MEASURED-slow phone link steps down to — the same measured
// ladder that steps down AND climbs back up now runs on phones as well as desktop.
window.MASTRY_FRAMES = {
  base:     "frames/",       // 1920x1080 landscape — desktop default (~15.4 MB)
  baseLow:  "frames-720/",   // 1280x720 landscape (~8.8 MB), desktop on SLOW connections
                             //   (data-saver / 2g / 3g / weak 4g) so the hero still arrives fast.
  baseP: "mobile-hd/",       // native-resolution 608x1080 center crop — the phone default.
                             //   Full portrait quality (decoded RGBA ≈ 2.63 MB/frame). iOS
                             //   (no Network Information API) -> this tier by device shape,
                             //   never by guesswork; a MEASURED-slow phone link steps down
                             //   to basePLow (see the measured ladder in scrubber.js).
  basePLow: "mobile-final-render/", // 400x810 light fallback for measured-slow phone links
                             //   (~3.6 MB total, ~7 KB/frame, decoded ≈ 1.30 MB/frame). The
                             //   old phone default, now the slow-link floor; the rolling climb
                             //   lifts a phone back up to baseP once throughput proves out.
  baseLite:  "frames-lite/", // 854x480 landscape (~3.8 MB) — desktop CRAWL tier, chosen when
                             //   MEASURED throughput can't sustain the picked tier (~300 kbps
                             //   at its worst): the glide plays instead of slideshow-stepping.
  basePLite: "",             // empty -> phones never crawl: basePLow (400x810) is already the
                             //   slow-link floor, so the measured ladder never steps portrait to a lite tier
  ext:     "webp",
  count:   505,             // all 505 frames kept
  pad:     4,               // zero-pad width -> "0001"
  width:   1920, height: 1080,     // 1080p landscape tier pixel dims (engine cover-fits to natural size)
  poster:  "poster.jpg",  // full-quality late-Greek still (1920x1080 q90) for OG + no-JS fallback
  placeholder: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAA0JCgsKCA0LCwsPDg0QFCEVFBISFCgdHhghMCoyMS8qLi00O0tANDhHOS0uQllCR05QVFVUMz9dY1xSYktTVFH/2wBDAQ4PDxQRFCcVFSdRNi42UVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVH/wAARCAAOABgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDWbUg/yxxbO2TGWqs97MCXKeYgPzfusY9O9cSJZDhjIw46AmkNxIAQHcD0DGpKOym1KN4nVItjlSFbbnBorimuZiCPNcj03GigR//Z",
  totalBytes: 16180572,     // desktop 1080p tier total bytes (report/preload budgeting)
  tierBytes: {              // exact per-tier totals (report/preload budgeting + measured ladder)
    "frames/": 16180572, "frames-720/": 9277500,
    "frames-lite/": 3838434, "mobile-final-render/": 3622844,
    "mobile-hd/": 7951802
  }
};
