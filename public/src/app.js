import { findCpus, findExtras, compare, ramAdvice, CATEGORY_INFO, AGE_INFO } from './decoder.js';
import { recognise } from './ocr.js';
import { scan, cameraSupported } from './scanner.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// ---------------------------------------------------------------- tabs
function showTab(name) {
  document.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.tab').forEach((s) => (s.hidden = s.id !== `tab-${name}`));
  store.set('tab', name);
}
document.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
showTab(store.get('tab', 'scan'));

// ---------------------------------------------------------------- scan
const textArea = $('#spec-text');
const results = $('#results');
const progress = $('#ocr-progress');

async function handleImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const preview = $('#preview');
  URL.revokeObjectURL(preview.src);
  preview.src = URL.createObjectURL(file);
  $('#preview-wrap').hidden = false;
  progress.hidden = false;
  setProgress(null, 'Loading OCR engine…');
  results.replaceChildren();
  try {
    const text = await recognise(file, setProgress);
    textArea.value = text.trim();
    decode();
    if (!findCpus(text).length) {
      results.prepend(message('Couldn’t spot a processor name in the photo. Try a closer, sharper shot — or type it in the box above.'));
    }
  } catch (err) {
    results.replaceChildren(message(err.message || 'OCR failed. Type the processor name instead.'));
  } finally {
    progress.hidden = true;
  }
}

function setProgress(p, label) {
  const bar = progress.firstElementChild;
  bar.style.width = p == null ? '15%' : `${Math.round(p * 100)}%`;
  progress.classList.toggle('indeterminate', p == null);
  progress.querySelector('span').textContent = label;
}

['#in-camera', '#in-file'].forEach((id) => $(id).addEventListener('change', (e) => {
  handleImage(e.target.files[0]);
  e.target.value = '';
}));

// Live camera scanner (falls back to the native photo picker when getUserMedia isn't available).
$('#btn-scan').addEventListener('click', async () => {
  if (!cameraSupported() || !window.isSecureContext) { $('#in-camera').click(); return; }
  let result;
  try {
    result = await scan($('#scanner'));
  } catch (err) {
    const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
    toast(denied ? 'Camera permission denied — using the photo picker instead.' : 'Couldn’t open the camera — using the photo picker instead.');
    $('#in-camera').click();
    return;
  }
  if (!result) return;                       // user closed the scanner
  if (result.fallback) { $('#in-camera').click(); return; }
  $('#preview').src = result.snapshot;
  $('#preview-wrap').hidden = false;
  textArea.value = result.text.trim();
  decode();
  results.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#scanner').hidden) $('#scanner .scan-close').click();
});

document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) { e.preventDefault(); showTab('scan'); handleImage(item.getAsFile()); }
});
$('#btn-decode').addEventListener('click', decode);
textArea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) decode(); });
$('#btn-clear').addEventListener('click', () => {
  textArea.value = '';
  results.replaceChildren();
  $('#preview-wrap').hidden = true;
});

function message(text) {
  return el('p', 'card message', text);
}

function decode() {
  const text = textArea.value;
  results.replaceChildren();
  if (!text.trim()) return;
  const cpus = findCpus(text);
  const extras = findExtras(text);
  if (!cpus.length) {
    results.append(message('No processor name recognised. Examples: “i5-1235U”, “Core Ultra 7 155H”, “Ryzen 7 7840HS”, “Apple M2 Pro”.'));
  }
  cpus.forEach((c) => results.append(renderCpu(c, extras)));
  if (cpus.length) results.append(caveat());
}

function caveat() {
  return el('p', 'callout', '⚠️ The same chip in a very thin laptop can turn out slower — cooling makes all the difference. Numbers don’t lie: check a benchmark before you buy.');
}

const ROLE_LABEL = { tier: 'Tier', generation: 'Generation', rank: 'Rank', suffix: 'Letter' };
const USE_LABEL = { office: '📄 Work & school', gaming: '🎮 Gaming', video: '🎬 Video editing', battery: '🔋 Battery life' };
const USE_MARK = { great: '✓', ok: '~', poor: '✗' };

