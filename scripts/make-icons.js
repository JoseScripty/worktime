// Genera los iconos PNG de la app (sin dependencias): node scripts/make-icons.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

// ---------- PNG encoder ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- Signed distance functions (coords normalizadas 0..1) ----------
function sdRoundRect(x, y, half, r) {
  const qx = Math.abs(x - 0.5) - half + r;
  const qy = Math.abs(y - 0.5) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(x, y, ax, ay, bx, by) {
  const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h);
}

function sdArc(x, y, cx, cy, R, a0, a1) {
  const a = Math.atan2(y - cy, x - cx);
  if (a >= a0 && a <= a1) return Math.abs(Math.hypot(x - cx, y - cy) - R);
  const e0 = Math.hypot(x - (cx + R * Math.cos(a0)), y - (cy + R * Math.sin(a0)));
  const e1 = Math.hypot(x - (cx + R * Math.cos(a1)), y - (cy + R * Math.sin(a1)));
  return Math.min(e0, e1);
}

// Glifo "escaneo facial": esquinas de encuadre + ojos + sonrisa.
function glyphDistance(x, y, weight) {
  const w = 0.03 * weight;
  const a = 0.27, b = 0.73, arm = 0.11;
  const corners = Math.min(
    sdSegment(x, y, a, a, a + arm, a), sdSegment(x, y, a, a, a, a + arm),
    sdSegment(x, y, b, a, b - arm, a), sdSegment(x, y, b, a, b, a + arm),
    sdSegment(x, y, a, b, a + arm, b), sdSegment(x, y, a, b, a, b - arm),
    sdSegment(x, y, b, b, b - arm, b), sdSegment(x, y, b, b, b, b - arm),
  ) - w;
  const eyes = Math.min(
    Math.hypot(x - 0.415, y - 0.445),
    Math.hypot(x - 0.585, y - 0.445),
  ) - 0.036 * Math.max(1, weight * 0.85);
  const smile = sdArc(x, y, 0.5, 0.49, 0.125, 0.2 * Math.PI, 0.8 * Math.PI) - w;
  return Math.min(corners, eyes, smile);
}

const GRAD_A = [99, 102, 241]; // #6366f1
const GRAD_B = [139, 92, 246]; // #8b5cf6

function render(size, { mode, margin = 0, radius = 0.22, weight = 1, zoom = 1 }) {
  const out = Buffer.alloc(size * size * 4);
  const S = 4; // supersampling
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, covered = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          const gx = 0.5 + (x - 0.5) / zoom;
          const gy = 0.5 + (y - 0.5) / zoom;
          const inGlyph = glyphDistance(gx, gy, weight) <= 0;
          if (mode === 'template') {
            if (inGlyph) covered++;
            continue;
          }
          if (sdRoundRect(x, y, 0.5 - margin, radius) > 0) continue;
          covered++;
          if (inGlyph) { r += 255; g += 255; b += 255; continue; }
          const t = Math.min(1, Math.max(0, (x + y) / 2));
          r += GRAD_A[0] + (GRAD_B[0] - GRAD_A[0]) * t;
          g += GRAD_A[1] + (GRAD_B[1] - GRAD_A[1]) * t;
          b += GRAD_A[2] + (GRAD_B[2] - GRAD_A[2]) * t;
        }
      }
      const i = (py * size + px) * 4;
      const alpha = covered / (S * S);
      if (mode === 'template') {
        out[i + 3] = Math.round(alpha * 255);
      } else if (covered) {
        out[i] = Math.round(r / covered);
        out[i + 1] = Math.round(g / covered);
        out[i + 2] = Math.round(b / covered);
        out[i + 3] = Math.round(alpha * 255);
      }
    }
  }
  return encodePNG(size, out);
}

function write(rel, png) {
  const file = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, png);
  console.log('  ' + rel);
}

console.log('Generando iconos:');
write('build/icon.png', render(1024, { mode: 'color', margin: 0.08, radius: 0.2 }));
write('assets/icon.png', render(256, { mode: 'color', margin: 0.04, radius: 0.22 }));
// Bandeja de Windows (a color)
write('assets/tray.png', render(16, { mode: 'color', radius: 0.25, weight: 1.6, zoom: 1.12 }));
write('assets/tray@2x.png', render(32, { mode: 'color', radius: 0.25, weight: 1.35, zoom: 1.12 }));
// Barra de menú de macOS (plantilla monocromática)
write('assets/trayTemplate.png', render(18, { mode: 'template', weight: 1.1, zoom: 1.9 }));
write('assets/trayTemplate@2x.png', render(36, { mode: 'template', weight: 1, zoom: 1.9 }));
