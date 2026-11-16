// Live-camera frame quality checks. Pure functions (no DOM) so they can be unit-tested.

/**
 * Sensitivity presets. "High" is strict (nags early), "Low" is forgiving.
 *  dark/bright/washedStd/glare/contrast — lighting & "is there anything to read"
 *  motion     — frame-to-frame change of 16×16 block averages, as % of frame contrast
 *               (measured: 1–4 px hand tremor ≈ 3–17, moving the camera ≈ 29+)
 *  sharpness  — strongest-edge ÷ contrast (measured: sharp label 0.96, tiny sharp text 0.40, heavy defocus 0.26)
 *  softSharpness — if OCR can't read a frame softer than this, blame blur (not distance)
 *  closerPx   — median word height (scaled to a 1280px-wide crop) below which we say "move closer"
 *  furtherRel — median word height ÷ crop height above which we say "move back"
 *  touchFrac  — share of words touching the frame edge above which we say "move back so it fits"
 *  lowConf    — average OCR confidence below which we say the text is hard to read
 *  persist    — consecutive frames (~160 ms each) a problem must last before it is shown
 */
export const PRESETS = {
  low:    { label: 'Low',    dark: 35, bright: 210, washedStd: 22, glare: 0.985, contrast: 12, motion: 38, sharpness: 0.12, softSharpness: 0.3,  closerPx: 9,  furtherRel: 0.45, touchFrac: 0.7, lowConf: 40, persist: 6 },
  medium: { label: 'Medium', dark: 45, bright: 205, washedStd: 25, glare: 0.98,  contrast: 14, motion: 25, sharpness: 0.18, softSharpness: 0.33, closerPx: 12, furtherRel: 0.38, touchFrac: 0.6, lowConf: 50, persist: 4 },
  high:   { label: 'High',   dark: 55, bright: 200, washedStd: 28, glare: 0.97,  contrast: 16, motion: 14, sharpness: 0.32, softSharpness: 0.38, closerPx: 16, furtherRel: 0.3,  touchFrac: 0.4, lowConf: 60, persist: 1 },
};
export const DEFAULT_PRESET = 'medium';
export const THRESHOLDS = PRESETS[DEFAULT_PRESET];

const FRAME_ADVICE = {
  dark:   { ok: false, code: 'dark',   message: 'Too dark — add some light' },
  glare:  { ok: false, code: 'glare',  message: 'Too much glare — tilt the camera slightly' },
  empty:  { ok: false, code: 'empty',  message: 'Point the frame at the spec text' },
  motion: { ok: false, code: 'motion', message: 'Hold still…' },
  blur:   { ok: false, code: 'blur',   message: 'Too blurry — hold steady and let it focus' },
  ok:     { ok: true,  code: 'ok',     message: 'Looks good — reading…' },
};
export const frameAdviceFor = (code) => FRAME_ADVICE[code] ?? FRAME_ADVICE.ok;

/** Convert RGBA pixels to a Float32Array of luminance. */
export function toGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  return g;
}

/** Value at quantile q (0..1) of an array (sorts a copy). */
function quantile(arr, q) {
  if (!arr.length) return 0;
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

const BLOCK = 16; // motion is measured on 16×16 block averages so a few pixels of hand shake don't count

/**
 * Measure a grayscale frame. Pass the previous result as `prev` to get motion.
 * sharpness = strongest edges (99.5th-percentile |Laplacian|) ÷ contrast range (p99 − p1 luminance).
 * Using the strongest edges rather than the average makes it independent of how much of the
 * frame is covered by text — a little crisp text on a big blank sticker still counts as sharp.
 */
export function measure(gray, w, h, prev = null) {
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

  // Coarse frame for motion: block averages, compared after removing each frame's mean,
  // so auto-exposure drift and tiny hand tremor don't register as movement.
  const cw = Math.max(1, Math.floor(w / BLOCK)), chh = Math.max(1, Math.floor(h / BLOCK));
  const coarse = new Float32Array(cw * chh);
  for (let y = 0; y < chh * BLOCK; y++) {
    const row = (y / BLOCK | 0) * cw;
    for (let x = 0; x < cw * BLOCK; x++) coarse[row + (x / BLOCK | 0)] += gray[y * w + x] / (BLOCK * BLOCK);
  }
  let coarseMean = 0;
  for (let i = 0; i < coarse.length; i++) coarseMean += coarse[i];
  coarseMean /= coarse.length;

  let motion = 0;
  if (prev?.coarse && prev.coarse.length === coarse.length) {
    let d = 0;
    for (let i = 0; i < coarse.length; i++) d += Math.abs((coarse[i] - coarseMean) - (prev.coarse[i] - prev.coarseMean));
    motion = std > 1 ? (100 * d / coarse.length) / std : 0; // % of frame contrast
  }
  return { mean, std, glare: clipped / n, sharpness, motion, coarse, coarseMean };
}

/** Pre-OCR guidance from frame metrics. Returns { ok, code, message }. */
export function frameAdvice(m, t = THRESHOLDS) {
  if (m.mean < t.dark) return FRAME_ADVICE.dark;
  if (m.glare > t.glare || (m.mean > t.bright && m.std < t.washedStd)) return FRAME_ADVICE.glare;
  if (m.std < t.contrast) return FRAME_ADVICE.empty;
  if (m.motion > t.motion) return FRAME_ADVICE.motion;
  if (m.sharpness < t.sharpness) return FRAME_ADVICE.blur;
  return FRAME_ADVICE.ok;
}

/**
 * Post-OCR guidance from word boxes (Tesseract words with bbox {x0,y0,x1,y1}) inside a crop of cropW×cropH.
 * Returns { code, message } where code ∈ closer | further | none | lowconf | ok.
 */
export function textAdvice(words, cropW, cropH, t = THRESHOLDS) {
  const good = (words || []).filter((w) => w.confidence >= 45 && /[a-z0-9]{2,}/i.test(w.text));
  if (!good.length) return { code: 'none', message: 'Can’t read any text — move a little closer and hold steady' };

  const heights = good.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  const rel = median / cropH;
  const px = median * (1280 / cropW); // normalise to a ~1280px-wide crop

  const margin = cropW * 0.015;
  const touching = good.filter((w) => w.bbox.x0 <= margin || w.bbox.x1 >= cropW - margin).length;

  if (px < t.closerPx) return { code: 'closer', message: 'Move closer — the text is too small' };
  if (rel > t.furtherRel) return { code: 'further', message: 'Move back a little — too close' };
  if (touching >= Math.max(3, good.length * t.touchFrac)) return { code: 'further', message: 'Move back so the whole name fits in the frame' };

  const avgConf = good.reduce((s, w) => s + w.confidence, 0) / good.length;
  if (avgConf < t.lowConf) return { code: 'lowconf', message: 'Text is hard to read — hold steady or add light' };
  return { code: 'ok', message: 'Text found — looking for the processor…' };
}

/**
 * Debounces per-frame results: a code only becomes the shown state once it has
 * lasted `persist` consecutive frames, so one shaky or dim frame doesn't flash a warning.
 */
export class Stabilizer {
  constructor(persist = THRESHOLDS.persist) { this.persist = persist; this.stable = null; this.candidate = null; this.count = 0; }
  push(code) {
    if (code === this.candidate) this.count++;
    else { this.candidate = code; this.count = 1; }
    if (this.stable === null || this.count >= this.persist) this.stable = code;
    return this.stable;
  }
  reset() { this.stable = null; this.candidate = null; this.count = 0; }
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