function renderCpu(c, extras = {}) {
  const node = $('#tpl-cpu').content.firstElementChild.cloneNode(true);
  const info = CATEGORY_INFO[c.category];
  node.dataset.category = c.category;

  const cat = $('.cat', node);
  cat.append(el('span', 'badge', `${info.emoji} ${info.label}`), el('p', 'blurb', info.blurb));
  $('.cpu-name', node).textContent = `${c.vendor} ${c.name}`.replace(/^(Apple|Intel|AMD) \1 /, '$1 ');

  const decoded = $('.decoded', node);
  c.parts.forEach((p, i) => {
    if (i > 0 && c.parts[i - 1].role === 'tier') decoded.append(el('span', 'sep', c.vendor === 'Intel' && c.family === 'Core i' ? '-' : ' '));
    decoded.append(el('span', `seg ${p.role}`, p.text));
  });

  const legend = $('.parts', node);
  const rows = [
    ['tier', c.tierLabel, tierText(c)],
    ['generation', c.generationLabel, genText(c)],
    ['rank', c.rank, c.rank ? 'Position inside its tier & generation — bigger number, stronger chip.' : null],
    ['suffix', c.suffix || '(none)', c.suffixInfo?.meaning],
  ];
  rows.forEach(([role, val, txt]) => {
    if (!txt || val == null) return;
    const d = el('div');
    const dt = el('dt', role, `${ROLE_LABEL[role]}: ${val}`);
    d.append(dt, el('dd', null, txt));
    legend.append(d);
  });

  const age = AGE_INFO[c.ageBand];
  const ageEl = $('.age', node);
  ageEl.className = `age age-${c.ageBand}`;
  ageEl.append(el('strong', null, `${age.label}${c.year ? ` · ${c.year}` : ''}`), document.createTextNode(` — ${age.advice}`));

  const scores = $('.scores', node);
  scores.append(
    scoreBar('Single-core (gaming)', c.singleScore),
    scoreBar('Multi-core (video editing)', c.multiScore),
  );

  const uses = $('.uses', node);
  Object.entries(c.uses).forEach(([k, v]) => {
    const li = el('li', `use ${v}`);
    li.append(el('span', 'mark', USE_MARK[v]), el('span', null, USE_LABEL[k]));
    uses.append(li);
  });

  const notes = $('.notes', node);
  const allNotes = [...c.notes];
  if (c.noIgpu) allNotes.push('No built-in graphics — this PC must have a separate graphics card.');
  const ram = ramAdvice(extras.ramGB);
  if (ram) allNotes.push(ram.text);
  if (extras.gpu) allNotes.push(`Graphics card spotted: ${extras.gpu} — good news for gaming.`);
  if (extras.storage) allNotes.push(`Storage: ${extras.storage}${/HDD|EMMC/.test(extras.storage) ? ' (slow — prefer an SSD)' : ''}.`);
  allNotes.forEach((n) => notes.append(el('li', null, n)));
  if (!allNotes.length) notes.remove();

  const bench = $('.bench', node);
  bench.href = `https://www.google.com/search?q=${encodeURIComponent(c.benchmarkQuery)}`;
  $('.add-a', node).addEventListener('click', () => setSlot('a', c.raw));
  $('.add-b', node).addEventListener('click', () => setSlot('b', c.raw));
  return node;
}

function tierText(c) {
  if (c.family === 'Entry') return 'Budget class — below i3 / Ryzen 3.';
  if (c.vendor === 'Apple') return 'Base → Pro → Max → Ultra: more cores and graphics at each step.';
  if (c.vendor === 'Qualcomm') return 'Plus → Elite: Elite has more cores.';
  return 'Like plane classes: 3 economy · 5 premium economy · 7 business · 9 first. Meaningless without the generation!';
}
function genText(c) {
  if (c.generation == null) return null;
  return 'Often the most important number: a newer generation usually beats an older higher tier.';
}

