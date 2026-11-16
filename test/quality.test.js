import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  measure, frameAdvice, textAdvice, BlurTracker, Stabilizer, cameraAdvice, PRESETS, THRESHOLDS,
} from '../public/src/quality.js';

const W = 320, H = 140;

/** Fake "text": rows of dark glyph-like blocks on a light background. */
function textFrame({ bg = 230, ink = 30, glyph = 6, w = W, h = H, dx = 0, dy = 0 } = {}) {
  const g = new Float32Array(w * h).fill(bg);
  const period = glyph * 2;
  for (let y = 0; y < h; y++) {
    const yy = y - dy;
    if ((((yy % period) + period) % period) >= glyph) continue;
    const row = Math.floor(yy / period);
    for (let x = 0; x < w; x++) {
      const col = Math.floor((x - dx) / (glyph * 0.6));
      if ((((col * 7 + row * 3) % 5) + 5) % 5 < 2) g[y * w + x] = ink;
    }
  }
  return g;
}
function boxBlur(src, r) {
  let g = src;
  for (let pass = 0; pass < 3; pass++) {
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, n = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const yy = Math.min(H - 1, Math.max(0, y + dy)), xx = Math.min(W - 1, Math.max(0, x + dx));
        s += g[yy * W + xx]; n++;
      }
      out[y * W + x] = s / n;
    }
    g = out;
  }
  return g;
}
const scale = (g, f, add = 0) => g.map((v) => Math.min(255, v * f + add));

test('sharp, well-lit text frame is ok', () => {
  assert.equal(frameAdvice(measure(textFrame(), W, H)).code, 'ok');
});

test('blurred text is flagged as blurry', () => {
  const m = measure(boxBlur(textFrame({ glyph: 10 }), 3), W, H); // sharpness ≈ 0.09
  assert.ok(m.sharpness < PRESETS.low.sharpness, `sharpness ${m.sharpness}`);
  assert.equal(frameAdvice(m).code, 'blur');
});

test('mild softness passes on medium but is flagged on high', () => {
  const m = measure(boxBlur(textFrame({ glyph: 10 }), 1), W, H); // sharpness ≈ 0.21
  assert.equal(frameAdvice(m, PRESETS.medium).code, 'ok', `sharpness ${m.sharpness}`);
  assert.equal(frameAdvice(m, PRESETS.high).code, 'blur');
});

test('dark frame is flagged; dim room is fine on medium', () => {
  assert.equal(frameAdvice(measure(scale(textFrame(), 0.15), W, H)).code, 'dark');
  // mean ≈ 47: dim but readable
  const dim = measure(scale(textFrame(), 0.25), W, H);
  assert.equal(frameAdvice(dim, PRESETS.medium).code, 'ok', `mean ${dim.mean}`);
  assert.equal(frameAdvice(dim, PRESETS.high).code, 'dark');
});

test('washed-out frame is flagged as glare', () => {
  assert.equal(frameAdvice(measure(new Float32Array(W * H).fill(255), W, H)).code, 'glare');
  assert.equal(frameAdvice(measure(textFrame({ bg: 250, ink: 230 }), W, H)).code, 'glare');
});

test('white sticker / screen with black text is not glare', () => {
  assert.equal(frameAdvice(measure(textFrame({ bg: 255, ink: 20 }), W, H)).code, 'ok');
});

test('flat frame (no text) asks to point at the text', () => {
  assert.equal(frameAdvice(measure(new Float32Array(W * H).fill(128), W, H)).code, 'empty');
});

test('hand tremor is tolerated; moving the camera is flagged', () => {
  const w = 640, h = 280;
  const base = measure(textFrame({ glyph: 12, w, h }), w, h);
  const motionFor = (dx, dy) => measure(textFrame({ glyph: 12, w, h, dx, dy }), w, h, base).motion;
  for (const [dx, dy] of [[1, 0], [2, 1], [3, 2]]) {
    const m = { ...base, motion: motionFor(dx, dy) };
    assert.equal(frameAdvice(m, PRESETS.medium).code, 'ok', `tremor ${dx},${dy} → motion ${m.motion}`);
  }
  const moving = { ...base, motion: motionFor(20, 10) };
  assert.equal(frameAdvice(moving, PRESETS.medium).code, 'motion', `motion ${moving.motion}`);
});

test('auto-exposure changes are not motion', () => {
  const a = measure(textFrame(), W, H);
  const b = measure(scale(textFrame(), 1.08), W, H, a);
  assert.ok(b.motion < 1, `motion ${b.motion}`);
});

