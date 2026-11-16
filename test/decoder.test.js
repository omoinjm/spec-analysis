import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCpus, findExtras, compare, CATEGORY } from '../public/src/decoder.js';

const one = (t) => {
  const r = findCpus(t);
  assert.equal(r.length, 1, `expected 1 cpu in "${t}", got ${JSON.stringify(r.map((c) => c.name))}`);
  return r[0];
};

test('video example: Core i7-13700H', () => {
  const c = one('Intel Core i7 13700H');
  assert.equal(c.tier, 7);
  assert.equal(c.generation, 13);
  assert.equal(c.rank, '700');
  assert.equal(c.suffix, 'H');
  assert.equal(c.category, CATEGORY.PERFORMANCE);
});

test('video quiz: Core i5-1235U is work & school', () => {
  const c = one('Core i5-1235U');
  assert.equal(c.generation, 12);
  assert.equal(c.rank, '35');
  assert.equal(c.category, CATEGORY.BATTERY);
  assert.equal(c.uses.gaming, 'poor');
});

test('video punchline: 13th-gen i5 H is ~5x an 8th-gen i7 U on heavy work', () => {
  const i7 = one('Intel(R) Core(TM) i7-8550U CPU @ 1.80GHz');
  const i5 = one('i5-13500H');
  assert.equal(i7.generation, 8);
  const v = compare(i7, i5);
  assert.equal(v.winnerMulti, 'b');
  assert.ok(v.ratioMulti > 4 && v.ratioMulti < 6, `ratio ${v.ratioMulti}`);
  assert.ok(v.lines.some((l) => l.includes('means nothing')));
});

test('suffixes: HX monster, K overclock, F no graphics', () => {
  assert.equal(one('i7-14650HX').category, CATEGORY.MONSTER);
  const k = one('i5-13600K');
  assert.equal(k.platform, 'desktop');
  assert.match(k.suffixInfo.meaning, /overclock/);
  assert.equal(one('i5-12400F').noIgpu, true);
  assert.equal(one('i9-14900K').category, CATEGORY.MONSTER);
});

test('older and odd Intel numbering', () => {
  assert.equal(one('i7-1065G7').generation, 10);
  assert.equal(one('i7-1065G7').suffix, 'G7');
  assert.equal(one('i7-4770').generation, 4);
  assert.equal(one('i7-920').generation, 1);
  assert.equal(one('i7-10750H').generation, 10);
});

test('OCR misreads of the "i"', () => {
  assert.equal(one('Core 17-8550U').tier, 7);
  assert.equal(one('l5-1135G7').generation, 11);
  assert.equal(findCpus('in 2017-8550 units').length, 0);
});

test('Core Ultra and Core N', () => {
  const u = one('Intel Core Ultra 7 155H');
  assert.equal(u.generation, 1);
  assert.equal(u.category, CATEGORY.PERFORMANCE);
  assert.equal(one('Core Ultra 9 285K').category, CATEGORY.MONSTER);
  assert.equal(one('Core Ultra 7 258V').category, CATEGORY.BALANCED);
  assert.equal(one('Intel Core 7 150U').category, CATEGORY.BATTERY);
});

test('AMD Ryzen', () => {
  const a = one('AMD Ryzen 7 7840HS');
  assert.equal(a.tier, 7);
  assert.match(a.generationLabel, /Zen 4/);
  assert.match(one('Ryzen 5 7520U').generationLabel, /Zen 2/);
  assert.equal(one('Ryzen 9 7945HX').category, CATEGORY.MONSTER);
  assert.equal(one('Ryzen 7 5800X3D').suffix, 'X3D');
  assert.equal(one('Ryzen 5 3600').platform, 'desktop');
  assert.equal(one('AMD Ryzen AI 9 HX 370').suffix, 'HX');
  assert.equal(one('Ryzen 7 PRO 7840U').category, CATEGORY.BATTERY);
});

test('Apple M-series', () => {
  assert.equal(one('Chip Apple M2 Pro').suffix, 'Pro');
  assert.equal(one('M3 Max').category, CATEGORY.MONSTER);
  assert.equal(one('Apple M1').category, CATEGORY.BATTERY);
  assert.equal(findCpus('1TB M.2 SSD').length, 0);
});

test('entry level & extras', () => {
  assert.equal(one('Intel Celeron N4020').category, CATEGORY.ENTRY);
  const e = findExtras('Processor Intel Core i5-1235U 1.30 GHz\nInstalled RAM 16.0 GB (15.7 GB usable)\n512GB SSD NVIDIA GeForce RTX 3050');
  assert.equal(e.ramGB, 16);
  assert.equal(e.ghz, 1.3);
  assert.equal(e.storage, '512GB SSD');
  assert.match(e.gpu, /RTX 3050/);
});

test('Windows "About" screen text with multiple lines', () => {
  const r = findCpus('Device name DESKTOP-ABC\nProcessor 11th Gen Intel(R) Core(TM) i7-1165G7 @ 2.80GHz 2.80 GHz\nSystem type 64-bit');
  assert.equal(r.length, 1);
  assert.equal(r[0].generation, 11);
});
