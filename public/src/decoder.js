// CPU name decoder — implements the rules from the "how to read a processor name" video:
//   tier (i3/i5/i7/i9) · generation (often the most important number) · rank (SKU) · suffix letter
//   U = battery saver, H = high performance, HX = monster, K = overclockable (desktop), F = no iGPU
// Plus Core Ultra, AMD Ryzen and Apple M-series, which follow the same idea.
//
// Pure module: no DOM, so it can be unit-tested in Node.

/** Category ids used for the headline verdict. */
export const CATEGORY = {
  BATTERY: 'battery',      // work & school
  BALANCED: 'balanced',    // P-series / mid-power
  PERFORMANCE: 'performance', // H / HS — gaming & creation on a laptop
  MONSTER: 'monster',      // HX / desktop i9 / Ultra chips — heavy workloads
  DESKTOP: 'desktop',      // regular desktop
  ENTRY: 'entry',          // Celeron / Pentium / N-series / Athlon
};

export const CATEGORY_INFO = {
  battery: { label: 'Work & school', emoji: '🔋', blurb: 'Built to save battery. Great for documents, browsing, calls and study — not for big games or heavy video editing.' },
  balanced: { label: 'Balanced', emoji: '⚖️', blurb: 'Between battery-saver and high-performance. Fine for multitasking and light creative work; casual gaming at best.' },
  performance: { label: 'High performance', emoji: '🚀', blurb: 'Built for gaming, coding and video editing. Uses more power and needs good cooling.' },
  monster: { label: 'Monster', emoji: '🦖', blurb: 'Top-end performance for heavy gaming, 3D, big video projects. Usually in thick laptops or desktops with serious cooling.' },
  desktop: { label: 'Desktop', emoji: '🖥️', blurb: 'Desktop chip with plenty of power headroom. Good all-rounder for gaming and creation (pair with a graphics card).' },
  entry: { label: 'Entry level', emoji: '🐢', blurb: 'Basic tasks only: browsing, email, documents. Expect slowdowns with heavy multitasking.' },
};

// ---------------------------------------------------------------------------
// Suffix knowledge
// ---------------------------------------------------------------------------

const INTEL_SUFFIX = {
  U:  { meaning: 'Ultra-low power — saves battery', category: CATEGORY.BATTERY, multi: 0.4, single: 0.85, platform: 'laptop' },
  Y:  { meaning: 'Extremely low power (fanless tablets/2-in-1s)', category: CATEGORY.BATTERY, multi: 0.28, single: 0.7, platform: 'laptop' },
  G:  { meaning: 'Low power with better built-in graphics (G1–G7: higher = stronger iGPU)', category: CATEGORY.BATTERY, multi: 0.45, single: 0.88, platform: 'laptop' },
  P:  { meaning: 'Performance-thin — between U and H', category: CATEGORY.BALANCED, multi: 0.62, single: 0.93, platform: 'laptop' },
  V:  { meaning: 'Low-power efficiency chip with memory on package (Lunar Lake)', category: CATEGORY.BALANCED, multi: 0.55, single: 0.97, platform: 'laptop' },
  H:  { meaning: 'High performance', category: CATEGORY.PERFORMANCE, multi: 1.0, single: 1.0, platform: 'laptop' },
  HQ: { meaning: 'High performance, quad-core (older naming)', category: CATEGORY.PERFORMANCE, multi: 1.0, single: 1.0, platform: 'laptop' },
  HK: { meaning: 'High performance, unlocked for overclocking', category: CATEGORY.PERFORMANCE, multi: 1.03, single: 1.02, platform: 'laptop' },
  HS: { meaning: 'High performance in a slimmer design', category: CATEGORY.PERFORMANCE, multi: 0.92, single: 0.98, platform: 'laptop' },
  HX: { meaning: 'Monster — desktop-class power in a laptop', category: CATEGORY.MONSTER, multi: 1.45, single: 1.05, platform: 'laptop' },
  M:  { meaning: 'Mobile (older naming)', category: CATEGORY.BALANCED, multi: 0.7, single: 0.9, platform: 'laptop' },
  MQ: { meaning: 'Mobile quad-core (older naming)', category: CATEGORY.PERFORMANCE, multi: 0.9, single: 0.95, platform: 'laptop' },
  QM: { meaning: 'Mobile quad-core (older naming)', category: CATEGORY.PERFORMANCE, multi: 0.9, single: 0.95, platform: 'laptop' },
  K:  { meaning: 'Desktop, unlocked — you can overclock it (push its speed up)', category: CATEGORY.DESKTOP, multi: 1.6, single: 1.1, platform: 'desktop' },
  KF: { meaning: 'Desktop, unlocked for overclocking, and no built-in graphics (needs a graphics card)', category: CATEGORY.DESKTOP, multi: 1.6, single: 1.1, platform: 'desktop', noIgpu: true },
  KS: { meaning: 'Desktop, special-edition binned & unlocked', category: CATEGORY.DESKTOP, multi: 1.65, single: 1.13, platform: 'desktop' },
  F:  { meaning: 'Desktop with no built-in graphics — needs a graphics card', category: CATEGORY.DESKTOP, multi: 1.35, single: 1.05, platform: 'desktop', noIgpu: true },
  T:  { meaning: 'Desktop, power-optimised (small/office PCs)', category: CATEGORY.DESKTOP, multi: 0.95, single: 0.95, platform: 'desktop' },
  S:  { meaning: 'Desktop, lower power', category: CATEGORY.DESKTOP, multi: 1.2, single: 1.0, platform: 'desktop' },
  '': { meaning: 'Desktop, standard (no letter)', category: CATEGORY.DESKTOP, multi: 1.35, single: 1.05, platform: 'desktop' },
};

