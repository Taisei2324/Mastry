// MASTRY scroll-scrub hero — frame manifest (Station 1 output).
// Loaded via <script src="frames.js"></script>. Defines one global, no exports.
// Frame i (1-based) desktop = base  + String(i).padStart(pad,"0") + "." + ext
// Frame i (1-based) mobile  = baseM + String(i).padStart(pad,"0") + "." + ext
window.MASTRY_FRAMES = {
  base:    "frames/",     // desktop tier dir (relative)
  baseM:   "frames-m/",   // mobile tier dir (relative)
  ext:     "webp",
  count:   505,           // frames actually produced (all 505 kept; desktop tier 1080p, ~15.0 MB)
  pad:     4,             // zero-pad width -> "0001"
  width:   1920, height: 1080,     // desktop frame pixel dims (full 1080p)
  widthM:  960,  heightM: 540,     // mobile frame pixel dims
  poster:  "poster.jpg",  // full-quality late-Greek still (1920x1080 q90) for OG + no-JS fallback
  placeholder: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAA0JCgsKCA0LCwsPDg0QFCEVFBISFCgdHhghMCoyMS8qLi00O0tANDhHOS0uQllCR05QVFVUMz9dY1xSYktTVFH/2wBDAQ4PDxQRFCcVFSdRNi42UVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVFRUVH/wAARCAAOABgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDWbUg/yxxbO2TGWqs97MCXKeYgPzfusY9O9cSJZDhjIw46AmkNxIAQHcD0DGpKOym1KN4nVItjlSFbbnBorimuZiCPNcj03GigR//Z",
  totalBytes: 15761910    // desktop tier total bytes (report/preload budgeting)
};
