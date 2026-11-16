// On-device OCR via Tesseract.js (loaded lazily; cached by the service worker for offline use).
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let workerPromise = null;
let progressCb = () => {};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the OCR engine. Check your connection (needed once).'));
    document.head.appendChild(s);
  });
}

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(TESSERACT_URL);
      return window.Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') progressCb(m.progress, 'Reading text…');
          else if (m.status) progressCb(null, m.status.replace(/^\w/, (c) => c.toUpperCase()) + '…');
        },
      });
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

/** Start loading the engine early (e.g. when the camera opens) so the first read is fast. */
export function warmUp() {
  return getWorker();
}

/** Grayscale + stretch contrast in place: helps OCR on photos of stickers and screens. */
export function enhance(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = g;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const v = ((d[i] - min) / range) * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Upscale small images / downscale huge ones, then enhance. */
async function fileToCanvas(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(file));
  const longest = Math.max(bmp.width, bmp.height);
  const scale = longest < 1600 ? 1600 / longest : longest > 3000 ? 3000 / longest : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return enhance(canvas);
}

/** OCR a canvas. Returns Tesseract's data: { text, confidence, words: [{ text, confidence, bbox }] }. */
export async function recogniseCanvas(canvas, onProgress = () => {}) {
  const worker = await getWorker();
  progressCb = onProgress;
  const { data } = await worker.recognize(canvas);
  return data;
}

export async function recognise(file, onProgress = () => {}) {
  progressCb = onProgress;
  onProgress(null, 'Loading OCR engine…');
  const [, canvas] = await Promise.all([getWorker(), fileToCanvas(file)]);
  return (await recogniseCanvas(canvas, onProgress)).text;
}
