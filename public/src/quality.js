// Live-camera frame quality checks. Pure functions (no DOM) so they can be unit-tested.

export const THRESHOLDS = {
  dark: 55,          // mean luminance below → too dark
  bright: 200,       // washed out = bright AND low contrast (white paper with black text is fine)
  washedStd: 28,
  glare: 0.97,       // nearly everything clipped → pointing at a light / reflection
  contrast: 16,      // luminance std-dev below → nothing to read in the frame
  motion: 10,        // mean abs frame difference above → camera moving
  sharpness: 0.32,   // strongest-edge ÷ contrast below → blurry (measured: sharp label 0.96, tiny sharp text 0.40, defocused 0.26)
};

/** Convert RGBA pixels to a Float32Array of luminance. */
export function toGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  return g;
}

/** Value at quantile q (0..1) of a typed array (sorts a copy). */
function quantile(arr, q) {
  if (!arr.length) return 0;
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/**
 * Measure a grayscale frame.
 * sharpness = strongest edges (99.5th-percentile |Laplacian|) ÷ contrast range (p99 − p1 luminance).
 * Using the strongest edges rather than the average makes it independent of how much of the
 * frame is covered by text — a little crisp text on a big blank sticker still counts as sharp.
 */
export function measure(gray, w, h, prevGray = null) {
  const n = w * h;
  let sum = 0, sumSq = 0, clipped = 0;
  for (let i = 0; i < n; i++) {
    const v = gray[i];
    sum += v; sumSq += v * v;
    if (v >= 250) clipped++;
  }
  const mean = sum / n;
  const std = Math.sqrt(Math.max(0, sumSq / n - mean * mean));

  // Subsample for speed: every 2nd pixel on every 2nd row is plenty for percentiles.
  const laps = [];
  const lums = [];
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = y * w + x;
      laps.push(Math.abs(4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]));
      lums.push(gray[i]);
    }
  }
  const range = quantile(lums, 0.99) - quantile(lums, 0.01);
  const sharpness = range > 8 ? quantile(laps, 0.995) / range : 0;

  let motion = 0;
  if (prevGray && prevGray.length === n) {
    let d = 0;
    for (let i = 0; i < n; i += 2) d += Math.abs(gray[i] - prevGray[i]);
    motion = d / (n / 2);
  }
  return { mean, std, glare: clipped / n, sharpness, motion };
}

/** Pre-OCR guidance from frame metrics. Returns { ok, code, message }. */
export function frameAdvice(m, t = THRESHOLDS) {
  if (m.mean < t.dark) return { ok: false, code: 'dark', message: 'Too dark — add some light' };
  if (m.glare > t.glare || (m.mean > t.bright && m.std < t.washedStd)) return { ok: false, code: 'glare', message: 'Too much glare — tilt the camera slightly' };
  if (m.std < t.contrast) return { ok: false, code: 'empty', message: 'Point the frame at the spec text' };
  if (m.motion > t.motion) return { ok: false, code: 'motion', message: 'Hold still…' };
  if (m.sharpness < t.sharpness) return { ok: false, code: 'blur', message: 'Too blurry — hold steady and let it focus' };
  return { ok: true, code: 'ok', message: 'Looks good — reading…' };
}

/**
 * Post-OCR guidance from word boxes (Tesseract words with bbox {x0,y0,x1,y1}) inside a crop of cropW×cropH.
 * Returns { code, message } where code ∈ closer | further | none | lowconf | ok.
 */
export function textAdvice(words, cropW, cropH) {
  const good = (words || []).filter((w) => w.confidence >= 45 && /[a-z0-9]{2,}/i.test(w.text));
  if (!good.length) return { code: 'none', message: 'Can’t see any text — move closer to the label' };

  const heights = good.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  const rel = median / cropH;
  // On a ~1280px-wide crop, characters under ~16px are too small to read reliably.
  const px = median * (1280 / cropW);

  const margin = cropW * 0.015;
  const touching = good.filter((w) => w.bbox.x0 <= margin || w.bbox.x1 >= cropW - margin).length;

  if (px < 16) return { code: 'closer', message: 'Move closer — the text is too small' };
  if (rel > 0.3) return { code: 'further', message: 'Move back a little — too close' };
  if (touching >= Math.max(2, good.length * 0.4)) return { code: 'further', message: 'Move back so the whole name fits in the frame' };

  const avgConf = good.reduce((s, w) => s + w.confidence, 0) / good.length;
  if (avgConf < 60) return { code: 'lowconf', message: 'Text is hard to read — hold steady or add light' };
  return { code: 'ok', message: 'Text found — looking for the processor…' };
}

/**
 * Tracks recent frame results to spot a camera that can never get sharp
 * (cheap/dirty lens, or held closer than its minimum focus distance).
 */
export class BlurTracker {
  constructor(windowSize = 30) { this.size = windowSize; this.samples = []; }
  push(code) {
    // Only count steady, readable frames: motion/darkness are user problems, not camera problems.
    if (!['ok', 'blur'].includes(code)) return;
    this.samples.push(code === 'blur');
    if (this.samples.length > this.size) this.samples.shift();
  }
  get persistent() {
    if (this.samples.length < this.size) return false;
    return this.samples.filter(Boolean).length / this.samples.length > 0.85;
  }
  reset() { this.samples = []; }
}

/** Describe a camera's capture resolution. */
export function cameraAdvice(width, height) {
  const long = Math.max(width || 0, height || 0);
  if (!long) return null;
  if (long < 1000) return `Low-resolution camera (${width}×${height}). Move closer, or use a better camera.`;
  return null;
}
