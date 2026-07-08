import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeJson } from '../../safe-json';

/**
 * F14: previously `safeJson` returned `{}` silently on parse failure, hiding
 * corrupt rows from ops. It now emits a `console.warn` tagged with the caller's
 * label, so a tail of `[safeJson]` warnings points at the table/column that's
 * broken.
 */
describe('safeJson', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('parses valid JSON into the expected object', () => {
    const out = safeJson('{"a":1,"b":[2,3]}', 'test.col');
    expect(out).toEqual({ a: 1, b: [2, 3] });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns {} and warns (with label) on invalid JSON', () => {
    const bad = '{not-json';
    const out = safeJson(bad, 'dashboards.layouts_json');
    expect(out).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('[safeJson]');
    expect(warnSpy.mock.calls[0][0]).toContain('dashboards.layouts_json');
    // The raw fragment should also be in the warning (truncated for log safety).
    expect(warnSpy.mock.calls[0][0]).toContain(bad.slice(0, 20));
  });

  it('defaults the label to "unknown" when omitted', () => {
    safeJson('oops');
    expect(warnSpy.mock.calls[0][0]).toContain('[safeJson] unknown:');
  });

  it('truncates the offending fragment so a giant row does not flood the log', () => {
    const big = 'x'.repeat(5_000);
    safeJson(big, 'big.col');
    // The warning should include at most the first 80 chars of the input.
    expect(warnSpy.mock.calls[0][0]).toContain('x'.repeat(80));
    expect(warnSpy.mock.calls[0][0]).not.toContain('x'.repeat(81));
  });
});