const AMD_SUFFIX = {
  U:   { meaning: 'Low power — saves battery', category: CATEGORY.BATTERY, multi: 0.5, single: 0.88, platform: 'laptop' },
  H:   { meaning: 'High performance', category: CATEGORY.PERFORMANCE, multi: 1.0, single: 1.0, platform: 'laptop' },
  HS:  { meaning: 'High performance in a slimmer design', category: CATEGORY.PERFORMANCE, multi: 0.95, single: 0.99, platform: 'laptop' },
  HX:  { meaning: 'Monster — desktop-class power in a laptop', category: CATEGORY.MONSTER, multi: 1.5, single: 1.05, platform: 'laptop' },
  X:   { meaning: 'Desktop, higher clocks', category: CATEGORY.DESKTOP, multi: 1.45, single: 1.08, platform: 'desktop' },
  X3D: { meaning: 'Desktop with extra 3D V-Cache — a gaming favourite', category: CATEGORY.DESKTOP, multi: 1.4, single: 1.15, platform: 'desktop' },
  XT:  { meaning: 'Desktop, slightly faster refresh of the X', category: CATEGORY.DESKTOP, multi: 1.48, single: 1.09, platform: 'desktop' },
  G:   { meaning: 'Desktop with stronger built-in graphics', category: CATEGORY.DESKTOP, multi: 1.15, single: 1.0, platform: 'desktop' },
  GE:  { meaning: 'Desktop with built-in graphics, low power', category: CATEGORY.DESKTOP, multi: 1.0, single: 0.95, platform: 'desktop' },
  F:   { meaning: 'Desktop with no built-in graphics — needs a graphics card', category: CATEGORY.DESKTOP, multi: 1.3, single: 1.05, platform: 'desktop', noIgpu: true },
  '':  { meaning: 'Desktop, standard (no letter)', category: CATEGORY.DESKTOP, multi: 1.3, single: 1.05, platform: 'desktop' },
};

