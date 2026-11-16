// Live camera scanner: guides the user (closer / further / blurry / dark), OCRs the framed area,
// and resolves once a processor name is confidently recognised.
import { findCpus } from './decoder.js';
import { enhance, recogniseCanvas, warmUp, isReady } from './ocr.js';
import {
  toGray, measure, frameAdvice, frameAdviceFor, textAdvice, BlurTracker, Stabilizer, cameraAdvice, PRESETS, DEFAULT_PRESET,
} from './quality.js';

const ANALYSE_MAX_W = 640;  // quality checks run near native resolution (downscaling hides small text)
const OCR_MAX_W = 1400;     // cap OCR crop width for speed
const ANALYSE_EVERY = 160;  // ms between quality checks
const STEADY_FOR = 250;     // ms of (debounced) good frames before running OCR
const SENS_KEY = 'scanSensitivity';

function loadPreset() {
  try { const v = localStorage.getItem(SENS_KEY); return PRESETS[v] ? v : DEFAULT_PRESET; } catch { return DEFAULT_PRESET; }
}
function savePreset(v) {
  try { localStorage.setItem(SENS_KEY, v); } catch { /* storage unavailable */ }
}
const GIVE_UP_HINT = 25000; // ms before offering the photo/typing fallback
const BLUR_RETRY = 3000;    // while steady-but-blurry, still try a read this often
const READ_BACKOFF = 300;   // extra wait per consecutive read that found no processor…
const READ_BACKOFF_MAX = 2000; // …capped, so a stuck scan doesn't burn battery re-reading non-stop

export function cameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

/**
 * Open the scanner overlay. Resolves with { text, cpu, snapshot } on success,
 * or null if the user closed it. Rejects if the camera can't be opened.
 */
