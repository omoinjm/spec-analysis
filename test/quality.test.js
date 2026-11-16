import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure, frameAdvice, textAdvice, BlurTracker, cameraAdvice } from '../public/src/quality.js';

const W = 320, H = 140;

/** Fake "text": rows of dark glyph-like blocks on a light background. */
function textFrame({ bg = 230, ink = 30, glyph = 6 } = {}) {
  const g = new Float32Array(W * H).fill(bg);
  for (let y = 0; y < H; y++) {
    const row = Math.floor(y / (glyph * 2));
    if (y % (glyph * 2) >= glyph) continue;
    for (let x = 0; x < W; x++) {
      if (((Math.floor(x / glyph) * 7 + row * 3) % 5) < 2) g[y * W + x] = ink;
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
  const a = frameAdvice(measure(textFrame(), W, H));
  assert.equal(a.code, 'ok');
});

test('blurred text is flagged as blurry', () => {
  // r=3 ≈ 0.10 sharpness — well under the 0.32 threshold while keeping enough contrast to not read as "empty".
  const a = frameAdvice(measure(boxBlur(textFrame(), 3), W, H));
  assert.equal(a.code, 'blur');
});

test('dark frame is flagged', () => {
  assert.equal(frameAdvice(measure(scale(textFrame(), 0.15), W, H)).code, 'dark');
});

test('washed-out frame is flagged as glare', () => {
  assert.equal(frameAdvice(measure(new Float32Array(W * H).fill(255), W, H)).code, 'glare');
});

test('white sticker / screen with black text is not glare', () => {
  const g = textFrame({ bg: 255, ink: 20 });
  assert.equal(frameAdvice(measure(g, W, H)).code, 'ok');
});

test('bright but low-contrast (washed-out text) is glare', () => {
  assert.equal(frameAdvice(measure(textFrame({ bg: 250, ink: 215 }), W, H)).code, 'glare');
});

test('flat frame (no text) asks to point at the text', () => {
  assert.equal(frameAdvice(measure(new Float32Array(W * H).fill(128), W, H)).code, 'empty');
});

test('camera movement is flagged', () => {
  const a = textFrame();
  const b = textFrame({ glyph: 7 });
  assert.equal(frameAdvice(measure(b, W, H, a)).code, 'motion');
  assert.equal(frameAdvice(measure(a, W, H, a)).code, 'ok');
});

const word = (text, x0, y0, x1, y1, confidence = 90) => ({ text, confidence, bbox: { x0, y0, x1, y1 } });

test('textAdvice: tiny text → move closer', () => {
  const words = [word('Intel', 400, 200, 440, 210), word('Core', 450, 200, 480, 210), word('i7-8550U', 490, 200, 560, 210)];
  assert.equal(textAdvice(words, 1280, 560).code, 'closer');
});

test('textAdvice: huge text / clipped at edges → move back', () => {
  assert.equal(textAdvice([word('i7-8550U', 100, 50, 1100, 300)], 1280, 560).code, 'further');
  const clipped = [word('Core', 0, 200, 200, 260), word('8550U', 1100, 200, 1280, 260), word('i7', 500, 200, 560, 260)];
  assert.equal(textAdvice(clipped, 1280, 560).code, 'further');
});

test('textAdvice: readable text → ok; nothing → none', () => {
  const words = [word('Intel', 300, 200, 420, 240), word('Core', 440, 200, 540, 240), word('i7-8550U', 560, 200, 760, 240)];
  assert.equal(textAdvice(words, 1280, 560).code, 'ok');
  assert.equal(textAdvice([], 1280, 560).code, 'none');
  assert.equal(textAdvice([word('~', 1, 1, 2, 2, 20)], 1280, 560).code, 'none');
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
