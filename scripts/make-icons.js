// Generates icons/icon-192.png and icons/icon-512.png (a CPU chip) with no dependencies.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BG = [15, 23, 42], CHIP = [79, 70, 229], CORE = [165, 180, 252], PIN = [148, 163, 184];

function draw(size) {
  const px = new Uint8Array(size * size * 3);
  const set = (x, y, c) => { const i = (y * size + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = Math.round(y0 * size); y < Math.round(y1 * size); y++)
      for (let x = Math.round(x0 * size); x < Math.round(x1 * size); x++) set(x, y, c);
  };
  rect(0, 0, 1, 1, BG); // full bleed → works as maskable
  // pins: 4 per side
  for (let i = 0; i < 4; i++) {
    const p = 0.33 + i * 0.1;
    rect(p - 0.025, 0.18, p + 0.025, 0.28, PIN);
    rect(p - 0.025, 0.72, p + 0.025, 0.82, PIN);
    rect(0.18, p - 0.025, 0.28, p + 0.025, PIN);
    rect(0.72, p - 0.025, 0.82, p + 0.025, PIN);
  }
  rect(0.26, 0.26, 0.74, 0.74, CHIP);
  rect(0.37, 0.37, 0.63, 0.63, CORE);
  return px;
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size) {
  const px = draw(size);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    Buffer.from(px.buffer, y * size * 3, size * 3).copy(raw, y * (size * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icons', { recursive: true });
for (const s of [192, 512]) writeFileSync(`public/icons/icon-${s}.png`, png(s));
console.log('icons written');
