import { describe, it, expect } from 'vitest';
import { inflateSync } from 'node:zlib';
import {
  atkinson,
  floydSteinberg,
  encodeGrayPng,
  encodePng1Bit,
  PNG_SIGNATURE,
} from '../dither';

describe('dithering', () => {
  it('keeps pure white white and pure black black', () => {
    const white = new Uint8Array(16).fill(255);
    const black = new Uint8Array(16).fill(0);
    expect(Array.from(atkinson(white, 4, 4)).every((v) => v === 255)).toBe(true);
    expect(Array.from(atkinson(black, 4, 4)).every((v) => v === 0)).toBe(true);
    expect(Array.from(floydSteinberg(white, 4, 4)).every((v) => v === 255)).toBe(true);
  });

  it('outputs only 0 or 255', () => {
    const ramp = new Uint8Array(64);
    for (let i = 0; i < 64; i++) ramp[i] = i * 4;
    const out = floydSteinberg(ramp, 8, 8);
    expect(Array.from(out).every((v) => v === 0 || v === 255)).toBe(true);
  });

  it('roughly preserves average tone for mid-gray', () => {
    const mid = new Uint8Array(400).fill(128);
    const out = atkinson(mid, 20, 20);
    const avg = Array.from(out).reduce((a, b) => a + b, 0) / out.length;
    expect(avg).toBeGreaterThan(96);
    expect(avg).toBeLessThan(160);
  });
});

describe('encodeGrayPng', () => {
  it('produces a valid PNG header for the given size', () => {
    const px = new Uint8Array(12).fill(255);
    const png = encodeGrayPng(px, 4, 3);
    expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
    // IHDR width/height live at byte 16 and 20 (after sig + len + "IHDR").
    expect(png.readUInt32BE(16)).toBe(4);
    expect(png.readUInt32BE(20)).toBe(3);
    // First chunk type after the 4-byte length is "IHDR".
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    // 8-bit grayscale.
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(0);
  });
});

/** Tiny 1-bit grayscale PNG decoder (filter 0, no interlace) for round-trip tests. */
function decodePng1Bit(png: Buffer): { w: number; h: number; bits: Uint8Array } {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  let p = 8;
  let ihdr: Buffer | null = null;
  const idat: Buffer[] = [];
  while (p < png.length) {
    const len = png.readUInt32BE(p);
    const type = png.subarray(p + 4, p + 8).toString('ascii');
    const data = png.subarray(p + 8, p + 8 + len);
    p += 8 + len + 4;
    if (type === 'IHDR') ihdr = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
  }
  expect(ihdr).not.toBeNull();
  const w = ihdr!.readUInt32BE(0);
  const h = ihdr!.readUInt32BE(4);
  expect(ihdr![8]).toBe(1); // bit depth
  expect(ihdr![9]).toBe(0); // grayscale
  const rowBytes = Math.ceil(w / 8);
  const raw = inflateSync(Buffer.concat(idat));
  const bits = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    expect(raw[y * (rowBytes + 1)]).toBe(0); // filter: None
    const rowStart = y * (rowBytes + 1) + 1;
    for (let x = 0; x < w; x++) {
      const byte = raw[rowStart + (x >> 3)];
      bits[y * w + x] = (byte >> (7 - (x & 7))) & 1;
    }
  }
  return { w, h, bits };
}

describe('encodePng1Bit', () => {
  it('produces a PNG signature + IHDR with bit depth 1 and grayscale color type', () => {
    const px = new Uint8Array(8).fill(255);
    const png = encodePng1Bit(px, 8, 1);
    // Signature: 89 50 4E 47 0D 0A 1A 0A.
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // First chunk is IHDR.
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.readUInt32BE(16)).toBe(8);
    expect(png.readUInt32BE(20)).toBe(1);
    // IHDR[8] = bit depth, IHDR[9] = color type (0 = grayscale).
    expect(png[24]).toBe(1);
    expect(png[25]).toBe(0);
  });

  it('maps 0 -> black bit and 255 -> white bit across the whole image', () => {
    const black = new Uint8Array(16).fill(0);
    const white = new Uint8Array(16).fill(255);
    const blackBits = decodePng1Bit(encodePng1Bit(black, 16, 1)).bits;
    const whiteBits = decodePng1Bit(encodePng1Bit(white, 16, 1)).bits;
    expect(Array.from(blackBits).every((b) => b === 0)).toBe(true);
    expect(Array.from(whiteBits).every((b) => b === 1)).toBe(true);
  });

  it('round-trips a mixed alternating pattern at width that is not byte-aligned', () => {
    // 17 pixels wide -> 3 packed bytes; only the first 17 bits matter.
    const w = 17;
    const h = 2;
    const px = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Checkerboard starting with white in the top row.
        const on = (x + y) % 2 === 0;
        px[y * w + x] = on ? 255 : 0;
      }
    }
    const decoded = decodePng1Bit(encodePng1Bit(px, w, h));
    expect(decoded.w).toBe(w);
    expect(decoded.h).toBe(h);
    for (let i = 0; i < w * h; i++) {
      const on = ((i % w) + Math.floor(i / w)) % 2 === 0;
      expect(decoded.bits[i]).toBe(on ? 1 : 0);
    }
  });

  it('produces smaller output than the 8-bit grayscale encoder', () => {
    // dither() output on a real photo is mostly black-or-white noise, but the
    // values 0 and 255 themselves compress well in zlib (runs of identical
    // bytes), so the raw 8x IDAT advantage of the 1-bit encoder is partially
    // eaten by zlib finding structure in the 8-bit stream too. We don't pin
    // an exact ratio (it depends on the data and on the zlib version) — we
    // just assert the 1-bit output is strictly smaller, which is the only
    // guarantee the e-ink pipeline actually relies on.
    const w = 128;
    const h = 128;
    const px = new Uint8Array(w * h);
    let seed = 0x9e3779b9;
    const rand = () => {
      // xorshift32 — deterministic, no deps.
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed >>> 0;
    };
    for (let i = 0; i < px.length; i++) px[i] = rand() & 1 ? 255 : 0;
    const gray = encodeGrayPng(px, w, h);
    const oneBit = encodePng1Bit(px, w, h);
    expect(oneBit.length).toBeLessThan(gray.length);
    // And, crucially, the inflated IDAT scanlines should reflect the 8x
    // raw ratio: 1 filter byte + 1 sample per pixel vs 1 filter byte + 1
    // packed bit per pixel. Deflate eats most of this on small inputs.
    const extractIdat = (png: Buffer): number => {
      let p = 8;
      const chunks: Buffer[] = [];
      while (p < png.length) {
        const len = png.readUInt32BE(p);
        const type = png.subarray(p + 4, p + 8).toString('ascii');
        const data = png.subarray(p + 8, p + 8 + len);
        p += 8 + len + 4;
        if (type === 'IDAT') chunks.push(data);
        else if (type === 'IEND') break;
      }
      return inflateSync(Buffer.concat(chunks)).length;
    };
    const raw8 = extractIdat(gray);
    const raw1 = extractIdat(oneBit);
    expect(raw8).toBe((w + 1) * h);
    expect(raw1).toBe((Math.ceil(w / 8) + 1) * h);
    expect(raw8 / raw1).toBeGreaterThan(6);
  });
});
