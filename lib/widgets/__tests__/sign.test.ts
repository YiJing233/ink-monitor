import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { signValue, verifyValue, signQuery, verifyQuery, isFreshTimestamp } from '../sign';

describe('sign', () => {
  it('verifies a value it signed', () => {
    const v = 'https://cdn.example.com/photo.jpg';
    expect(verifyValue(v, signValue(v))).toBe(true);
  });

  it('rejects a tampered value or signature', () => {
    const v = 'https://cdn.example.com/photo.jpg';
    const sig = signValue(v);
    expect(verifyValue('https://evil.example.com/photo.jpg', sig)).toBe(false);
    expect(verifyValue(v, sig.slice(0, -1) + (sig.endsWith('a') ? 'b' : 'a'))).toBe(false);
  });

  it('rejects empty / wrong-length signatures', () => {
    expect(verifyValue('x', null)).toBe(false);
    expect(verifyValue('x', '')).toBe(false);
    expect(verifyValue('x', 'short')).toBe(false);
  });
});

describe('signQuery', () => {
  const key = 'gallery-hmac-key-for-test';

  it('signs + verifies a (method, url, ts) tuple round-trip', () => {
    const parts = { method: 'GET', url: 'https://gallery.example.com/registry.json', ts: 1_700_000_000_000 };
    const sig = signQuery(parts, key);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyQuery(parts, sig, key)).toBe(true);
  });

  it('uses uppercase method normalization (case-insensitive)', () => {
    const lower = { method: 'get', url: 'https://x/a', ts: 1 };
    const upper = { method: 'GET', url: 'https://x/a', ts: 1 };
    expect(signQuery(lower, key)).toBe(signQuery(upper, key));
  });

  it('rejects when any of method/url/ts differs', () => {
    const parts = { method: 'GET', url: 'https://x/a', ts: 1 };
    const sig = signQuery(parts, key);
    expect(verifyQuery({ ...parts, method: 'POST' }, sig, key)).toBe(false);
    expect(verifyQuery({ ...parts, url: 'https://x/b' }, sig, key)).toBe(false);
    expect(verifyQuery({ ...parts, ts: 2 }, sig, key)).toBe(false);
    expect(verifyQuery(parts, sig.slice(0, -1) + '0', key)).toBe(false);
  });

  it('rejects empty / null signatures and uses constant-time compare', () => {
    const parts = { method: 'GET', url: 'https://x/a', ts: 1 };
    expect(verifyQuery(parts, null, key)).toBe(false);
    expect(verifyQuery(parts, '', key)).toBe(false);
    expect(verifyQuery(parts, 'short', key)).toBe(false);
  });
});

describe('isFreshTimestamp', () => {
  it('accepts a now / recent timestamp within the default 5-min window', () => {
    expect(isFreshTimestamp(Date.now())).toBe(true);
    expect(isFreshTimestamp(Date.now() - 60_000)).toBe(true);
    expect(isFreshTimestamp(Date.now() + 60_000)).toBe(true);
  });

  it('rejects timestamps older than the window', () => {
    expect(isFreshTimestamp(Date.now() - 10 * 60_000)).toBe(false);
    expect(isFreshTimestamp(Date.now() - 24 * 60 * 60_000)).toBe(false);
  });

  it('honors custom windowMs and rejects garbage', () => {
    expect(isFreshTimestamp(Date.now() - 1500, 1000)).toBe(false);
    expect(isFreshTimestamp(Date.now(), 1000)).toBe(true);
    expect(isFreshTimestamp(null)).toBe(false);
    expect(isFreshTimestamp(undefined)).toBe(false);
    expect(isFreshTimestamp(Number.NaN)).toBe(false);
    expect(isFreshTimestamp('not-a-number' as any)).toBe(false);
  });
});

describe('production ENCRYPTION_KEY guard (F16)', () => {
  beforeEach(() => {
    // sign.ts evaluates the guard at module load time, so we must clear the
    // module cache and re-import under the stubbed env.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENCRYPTION_KEY', '');
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('throws on import when NODE_ENV=production and ENCRYPTION_KEY is unset', async () => {
    await expect(import('../sign?prod=' + Date.now())).rejects.toThrow(
      /ENCRYPTION_KEY is required in production/,
    );
  });
});
