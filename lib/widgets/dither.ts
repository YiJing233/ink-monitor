/**
 * Server-side 1-bit dithering + a dependency-free grayscale PNG encoder.
 *
 * Color/grayscale photos look muddy on B&W e-ink; error-diffusion dithering
 * (Atkinson / Floyd–Steinberg) turns them into crisp 1-bit images. The encoder
 * uses only node:zlib so there is no native image dependency for the *output*
 * stage. (Decoding the *input* photo still needs sharp/@napi-rs/canvas — see
 * app/api/asset/dither/route.ts, which degrades gracefully if absent.)
 *
 * The dithering + encoder are pure and unit-tested.
 */
import { deflateSync } from 'node:zlib';

type Gray = Uint8Array | number[];

/** Atkinson dithering (lighter, higher-contrast — the classic e-ink look). */
export function atkinson(gray: Gray, w: number, h: number): Uint8Array {
  const g = Float32Array.from(gray as number[]);
  const out = new Uint8Array(w * h);
  const spread = (x: number, y: number, err: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    g[y * w + x] += err;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const oldv = g[i];
      const newv = oldv < 128 ? 0 : 255;
      out[i] = newv;
      const err = (oldv - newv) / 8;
      spread(x + 1, y, err);
      spread(x + 2, y, err);
      spread(x - 1, y + 1, err);
      spread(x, y + 1, err);
      spread(x + 1, y + 1, err);
      spread(x, y + 2, err);
    }
  }
  return out;
}

/** Floyd–Steinberg dithering (denser, more tonal). */
export function floydSteinberg(gray: Gray, w: number, h: number): Uint8Array {
  const g = Float32Array.from(gray as number[]);
  const out = new Uint8Array(w * h);
  const spread = (x: number, y: number, err: number) => {
    if (x < 0 || x >= w || y < 0 || y >= h) return;
    g[y * w + x] += err;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const oldv = g[i];
      const newv = oldv < 128 ? 0 : 255;
      out[i] = newv;
      const err = oldv - newv;
      spread(x + 1, y, (err * 7) / 16);
      spread(x - 1, y + 1, (err * 3) / 16);
      spread(x, y + 1, (err * 5) / 16);
      spread(x + 1, y + 1, (err * 1) / 16);
    }
  }
  return out;
}

export function dither(style: 'atkinson' | 'floyd', gray: Gray, w: number, h: number): Uint8Array {
  return style === 'floyd' ? floydSteinberg(gray, w, h) : atkinson(gray, w, h);
}

// --- Minimal 8-bit grayscale PNG encoder (node:zlib only) ---

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Encode a grayscale buffer (1 byte/px, 0..255) as an 8-bit grayscale PNG. */
export function encodeGrayPng(gray: Gray, w: number, h: number): Buffer {
  const px = gray as ArrayLike<number>;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0; // filter: none
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = px[y * w + x] & 0xff;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // color type: grayscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
