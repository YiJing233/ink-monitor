import { describe, it, expect } from 'vitest';
import { qrMatrix } from '../qr';

describe('qrMatrix', () => {
  it('returns a square boolean matrix sized like a real QR (>= 21)', () => {
    const m = qrMatrix('https://example.com/display');
    expect(m.length).toBeGreaterThanOrEqual(21);
    expect(m.every((row) => row.length === m.length)).toBe(true);
  });

  it('renders the top-left finder pattern (7x7 with a dark border + 3x3 core)', () => {
    const m = qrMatrix('hello');
    // finder: outer ring dark, inner ring light, 3x3 core dark
    expect(m[0][0]).toBe(true);
    expect(m[0][6]).toBe(true);
    expect(m[6][0]).toBe(true);
    expect(m[1][1]).toBe(false); // inside the light ring
    expect(m[3][3]).toBe(true); // center of the core
  });

  it('grows with payload length', () => {
    const small = qrMatrix('hi');
    const big = qrMatrix('x'.repeat(300));
    expect(big.length).toBeGreaterThan(small.length);
  });
});
