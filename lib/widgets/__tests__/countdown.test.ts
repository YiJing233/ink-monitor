/**
 * Pure-function tests for the countdown source resolver.
 *
 * Contracts:
 *   - `target` accepted as number | string (ISO) | Date | null/undefined.
 *   - `days` is whole-day floor of remaining time; negative once expired.
 *   - `hours` is hours inside the remaining day, clamped to 0 when expired.
 *   - `label` defaults to "Countdown" when omitted.
 *   - `target` echoed back as ms since epoch when input is parseable, else 0.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../ir';
import countdownManifest from '../manifests/countdown.json';
import { resolveCountdownSource } from '../builtin-sources';

const ONE_DAY = 86_400_000;
const ONE_HOUR = 3_600_000;

describe('resolveCountdownSource', () => {
  it('computes days/hours for a future target 30 days out', () => {
    const future = Date.now() + 30 * ONE_DAY + 4 * ONE_HOUR;
    const out = resolveCountdownSource(future, 'Launch Day');
    expect(out.days).toBe(30);
    expect(out.hours).toBe(4);
    expect(out.label).toBe('Launch Day');
    expect(out.target).toBe(future);
  });

  it('clamps hours to 0 (and reports negative days) once expired', () => {
    const past = Date.now() - 2 * ONE_DAY - 5 * ONE_HOUR;
    const out = resolveCountdownSource(past, 'Past Event');
    expect(out.days).toBeLessThanOrEqual(-1);
    expect(out.hours).toBe(0);
    expect(out.label).toBe('Past Event');
    expect(out.target).toBe(past);
  });

  it('returns 0/0 when target is exactly now (boundary, not expired)', () => {
    // A `Date` instance pointing at the current instant in `Date.now()` terms
    // should floor to days=0, hours=0 — there is no remaining millisecond.
    const now = Date.now();
    const out = resolveCountdownSource(now, 'Right Now');
    expect(out.days).toBeLessThanOrEqual(0);
    expect(out.hours).toBe(0);
    expect(out.target).toBe(now);
  });

  it('accepts ISO date strings and Date instances, round-tripping to ms', () => {
    const targetMs = Date.now() + 14 * ONE_DAY + 30 * 60 * 1000;
    const iso = new Date(targetMs).toISOString();
    const fromIso = resolveCountdownSource(iso, 'ISO');
    const fromDate = resolveCountdownSource(new Date(targetMs), 'Date');
    expect(fromIso.target).toBe(targetMs);
    expect(fromDate.target).toBe(targetMs);
    expect(fromIso.days).toBe(14);
    expect(fromIso.hours).toBe(0); // 30 min < 1h, so hours inside the day = 0
  });

  it('falls back to 0/0 + zero target when input is missing or unparseable', () => {
    expect(resolveCountdownSource(undefined).days).toBe(0);
    expect(resolveCountdownSource(undefined).hours).toBe(0);
    expect(resolveCountdownSource(undefined).target).toBe(0);
    expect(resolveCountdownSource('not a date').target).toBe(0);
    expect(resolveCountdownSource('not a date').days).toBe(0);
    expect(resolveCountdownSource(null, 'Fallback').label).toBe('Fallback');
  });

  it('defaults the label to "Countdown" when omitted', () => {
    const future = Date.now() + ONE_DAY;
    const out = resolveCountdownSource(future);
    expect(out.label).toBe('Countdown');
  });

  it('the built-in countdown manifest validates against the IR schema', () => {
    const m = validateManifest(countdownManifest);
    expect(m.id).toBe('countdown');
    expect(m.version).toBe('0.1.0');
    expect(m.source).toEqual({ kind: 'owned', store: 'settings:countdown:{{instanceId}}' });
    expect(m.families).toEqual(['1x1', '2x2']);
  });
});