function scoreBar(label, value) {
  const wrap = el('div', 'score');
  const head = el('div', 'score-head');
  head.append(el('span', null, label), el('strong', null, String(value)));
  const track = el('div', 'track');
  const fill = el('div', 'fill');
  fill.style.width = `${Math.min(100, value / 1.6)}%`;
  track.append(fill);
  wrap.append(head, track);
  return wrap;
}

// ---------------------------------------------------------------- compare
const cmpA = $('#cmp-a');
const cmpB = $('#cmp-b');
cmpA.value = store.get('cmpA', '');
cmpB.value = store.get('cmpB', '');
updateCount();

function setSlot(slot, value) {
  (slot === 'a' ? cmpA : cmpB).value = value;
  store.set(slot === 'a' ? 'cmpA' : 'cmpB', value);
  updateCount();
  if (cmpA.value && cmpB.value) { showTab('compare'); runCompare(); }
  else toast(`Set as ${slot.toUpperCase()}. Now pick the other computer.`);
}
function updateCount() {
  const n = [cmpA.value, cmpB.value].filter(Boolean).length;
  const pill = $('#cmp-count');
  pill.hidden = n === 0;
  pill.textContent = n;
}
[cmpA, cmpB].forEach((input) => input.addEventListener('input', () => {
  store.set(input === cmpA ? 'cmpA' : 'cmpB', input.value);
  updateCount();
}));
[cmpA, cmpB].forEach((input) => input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runCompare(); }));
$('#btn-compare').addEventListener('click', runCompare);
$('#btn-cmp-demo').addEventListener('click', () => {
  cmpA.value = 'Core i7-8550U';
  cmpB.value = 'Core i5-13500H';
  store.set('cmpA', cmpA.value);
  store.set('cmpB', cmpB.value);
  updateCount();
  runCompare();
});

function runCompare() {
  const out = $('#cmp-result');
  out.replaceChildren();
  const a = findCpus(cmpA.value)[0];
  const b = findCpus(cmpB.value)[0];
  if (!a || !b) {
    out.append(message(`Couldn’t recognise ${!a ? 'Computer A' : 'Computer B'}. Try a full name like “i5-1235U”.`));
    return;
  }
  const v = compare(a, b);
  const card = el('article', 'card verdict');
  const grid = el('div', 'vs');
  [['A', a, v.winnerMulti === 'a'], ['B', b, v.winnerMulti === 'b']].forEach(([label, c, wins]) => {
    const col = el('div', `vs-col${wins ? ' winner' : ''}`);
    const info = CATEGORY_INFO[c.category];
    col.append(
      el('div', 'small muted', `Computer ${label}${wins ? ' · 🏆' : ''}`),
      el('h3', null, c.name),
      el('span', 'badge', `${info.emoji} ${info.label}`),
      el('div', 'small', `${c.tierLabel} · ${c.generationLabel}${c.suffix ? ` · ${c.suffix}` : ''}`),
      scoreBar('Single-core', c.singleScore),
      scoreBar('Multi-core', c.multiScore),
    );
    grid.append(col);
  });
  const list = el('ul', 'verdict-lines');
  v.lines.forEach((l) => list.append(el('li', null, l)));
  const bench = el('a', 'btn ghost', '🔎 Search real benchmarks');
  bench.href = `https://www.google.com/search?q=${encodeURIComponent(`${a.name} vs ${b.name} benchmark`)}`;
  bench.target = '_blank';
  bench.rel = 'noopener';
  card.append(grid, list, bench);
  out.append(card, caveat());
}

// ---------------------------------------------------------------- toast
let toastTimer;
function toast(text) {
  let t = $('.toast');
  if (!t) { t = el('div', 'toast'); document.body.append(t); }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2500);
}

// ---------------------------------------------------------------- share target / deep link (?text=...)
{
  const params = new URLSearchParams(location.search);
  const shared = [params.get('title'), params.get('text')].filter(Boolean).join('\n');
  if (shared) {
    showTab('scan');
    textArea.value = shared;
    decode();
    history.replaceState(null, '', location.pathname);
  }
}

// ---------------------------------------------------------------- PWA
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
