import { describe, it, expect } from 'vitest';
import { resolvePath, formatNumber, formatPercent, formatTime, timeUntil, randomId } from '../utils';

describe('resolvePath', () => {
  it('resolves a flat key', () => {
    expect(resolvePath({ a: 1 }, 'a')).toBe(1);
  });

  it('resolves a nested key', () => {
    expect(resolvePath({ a: { b: { c: 42 } } }, 'a.b.c')).toBe(42);
  });

  it('resolves bracket index', () => {
    expect(resolvePath({ list: [10, 20, 30] }, 'list[1]')).toBe(20);
  });

  it('resolves mixed dot + bracket', () => {
    expect(resolvePath({ data: { items: [{ used: 1 }, { used: 2 }] } }, 'data.items[1].used')).toBe(2);
  });

  it('returns undefined for missing path', () => {
    expect(resolvePath({ a: 1 }, 'a.b.c')).toBeUndefined();
  });

  it('returns undefined on null intermediate', () => {
    expect(resolvePath({ a: null }, 'a.b')).toBeUndefined();
  });

  it('empty path returns the whole object', () => {
    const o = { a: 1 };
    expect(resolvePath(o, '')).toBe(o);
  });
});

describe('formatNumber', () => {
  it('formats with commas', () => {
    expect(formatNumber(1234.5)).toBe('1,234.50');
  });
  it('respects decimals arg', () => {
    expect(formatNumber(3.14159, 4)).toBe('3.1416');
  });
  it('handles null/undefined/NaN', () => {
    expect(formatNumber(null)).toBe('—');
    expect(formatNumber(undefined)).toBe('—');
    expect(formatNumber(NaN)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('prefixes positive numbers with +', () => {
    expect(formatPercent(1.5)).toBe('+1.50%');
  });
  it('preserves negative sign', () => {
    expect(formatPercent(-2.5)).toBe('-2.50%');
  });
  it('returns — for null', () => {
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatTime', () => {
  it('formats a timestamp as HH:MM:SS', () => {
    const d = new Date(2026, 5, 6, 14, 30, 45); // 2026-06-06 14:30:45 local
    expect(formatTime(d.getTime())).toBe('14:30:45');
  });
  it('returns — for null', () => {
    expect(formatTime(null)).toBe('—');
  });
});

describe('timeUntil', () => {
  it('formats future time in m+s', () => {
    const future = Date.now() + 5 * 60_000 + 30_000;
    expect(timeUntil(future)).toMatch(/^5m\d{2}s$/);
  });
  it('formats future time in h+m when over an hour', () => {
    const future = Date.now() + 2 * 3600_000 + 15 * 60_000;
    expect(timeUntil(future)).toBe('2h15m');
  });
  it('returns "now" for past times', () => {
    expect(timeUntil(Date.now() - 1000)).toBe('now');
  });
  it('returns — for null', () => {
    expect(timeUntil(null)).toBe('—');
  });
});

describe('randomId', () => {
  it('returns a non-empty string', () => {
    const id = randomId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(8);
  });

  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomId()));
    expect(ids.size).toBe(1000);
  });
});