export async function scan(root) {
  const video = root.querySelector('video');
  const frame = root.querySelector('.scan-frame');
  const hint = root.querySelector('.scan-hint');
  const note = root.querySelector('.scan-note');
  const loader = root.querySelector('.scan-loader');
  const loaderText = loader.querySelector('span');
  const loaderBar = loader.querySelector('.bar > div');
  const torchBtn = root.querySelector('.scan-torch');
  const closeBtn = root.querySelector('.scan-close');
  const fallbackBtn = root.querySelector('.scan-fallback');
  const sensButtons = [...root.querySelectorAll('.scan-sens [data-sens]')];
  const checks = {
    light: root.querySelector('[data-check=light]'),
    focus: root.querySelector('[data-check=focus]'),
    distance: root.querySelector('[data-check=distance]'),
  };

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
  const track = stream.getVideoTracks()[0];
  try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* not supported */ }

  root.hidden = false;
  document.body.classList.add('scanning');
  video.srcObject = stream;
  await video.play().catch(() => {});
  await new Promise((r) => (video.videoWidth ? r() : video.addEventListener('loadedmetadata', r, { once: true })));

  const { width: camW, height: camH } = track.getSettings?.() ?? {};
  const camNote = cameraAdvice(camW || video.videoWidth, camH || video.videoHeight);
  note.textContent = camNote ?? '';
  note.hidden = !camNote;

  // Torch (flash) where supported.
  let torchOn = false;
  const caps = track.getCapabilities?.() ?? {};
  torchBtn.hidden = !caps.torch;
  torchBtn.onclick = async () => {
    torchOn = !torchOn;
    try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch { torchOn = false; }
    torchBtn.classList.toggle('on', torchOn);
  };

  warmUp().catch(() => {}); // load OCR engine while the user aims

  const small = document.createElement('canvas');
  const smallCtx = small.getContext('2d', { willReadFrequently: true });
  const blur = new BlurTracker();
  let presetKey = loadPreset();
  let t = PRESETS[presetKey];
  const stabilizer = new Stabilizer(t.persist);
  const showPreset = () => sensButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sens === presetKey)));
  showPreset();
  sensButtons.forEach((b) => {
    b.onclick = () => {
      presetKey = b.dataset.sens;
      t = PRESETS[presetKey];
      savePreset(presetKey);
      stabilizer.persist = t.persist;
      stabilizer.reset();
      blur.reset();
      lastTextAdvice = null;
      blurFails = 0;
      ocrSaysBlur = false;
      showPreset();
    };
  });
  let prevMetrics = null;
  let goodSince = 0;
  let reading = false;
  let lastReadAt = 0;
  let lastFrameCode = 'ok';
  let lastCandidate = null;
  let lastTextAdvice = null;
  let lastSharpness = 1;
  let blurFails = 0;      // consecutive reads that failed on a soft frame
  let ocrSaysBlur = false;
  let readFailures = 0;   // consecutive reads without a processor name
  let nextReadAt = 0;
  let done = false;
  let timer;
  const started = performance.now();

  const setHint = (message, tone = 'warn') => {
    hint.textContent = message;
    hint.dataset.tone = tone;
  };
  const setCheck = (name, state) => { checks[name].dataset.state = state; };
  setHint('Point the frame at the processor name', 'info');

  /** Region of the video (in video pixels) that sits under the on-screen guide frame. */
  function cropRect() {
    const vr = video.getBoundingClientRect();
    const fr = frame.getBoundingClientRect();
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.max(vr.width / vw, vr.height / vh); // object-fit: cover
    const ox = (vr.width - vw * scale) / 2, oy = (vr.height - vh * scale) / 2;
    const x = Math.max(0, (fr.left - vr.left - ox) / scale);
    const y = Math.max(0, (fr.top - vr.top - oy) / scale);
    const w = Math.min(vw - x, fr.width / scale);
    const h = Math.min(vh - y, fr.height / scale);
    return { x, y, w, h };
  }

  function snapshot(maxW) {
    const r = cropRect();
    const s = Math.min(1, maxW / r.w);
    const c = document.createElement('canvas');
    c.width = Math.round(r.w * s);
    c.height = Math.round(r.h * s);
    c.getContext('2d').drawImage(video, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    return c;
  }

  return new Promise((resolve) => {
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      root.hidden = true;
      root.classList.remove('found');
      loader.hidden = true;
      document.body.classList.remove('scanning');
      closeBtn.onclick = fallbackBtn.onclick = torchBtn.onclick = null;
      sensButtons.forEach((b) => { b.onclick = null; });
      resolve(result);
    };
    closeBtn.onclick = () => finish(null);
    fallbackBtn.onclick = () => finish({ fallback: true });

    async function readText() {
      reading = true;
      lastReadAt = performance.now();
      const frameCode = lastFrameCode;
      const sharpAtRead = lastSharpness;
      const keepDistanceHint = lastTextAdvice && ['closer', 'further', 'none'].includes(lastTextAdvice.code);
      if (!isReady()) setHint('Getting the text reader ready — first scan only, needs internet', 'info');
      else if (!lastCandidate && !keepDistanceHint) setHint('Reading… keep steady', 'info');
      loader.hidden = false;
      loaderText.textContent = isReady() ? 'Scanning…' : 'Loading text reader…';
      loaderBar.style.width = '5%';
      const crop = snapshot(OCR_MAX_W);
      const plain = document.createElement('canvas');
      plain.width = crop.width; plain.height = crop.height;
      plain.getContext('2d').drawImage(crop, 0, 0);
      try {
        const data = await recogniseCanvas(enhance(crop), (p, label, status) => {
          if (done) return;
          loaderText.textContent = p == null ? label : `${label} ${Math.round(p * 100)}%`;
          loaderBar.style.width = p == null ? '5%' : `${Math.max(5, Math.round(p * 100))}%`;
          if (status === 'recognizing text' && hint.textContent.startsWith('Getting the text reader')) setHint('Reading… keep steady', 'info');
        });
        if (done) return;
        const cpus = findCpus(data.text);
        const adv = textAdvice(data.words, crop.width, crop.height, t);
        lastTextAdvice = adv;
        // Only blame blur when the frame is soft AND the text couldn't be read — readable text is never nagged.
        const unreadable = adv.code === 'none' || adv.code === 'lowconf';
        const softBlur = !cpus.length && unreadable && (frameCode === 'blur' || sharpAtRead < t.softSharpness);
        ocrSaysBlur = softBlur;
        blurFails = softBlur ? blurFails + 1 : unreadable ? blurFails : 0;
        const distanceBad = adv.code === 'closer' || adv.code === 'further' || (adv.code === 'none' && !softBlur);
        setCheck('distance', distanceBad ? 'bad' : softBlur ? 'idle' : 'good');
        if (softBlur) setCheck('focus', 'bad');

        if (cpus.length) {
          const cpu = cpus[0];
          // Accept on a confident read, or when two reads in a row agree.
          const confident = data.confidence >= 75;
          if (confident || lastCandidate === cpu.name) {
            loaderText.textContent = 'Decoding…';
            loaderBar.style.width = '100%';
            root.classList.add('found');
            setHint(`✓ Found ${cpu.name}`, 'good');
            setTimeout(() => finish({ text: data.text, cpu, snapshot: plain.toDataURL('image/jpeg', 0.85) }), 700);
            return;
          }
          lastCandidate = cpu.name;
          readFailures = 0; // confirm quickly
          setHint(`Found ${cpu.name}? Hold still to confirm…`, 'info');
        } else {
          lastCandidate = null;
          readFailures++;
          if (softBlur) {
            const stuck = blur.persistent || blurFails >= 4;
            setHint(stuck ? 'Still blurry — wipe the lens, move back a little, or use a better camera' : 'Too blurry — hold steady and let it focus', stuck ? 'bad' : 'warn');
            return;
          }
          setHint(adv.code === 'ok' ? 'No processor name here — aim at the “Processor” / CPU line' : adv.message, adv.code === 'ok' ? 'info' : 'warn');
        }
      } catch (err) {
        setHint(err.message || 'Could not read text', 'warn');
      } finally {
        reading = false;
        goodSince = 0;
        nextReadAt = performance.now() + Math.min(READ_BACKOFF_MAX, READ_BACKOFF * readFailures);
        if (!done) loader.hidden = true;
      }
    }

    function tick() {
      if (done) return;
      timer = setTimeout(tick, ANALYSE_EVERY);
      if (reading || !video.videoWidth) return;

      const r = cropRect();
      const aw = Math.round(Math.min(r.w, ANALYSE_MAX_W));
      small.width = aw;
      small.height = Math.max(1, Math.round((r.h / r.w) * aw));
      smallCtx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, small.width, small.height);
      const gray = toGray(smallCtx.getImageData(0, 0, small.width, small.height).data, small.width, small.height);
      const m = measure(gray, small.width, small.height, prevMetrics);
      prevMetrics = m;
      const raw = frameAdvice(m, t);
      blur.push(raw.code);
      // Only react to problems that last a few frames — one shaky or dim frame shouldn't flash a warning.
      const adv = frameAdviceFor(stabilizer.push(raw.code));
      lastFrameCode = adv.code;
      lastSharpness = m.sharpness;
      const { coarse, coarseMean, ...shown } = m;
      root.dataset.metrics = JSON.stringify({ ...shown, w: small.width, raw: raw.code, code: adv.code, preset: presetKey });

      setCheck('light', adv.code === 'dark' || adv.code === 'glare' ? 'bad' : 'good');
      setCheck('focus', adv.code === 'blur' || adv.code === 'motion' || ocrSaysBlur ? 'bad' : adv.code === 'empty' ? 'idle' : 'good');

      const now = performance.now();
      if (!adv.ok) {
        goodSince = 0;
        // Never let the blur heuristic block scanning entirely: a steady frame still gets read now and then.
        if (adv.code === 'blur' && m.motion <= t.motion / 2 && now - lastReadAt > BLUR_RETRY && now >= nextReadAt) { readText(); return; }
        if (lastTextAdvice && (lastTextAdvice.code === 'closer' || lastTextAdvice.code === 'further') && adv.code === 'blur') {
          setHint(lastTextAdvice.message, 'warn');
        } else if (adv.code === 'blur' && blur.persistent) {
          setHint('Still blurry — wipe the lens, move back a little, or use a better camera', 'bad');
        } else if (adv.code === 'dark' && caps.torch && !torchOn) {
          setHint('Too dark — tap 🔦 or add light', 'warn');
        } else {
          setHint(adv.message, 'warn');
        }
      } else {
        if (!goodSince) goodSince = now;
        if (now - goodSince >= STEADY_FOR && now >= nextReadAt) readText();
        else if (!lastCandidate && (!lastTextAdvice || lastTextAdvice.code === 'ok')) setHint('Looks good — keep it there', 'info');
      }

      if (performance.now() - started > GIVE_UP_HINT) fallbackBtn.hidden = false;
    }
    fallbackBtn.hidden = true;
    tick();
  });
}
