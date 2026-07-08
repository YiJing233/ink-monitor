import { describe, it, expect } from 'vitest';
import { atkinson, floydSteinberg, encodeGrayPng, PNG_SIGNATURE } from '../dither';

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
  });
});
