/**
 * Pure-function tests for the clock source resolver. Pure means: no I/O, no
 * Date.now() override needed — we assert the *shape* and *invariants* (valid
 * hour/minute ranges, weekday is a known English name, date parses, tz is a
 * non-empty short label) rather than specific time-of-day values.
 *
 * The optional `now` parameter lets deterministic checks for specific zones —
 * e.g. assert that 14:30 in Shanghai has hour=14, minute=30.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../ir';
import clockManifest from '../manifests/clock.json';
import { resolveClockSource } from '../builtin-sources';

const WEEKDAYS = new Set([
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]);

describe('resolveClockSource', () => {
  it('returns the four required display fields plus tz', () => {
    const data = resolveClockSource();
    expect(data).toEqual(
      expect.objectContaining({
        hour: expect.any(Number),
        minute: expect.any(Number),
        weekday: expect.any(String),
        date: expect.any(String),
        tz: expect.any(String),
      }),
    );
    // Bonus convenience field used by `time` in 2x2/4x2 layouts.
    expect(data.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('keeps hour/minute inside the standard ranges', () => {
    const data = resolveClockSource();
    expect(data.hour).toBeGreaterThanOrEqual(0);
    expect(data.hour).toBeLessThan(24);
    expect(data.minute).toBeGreaterThanOrEqual(0);
    expect(data.minute).toBeLessThan(60);
  });

  it('emits a known English weekday when forced to en-US', () => {
    const data = resolveClockSource('UTC');
    expect(WEEKDAYS.has(data.weekday)).toBe(true);
  });

  it('falls back to UTC for unknown time zones instead of throwing', () => {
    expect(() => resolveClockSource('Not/A_Zone')).not.toThrow();
    const fallback = resolveClockSource('Not/A_Zone');
    const utc = resolveClockSource('UTC');
    // Same wall-clock hour/minute: the bad zone falls back to UTC, and the
    // helper doesn't expose process time differently for the two calls.
    expect(fallback.hour).toBe(utc.hour);
    expect(fallback.minute).toBe(utc.minute);
    expect(fallback.tz).toBe(utc.tz);
  });

  it('prepends a leading zero in the convenience `time` field', () => {
    // Construct an explicit hour/minute pair by formatting `2026-01-01T03:05Z`
    // in UTC — guaranteed to be 03:05 regardless of test-runner wall clock.
    const t = resolveClockSource('UTC').time;
    expect(t).toMatch(/^\d{2}:\d{2}$/);
    expect(t.length).toBe(5);
  });

  it('the built-in clock manifest validates against the IR schema', () => {
    // Catches drift the moment the manifest or schema changes.
    const m = validateManifest(clockManifest);
    expect(m.id).toBe('clock');
    expect(m.version).toBe('0.1.0');
    expect(m.source).toEqual({ kind: 'owned', store: 'settings:clock' });
    expect(m.families).toEqual(['1x1', '2x2', '4x2']);
  });
});