// Rough per-generation performance factors (relative; 1.0 ≈ AMD Zen 3 / Intel 11th-gen class).
// Multi reflects core-count growth (8th gen U went quad-core, 12th gen added E-cores).
const INTEL_GEN = {
  1:  { multi: 0.28, single: 0.45, year: 2010 },
  2:  { multi: 0.33, single: 0.5,  year: 2011 },
  3:  { multi: 0.36, single: 0.53, year: 2012 },
  4:  { multi: 0.4,  single: 0.57, year: 2013 },
  5:  { multi: 0.42, single: 0.59, year: 2015 },
  6:  { multi: 0.46, single: 0.64, year: 2015 },
  7:  { multi: 0.48, single: 0.67, year: 2016 },
  8:  { multi: 0.6,  single: 0.7,  year: 2017 },
  9:  { multi: 0.66, single: 0.72, year: 2018 },
  10: { multi: 0.72, single: 0.76, year: 2019 },
  11: { multi: 0.85, single: 0.88, year: 2020 },
  12: { multi: 1.15, single: 1.05, year: 2022 },
  13: { multi: 1.3,  single: 1.12, year: 2023 },
  14: { multi: 1.35, single: 1.14, year: 2024 },
};
const INTEL_TIER = { 3: 0.6, 5: 0.85, 7: 1.0, 9: 1.15 };

const AMD_ARCH = {
  1: { name: 'Zen / Zen+', multi: 0.55, single: 0.62, year: 2017 },
  2: { name: 'Zen 2', multi: 0.75, single: 0.75, year: 2019 },
  3: { name: 'Zen 3', multi: 1.0,  single: 0.92, year: 2020 },
  4: { name: 'Zen 4', multi: 1.25, single: 1.08, year: 2022 },
  5: { name: 'Zen 5', multi: 1.4,  single: 1.2,  year: 2024 },
};
const AMD_TIER = { 3: 0.6, 5: 0.85, 7: 1.0, 9: 1.15 };

// ---------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------

export function normalise(text) {
  return String(text)
    .replace(/\((?:tm|r|c)\)|[™®©]/gi, ' ')
    .replace(/[–—_]/g, '-')
    .replace(/[ \t]+/g, ' ');
}

// ---------------------------------------------------------------------------
// Matchers. Each returns an array of { index, raw, chip } where chip is decoded.
// ---------------------------------------------------------------------------

function findAll(re, text, fn) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    const chip = fn(m);
    if (chip) out.push({ index: m.index, end: m.index + m[0].length, raw: m[0].trim(), chip });
  }
  return out;
}

