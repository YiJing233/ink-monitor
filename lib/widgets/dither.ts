/**
 * Server-side 1-bit dithering + a dependency-free grayscale PNG encoder.
 *
 * Color/grayscale photos look muddy on B&W e-ink; error-diffusion dithering
 * (Atkinson / Floyd-Steinberg) turns them into crisp 1-bit images. The encoder
 * uses only node:zlib so there is no native image dependency for the *output*
 * stage. (Decoding the *input* photo still needs sharp/@napi-rs/canvas - see
 * app/api/asset/dither/route.ts, which degrades gracefully if absent.)
 *
 * The dithering + encoder are pure and unit-tested.
 */
import { deflateSync } from 'node:zlib';

type Gray = Uint8Array | number[];

/** Atkinson dithering (lighter, higher-contrast - the classic e-ink look). */
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

/** Floyd-Steinberg dithering (denser, more tonal). */
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

// --- Minimal grayscale PNG encoders (node:zlib only) ---

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

function buildIhdr(w: number, h: number, bitDepth: number, colorType: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return ihdr;
}

const PNG_SIG_BUF = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Encode a grayscale buffer (1 byte/px, 0..255) as an 8-bit grayscale PNG. */
export function encodeGrayPng(gray: Gray, w: number, h: number): Buffer {
  const px = gray as ArrayLike<number>;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0; // filter: none
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = px[y * w + x] & 0xff;
  }
  const ihdr = buildIhdr(w, h, 8, 0); // 8-bit grayscale
  return Buffer.concat([PNG_SIG_BUF, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Encode a binary buffer (each byte is 0 or 255) as a 1-bit grayscale PNG.
 *
 * PNG grayscale 1-bit packs pixels MSB-first into each row byte; bit 0 = black
 * (sample 0), bit 1 = white (sample 1). Trailing bits in the last byte of a
 * row are ignored by decoders. Each row in the IDAT stream is prefixed with a
 * 1-byte filter selector (0 = None, which we always use here).
 *
 * Output is ~8x smaller than encodeGrayPng for the same image, which matters
 * for e-ink displays that pull the same asset on every refresh.
 */
export function encodePng1Bit(image: ArrayLike<number>, w: number, h: number): Buffer {
  const rowBytes = Math.ceil(w / 8);
  const raw = Buffer.alloc((rowBytes + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter: none
    const rowStart = y * (rowBytes + 1) + 1;
    for (let x = 0; x < w; x++) {
      // Map: 0 -> black bit (0), 255 -> white bit (1). Non-zero also treated as white.
      if ((image[y * w + x] ?? 0) !== 0) raw[rowStart + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const ihdr = buildIhdr(w, h, 1, 0); // 1-bit grayscale
  return Buffer.concat([PNG_SIG_BUF, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export const PNG_SIGNATURE = PNG_SIG_BUF;