const word = (text, x0, y0, x1, y1, confidence = 90) => ({ text, confidence, bbox: { x0, y0, x1, y1 } });

test('textAdvice: tiny text → move closer', () => {
  const words = [word('Intel', 400, 200, 440, 208), word('Core', 450, 200, 480, 208), word('i7-8550U', 490, 200, 560, 208)];
  assert.equal(textAdvice(words, 1280, 560).code, 'closer');
});

test('textAdvice: small-but-readable text is fine on medium, "closer" on high', () => {
  const words = [word('Intel', 400, 200, 460, 214), word('Core', 470, 200, 520, 214), word('i7-8550U', 530, 200, 640, 214)];
  assert.equal(textAdvice(words, 1280, 560, PRESETS.medium).code, 'ok');
  assert.equal(textAdvice(words, 1280, 560, PRESETS.high).code, 'closer');
});

test('textAdvice: huge text / clipped at edges → move back', () => {
  assert.equal(textAdvice([word('i7-8550U', 100, 50, 1100, 300)], 1280, 560).code, 'further');
  const clipped = [word('Core', 0, 200, 200, 260), word('8550U', 1100, 200, 1280, 260), word('i7', 500, 200, 560, 260), word('CPU', 1200, 300, 1280, 360)];
  assert.equal(textAdvice(clipped, 1280, 560).code, 'further');
});

test('textAdvice: one long line running off the edge is not nagged on medium', () => {
  // e.g. "Processor 11th Gen Intel(R) Core(TM) i7-1165G7 @ 2.80GHz" wider than the frame
  const line = [word('Processor', 0, 250, 150, 280), word('11th', 170, 250, 230, 280), word('Gen', 250, 250, 300, 280),
    word('Intel', 320, 250, 400, 280), word('Core', 420, 250, 500, 280), word('i7-1165G7', 520, 250, 700, 280), word('2.80GHz', 1150, 250, 1280, 280)];
  assert.equal(textAdvice(line, 1280, 560, PRESETS.medium).code, 'ok');
});

test('textAdvice: readable text → ok; nothing → none', () => {
  const words = [word('Intel', 300, 200, 420, 240), word('Core', 440, 200, 540, 240), word('i7-8550U', 560, 200, 760, 240)];
  assert.equal(textAdvice(words, 1280, 560).code, 'ok');
  assert.equal(textAdvice([], 1280, 560).code, 'none');
  assert.equal(textAdvice([word('~', 1, 1, 2, 2, 20)], 1280, 560).code, 'none');
});

test('Stabilizer ignores one-off bad frames and switches on persistent ones', () => {
  const s = new Stabilizer(4);
  assert.equal(s.push('ok'), 'ok');
  assert.equal(s.push('motion'), 'ok');
  assert.equal(s.push('ok'), 'ok');
  assert.equal(s.push('blur'), 'ok');
  assert.equal(s.push('blur'), 'ok');
  assert.equal(s.push('blur'), 'ok');
  assert.equal(s.push('blur'), 'blur');
  assert.equal(s.push('ok'), 'blur');
  const strict = new Stabilizer(1);
  strict.push('ok');
  assert.equal(strict.push('motion'), 'motion');
});

test('presets are ordered from forgiving to strict', () => {
  const { low, medium, high } = PRESETS;
  assert.equal(THRESHOLDS, medium);
  assert.ok(low.dark < medium.dark && medium.dark < high.dark);
  assert.ok(low.motion > medium.motion && medium.motion > high.motion);
  assert.ok(low.sharpness < medium.sharpness && medium.sharpness < high.sharpness);
  assert.ok(low.closerPx < medium.closerPx && medium.closerPx < high.closerPx);
  assert.ok(low.persist > medium.persist && medium.persist > high.persist);
});

test('BlurTracker flags persistent blur only when steady', () => {
  const t = new BlurTracker(10);
  for (let i = 0; i < 10; i++) t.push('motion');
  assert.equal(t.persistent, false);
  for (let i = 0; i < 10; i++) t.push('blur');
  assert.equal(t.persistent, true);
  t.push('ok'); t.push('ok');
  assert.equal(t.persistent, false);
});

test('cameraAdvice warns on low-res cameras', () => {
  assert.match(cameraAdvice(640, 480), /better camera/);
  assert.equal(cameraAdvice(1920, 1080), null);
});