function cleanSuffix(s) {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Intel Core Ultra 5/7/9 NNN[suffix] (Series 1 = 1xx, Series 2 = 2xx). */
function matchCoreUltra(text) {
  const re = /\bcore\s*ultra\s*([579])\s*-?\s*(\d{3})([a-z]{0,2})\b/gi;
  return findAll(re, text, (m) => {
    const tier = Number(m[1]);
    const num = m[2];
    const suffix = cleanSuffix(m[3]);
    const series = Number(num[0]);
    const s = INTEL_SUFFIX[suffix] ?? INTEL_SUFFIX.H;
    const genF = series >= 2 ? { multi: 1.45, single: 1.25, year: 2024 } : { multi: 1.3, single: 1.1, year: 2023 };
    let category = s.category;
    if (tier === 9 && s.platform === 'desktop') category = CATEGORY.MONSTER;
    return build({
      vendor: 'Intel', family: 'Core Ultra', name: `Core Ultra ${tier} ${num}${suffix}`,
      tierLabel: `Ultra ${tier}`, tier, generation: series, generationLabel: `Series ${series}`,
      rank: num.slice(1), suffix, suffixInfo: s, category, year: genF.year,
      parts: [
        { text: `Ultra ${tier}`, role: 'tier' },
        { text: num[0], role: 'generation' },
        { text: num.slice(1), role: 'rank' },
        ...(suffix ? [{ text: suffix, role: 'suffix' }] : []),
      ],
      scoreMulti: genF.multi * INTEL_TIER[tier] * s.multi,
      scoreSingle: genF.single * s.single * (0.95 + 0.05 * (tier - 5) / 2),
      ageBand: 'current',
    });
  });
}

/** Intel Core 3/5/7 NNN[suffix] (2024 non-Ultra "Core" branding, e.g. Core 7 150U). */
function matchCoreSeries(text) {
  const re = /\bcore\s+([357])\s*-?\s*(\d{3})([a-z]{1,2})\b/gi;
  return findAll(re, text, (m) => {
    const tier = Number(m[1]);
    const num = m[2];
    const suffix = cleanSuffix(m[3]);
    const s = INTEL_SUFFIX[suffix] ?? INTEL_SUFFIX.U;
    const genF = INTEL_GEN[13];
    return build({
      vendor: 'Intel', family: 'Core', name: `Core ${tier} ${num}${suffix}`,
      tierLabel: `Core ${tier}`, tier, generation: Number(num[0]), generationLabel: `Series ${num[0]}`,
      rank: num.slice(1), suffix, suffixInfo: s, category: s.category, year: 2024,
      parts: [
        { text: `Core ${tier}`, role: 'tier' },
        { text: num[0], role: 'generation' },
        { text: num.slice(1), role: 'rank' },
        { text: suffix, role: 'suffix' },
      ],
      scoreMulti: genF.multi * INTEL_TIER[tier] * s.multi,
      scoreSingle: genF.single * s.single,
      ageBand: 'current',
      notes: ['"Core 5/7" (without "Ultra") are mostly refreshed 13th-gen designs under a new name.'],
    });
  });
}

/** Classic Intel Core i3/i5/i7/i9. Tolerates OCR misreads of the "i" (1, l, |). */
function matchCoreI(text) {
  const re = /(?:\bcore\s*)?\b([il1|])([3579])\s*(-)?\s*(\d{3,5})([a-z]{0,2}\d?)\b/gi;
  return findAll(re, text, (m) => {
    const lead = m[1];
    const hasDash = !!m[3];
    // A misread "i" (1 / l / |) is only trusted when a dash follows, e.g. "17-8550U".
    if (lead.toLowerCase() !== 'i' && !hasDash && !/core/i.test(m[0])) return null;
    const tier = Number(m[2]);
    const num = m[4];
    let suffix = cleanSuffix(m[5]);

    let generation, rank, genText;
    if (num.length === 5) {
      generation = Number(num.slice(0, 2)); genText = num.slice(0, 2); rank = num.slice(2);
    } else if (num.length === 4 && num[0] === '1') {
      // 10th–14th-gen mobile: i5-1235U, i7-1065G7
      generation = Number(num.slice(0, 2)); genText = num.slice(0, 2); rank = num.slice(2);
    } else if (num.length === 4) {
      generation = Number(num[0]); genText = num[0]; rank = num.slice(1);
    } else {
      generation = 1; genText = ''; rank = num;
    }
    if (!INTEL_GEN[generation]) return null;

    // G1..G7 suffix → treat as G family.
    const suffixKey = /^G\d$/.test(suffix) ? 'G' : suffix;
    const s = INTEL_SUFFIX[suffixKey];
    if (!s) return null;
    const genF = INTEL_GEN[generation];

    let category = s.category;
    if (s.platform === 'desktop' && tier === 9 && generation >= 12) category = CATEGORY.MONSTER;
    // Older H chips were mostly quad-cores: still "performance" for their time.

    const parts = [{ text: `i${tier}`, role: 'tier' }];
    if (genText) parts.push({ text: genText, role: 'generation' });
    parts.push({ text: rank, role: 'rank' });
    if (suffix) parts.push({ text: suffix, role: 'suffix' });

    return build({
      vendor: 'Intel', family: 'Core i', name: `Core i${tier}-${num}${suffix}`,
      tierLabel: `i${tier}`, tier, generation, generationLabel: `${ordinal(generation)} gen`,
      rank, suffix, suffixInfo: s, category, year: genF.year, parts,
      scoreMulti: genF.multi * INTEL_TIER[tier] * s.multi,
      scoreSingle: genF.single * s.single * (0.96 + 0.02 * (tier - 3) / 2),
      ageBand: ageBandFromYear(genF.year),
    });
  });
}

/** AMD Ryzen (incl. Ryzen AI 300 and PRO). */
function matchRyzen(text) {
  const re = /\bryzen\s*(ai\s*)?([3579])\s*(pro\s*)?(hx\s*)?-?\s*(\d{3,4})([a-z]{0,2}(?:3d)?)\b/gi;
  return findAll(re, text, (m) => {
    const isAI = !!m[1];
    const tier = Number(m[2]);
    const isPro = !!m[3];
    const num = m[5];
    let suffix = cleanSuffix(m[6]);
    if (m[4]) suffix = 'HX';

    let arch, genLabel, genText, rank, platformGuess;
    if (isAI) {
      // Ryzen AI 300: Zen 5 laptop chips. 3xx = series.
      arch = 5; genLabel = `AI ${num[0]}00 series`; genText = num[0]; rank = num.slice(1);
      if (!suffix) suffix = 'HS';
    } else if (num.length === 4) {
      const series = Number(num[0]);
      const third = Number(num[2]);
      const mobile = ['U', 'H', 'HS', 'HX'].includes(suffix);
      genText = num[0];
      rank = num.slice(1);
      genLabel = `${series}000 series`;
      if (mobile && series >= 7) {
        // 2023+ laptop scheme: 3rd digit = architecture (7840U → Zen 4, 7530U → Zen 3, 7520U → Zen 2)
        arch = AMD_ARCH[third] ? third : 4;
      } else {
        arch = ryzenSeriesToArch(series, mobile);
      }
    } else {
      return null;
    }

    const s = AMD_SUFFIX[suffix];
    if (!s) return null;
    const a = AMD_ARCH[arch];

    const parts = [{ text: `Ryzen ${isAI ? 'AI ' : ''}${tier}`, role: 'tier' }];
    parts.push({ text: genText, role: 'generation' });
    parts.push({ text: rank, role: 'rank' });
    if (suffix) parts.push({ text: suffix, role: 'suffix' });

    const notes = [];
    if (!isAI && num.length === 4 && Number(num[0]) >= 7 && s.platform === 'laptop') {
      notes.push(`AMD laptop numbering: the 3rd digit is the architecture — this one is ${a.name}. Two "${num[0]}000" chips can be generations apart.`);
    }
    if (!isAI && num.length === 4 && Number(num[0]) === 3 && s.platform === 'laptop') {
      notes.push('Ryzen 3000 laptop chips are older Zen+ — unlike 3000 desktop chips (Zen 2).');
    }
    if (isPro) notes.push('PRO = business version with extra security/management features; same performance.');

    let category = s.category;
    if (s.platform === 'desktop' && tier === 9) category = CATEGORY.MONSTER;

    return build({
      vendor: 'AMD', family: isAI ? 'Ryzen AI' : 'Ryzen',
      name: `Ryzen ${isAI ? 'AI ' : ''}${tier}${isPro ? ' PRO' : ''} ${num}${suffix && !isAI ? suffix : ''}${isAI && suffix === 'HX' ? ' (HX)' : ''}`.replace(/\s+/g, ' '),
      tierLabel: `Ryzen ${tier}`, tier, generation: arch, generationLabel: `${genLabel} · ${a.name}`,
      rank, suffix, suffixInfo: s, category, year: a.year, parts, notes,
      scoreMulti: a.multi * AMD_TIER[tier] * s.multi,
      scoreSingle: a.single * s.single,
      ageBand: ageBandFromYear(a.year),
    });
  });
}

function ryzenSeriesToArch(series, mobile) {
  if (mobile) return ({ 2: 1, 3: 1, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4, 9: 5 })[series] ?? 3;
  return ({ 1: 1, 2: 1, 3: 2, 4: 2, 5: 3, 7: 4, 8: 4, 9: 5 })[series] ?? 3;
}

/** Apple M1–M5 (+ Pro / Max / Ultra). */
function matchAppleM(text) {
  const re = /\b(?:apple\s*)?m([1-5])(?:\s+(pro|max|ultra))?\b/gi;
  return findAll(re, text, (m) => {
    // Avoid "M.2 SSD": require Apple context or a variant word.
    const ctx = text.slice(Math.max(0, m.index - 20), m.index + m[0].length + 10);
    if (!/apple/i.test(m[0]) && !m[2] && !/chip/i.test(ctx)) return null;
    const gen = Number(m[1]);
    const variant = m[2] ? m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() : '';
    const genF = { 1: [1.0, 1.0, 2020], 2: [1.15, 1.1, 2022], 3: [1.3, 1.25, 2023], 4: [1.55, 1.4, 2024], 5: [1.7, 1.5, 2025] }[gen];
    const vF = { '': 1.0, Pro: 1.9, Max: 2.2, Ultra: 3.8 }[variant];
    const category = { '': CATEGORY.BATTERY, Pro: CATEGORY.PERFORMANCE, Max: CATEGORY.MONSTER, Ultra: CATEGORY.MONSTER }[variant];
    const meaning = {
      '': 'Base chip — very efficient; great for everyday work, school and light creative work',
      Pro: 'Pro — more performance cores and GPU; serious video editing and coding',
      Max: 'Max — huge GPU and memory bandwidth; heavy video, 3D and pro workloads',
      Ultra: 'Ultra — two Max chips fused together; studio-level monster',
    }[variant];
    return build({
      vendor: 'Apple', family: 'Apple silicon', name: `Apple M${gen}${variant ? ' ' + variant : ''}`,
      tierLabel: variant || 'Base', tier: null, generation: gen, generationLabel: `M${gen} (${genF[2]})`,
      rank: null, suffix: variant, suffixInfo: { meaning, platform: 'both' }, category, year: genF[2],
      parts: [{ text: `M${gen}`, role: 'generation' }, ...(variant ? [{ text: variant, role: 'suffix' }] : [])],
      // Base M chips punch above their "battery" category.
      scoreMulti: genF[0] * 0.75 * vF,
      scoreSingle: genF[1] * 1.08,
      ageBand: ageBandFromYear(genF[2]),
      notes: ['Apple chips are very efficient: even the base chip stays fast on battery.'],
    });
  });
}

/** Entry-level chips: Celeron, Pentium, Atom, Intel N-series, Athlon. */
function matchEntry(text) {
  const re = /\b(celeron|pentium(?:\s*(?:silver|gold))?|atom|athlon(?:\s*(?:silver|gold))?|intel\s*(?:processor\s*)?n\d{2,3}|\bn(?:100|200|50|95|97|300|305))\b[\s-]*([a-z]?\d{3,4}[a-z]{0,2})?/gi;
  return findAll(re, text, (m) => {
    const name = m[0].trim().replace(/\s+/g, ' ');
    const family = /athlon/i.test(name) ? 'AMD' : 'Intel';
    return build({
      vendor: family, family: 'Entry', name: name.replace(/^./, (c) => c.toUpperCase()),
      tierLabel: 'Entry', tier: 1, generation: null, generationLabel: '—', rank: null, suffix: '',
      suffixInfo: { meaning: 'Budget chip for basic tasks', platform: 'both' }, category: CATEGORY.ENTRY,
      year: null, parts: [{ text: name, role: 'tier' }],
      scoreMulti: 0.22, scoreSingle: 0.55, ageBand: 'unknown',
    });
  });
}

/** Qualcomm Snapdragon X (Windows on ARM). */
function matchSnapdragon(text) {
  const re = /\bsnapdragon\s*x\s*(elite|plus)?\b/gi;
  return findAll(re, text, (m) => {
    const variant = m[1] ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : '';
    return build({
      vendor: 'Qualcomm', family: 'Snapdragon X', name: `Snapdragon X${variant ? ' ' + variant : ''}`,
      tierLabel: variant || 'X', tier: null, generation: 1, generationLabel: '1st gen (2024)', rank: null,
      suffix: variant, suffixInfo: { meaning: 'ARM laptop chip — excellent battery life; some apps/games may not run natively', platform: 'laptop' },
      category: CATEGORY.BALANCED, year: 2024,
      parts: [{ text: 'Snapdragon X', role: 'tier' }, ...(variant ? [{ text: variant, role: 'suffix' }] : [])],
      scoreMulti: variant === 'Elite' ? 1.15 : 0.95, scoreSingle: 1.1, ageBand: 'current',
      notes: ['Gaming support on ARM Windows is limited — check your games first.'],
    });
  });
}

// ---------------------------------------------------------------------------

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function ageBandFromYear(year) {
  if (!year) return 'unknown';
  if (year >= 2023) return 'current';
  if (year >= 2021) return 'recent';
  if (year >= 2018) return 'aging';
  return 'old';
}

export const AGE_INFO = {
  current: { label: 'Current', advice: 'Modern chip — a solid buy today.' },
  recent: { label: 'Recent', advice: 'A few years old but still capable. Fine if the price is right.' },
  aging: { label: 'Aging', advice: 'Getting old. A newer lower tier (e.g. a recent i5) is often faster — compare benchmarks.' },
  old: { label: 'Old', advice: 'Old generation. Avoid for a new purchase unless it is very cheap — newer budget chips beat it.' },
  unknown: { label: 'Unknown', advice: 'Check the release year with a quick search.' },
};

/** Normalise raw scores onto a 0–100-ish scale (Core i7-13700H ≈ 100 multi). */
const REF_MULTI = 1.3;   // i7-13700H multi raw
const REF_SINGLE = 1.12 * 1.0 * 1.0; // i7-13700H single raw

function build(c) {
  const multi = Math.round((c.scoreMulti / REF_MULTI) * 100);
  const single = Math.round((c.scoreSingle / REF_SINGLE) * 100);
  const uses = usesFor(c, multi, single);
  return {
    ...c,
    notes: c.notes ?? [],
    noIgpu: !!c.suffixInfo?.noIgpu,
    platform: c.suffixInfo?.platform ?? 'unknown',
    multiScore: multi,
    singleScore: single,
    uses,
    benchmarkQuery: `${c.name} benchmark`,
  };
}

function usesFor(c, multi, single) {
  const r = (v) => (v >= 2 ? 'great' : v >= 1 ? 'ok' : 'poor');
  // Gaming leans on single-core; video editing on multi-core (as per the video).
  const gaming = c.category === CATEGORY.ENTRY || c.category === CATEGORY.BATTERY
    ? (single >= 95 && multi >= 60 ? 1 : 0)
    : single >= 90 ? 2 : single >= 70 ? 1 : 0;
  const video = multi >= 75 ? 2 : multi >= 35 ? 1 : 0;
  const office = c.category === CATEGORY.ENTRY ? 1 : 2;
  return {
    office: r(office),
    gaming: r(gaming),
    video: r(video),
    battery: r(c.category === CATEGORY.BATTERY || c.vendor === 'Apple' || c.vendor === 'Qualcomm' ? 2
      : c.category === CATEGORY.BALANCED || c.category === CATEGORY.ENTRY ? 1 : 0),
  };
}

/** Find every CPU mentioned in text. Overlapping matches are de-duplicated (first, most specific wins). */
export function findCpus(text) {
  const t = normalise(text);
  const all = [
    ...matchCoreUltra(t),
    ...matchCoreSeries(t),
    ...matchRyzen(t),
    ...matchAppleM(t),
    ...matchSnapdragon(t),
    ...matchCoreI(t),
    ...matchEntry(t),
  ];
  const kept = [];
  for (const m of all) {
    if (kept.some((k) => m.index < k.end && k.index < m.end)) continue;
    if (kept.some((k) => k.chip.name === m.chip.name)) continue;
    kept.push(m);
  }
  return kept.sort((a, b) => a.index - b.index).map((m) => ({ ...m.chip, raw: m.raw }));
}

/** Other useful specs commonly visible on stickers / "About" screens. */
export function findExtras(text) {
  const t = normalise(text);
  const extras = {};
  const ram = t.match(/(?:installed\s*ram|memory|ram)\s*:?\s*(\d{1,3}(?:[.,]\d)?)\s*gb/i)
    || t.match(/(\d{1,3})\s*gb\s*(?:of\s*)?(?:ram|memory|(?:lp)?ddr\d\w*|unified memory)/i);
  if (ram) extras.ramGB = Math.round(parseFloat(ram[1].replace(',', '.')));
  const ghz = [...t.matchAll(/(\d(?:[.,]\d{1,2})?)\s*ghz/gi)].map((m) => parseFloat(m[1].replace(',', '.')));
  if (ghz.length) extras.ghz = Math.max(...ghz);
  const storage = t.match(/(\d{3,4}\s*gb|\d\s*tb)\s*(?:pcie\s*|nvme\s*|m\.2\s*)*(ssd|hdd|emmc)/i);
  if (storage) extras.storage = `${storage[1].replace(/\s+/g, ' ').toUpperCase()} ${storage[2].toUpperCase()}`;
  const cores = t.match(/(\d{1,2})\s*-?\s*cores?\b/i);
  if (cores) extras.cores = Number(cores[1]);
  const gpu = t.match(/\b(?:geforce\s*)?(rtx|gtx)\s*-?\s*(\d{3,4})\s*(ti|super)?\b/i)
    || t.match(/\bradeon\s*(rx\s*)?\d{3,4}m?\s*(xt)?\b/i);
  if (gpu) extras.gpu = gpu[0].replace(/\s+/g, ' ').toUpperCase().replace('GEFORCE', 'GeForce').replace('RADEON', 'Radeon');
  return extras;
}

export function ramAdvice(gb) {
  if (gb == null) return null;
  if (gb < 8) return { level: 'poor', text: `${gb} GB RAM is too little for modern use — expect slowdowns.` };
  if (gb < 16) return { level: 'ok', text: `${gb} GB RAM is fine for work & school; tight for gaming or editing.` };
  return { level: 'great', text: `${gb} GB RAM is comfortable for gaming and creative work.` };
}

/** Compare two decoded chips; returns a human verdict. */
export function compare(a, b) {
  const multi = b.multiScore / a.multiScore;
  const single = b.singleScore / a.singleScore;
  const fmt = (x) => (x >= 1 ? x : 1 / x);
  const winnerMulti = multi >= 1 ? 'b' : 'a';
  const winnerSingle = single >= 1 ? 'b' : 'a';
  const ratioMulti = fmt(multi);
  const ratioSingle = fmt(single);
  const lines = [];
  const nameOf = (w) => (w === 'a' ? a.name : b.name);
  const describe = (r) => (r < 1.1 ? 'about the same' : r < 1.5 ? `~${Math.round((r - 1) * 100)}% faster` : `~${r.toFixed(1)}× faster`);
  lines.push(`Heavy work / video editing (multi-core): ${ratioMulti < 1.1 ? 'about the same' : `${nameOf(winnerMulti)} is ${describe(ratioMulti)}`}.`);
  lines.push(`Gaming / snappiness (single-core): ${ratioSingle < 1.1 ? 'about the same' : `${nameOf(winnerSingle)} is ${describe(ratioSingle)}`}.`);
  if (a.tier && b.tier && a.tier !== b.tier) {
    const higherTier = a.tier > b.tier ? a : b;
    const lower = higherTier === a ? b : a;
    const higherWins = (higherTier === a ? winnerMulti === 'a' : winnerMulti === 'b');
    if (!higherWins) {
      lines.push(`Proof that "${higherTier.tierLabel}" on its own means nothing: the ${lower.tierLabel} wins thanks to its newer generation (${lower.generationLabel}) and its "${lower.suffix || "desktop"}" letter.`);
    }
  }
  return { winnerMulti, winnerSingle, ratioMulti, ratioSingle, lines };
}
