import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * F24: the registry asserts at module-load time (dev only) that every
 * BUILTIN_MANIFESTS id has a matching SAMPLE_DATA entry. A missing key would
 * render an empty widget in `/preview` and `/admin/canvas` gallery cards, but
 * TypeScript can't catch it (two unrelated records). We verify the assert
 * here by mocking sample-data with one key removed and re-importing registry.
 *
 * `vi.mock` factories are hoisted to the top of the file — they cannot close
 * over outer-scope variables. So we hardcode the manifest id we drop instead
 * of computing it from the registry.
 */
const MISSING_ID = 'api-usage';

vi.mock('../manifests/sample-data', async () => {
  const real = await vi.importActual<typeof import('../manifests/sample-data')>(
    '../manifests/sample-data',
  );
  // Strip one id deterministically; everything else stays intact so the
  // registry's own module body (which calls resolveClockSource etc.) still
  // loads cleanly under this mock.
  const { [MISSING_ID]: _drop, ...rest } = real.SAMPLE_DATA;
  return { ...real, SAMPLE_DATA: rest };
});

describe('registry sample-data cross-check', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The module-load assert runs only when NODE_ENV !== 'production'. Vitest
    // sets NODE_ENV='test' by default, which already satisfies that.
    vi.resetModules();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.resetModules();
  });

  it('warns when a built-in manifest id has no SAMPLE_DATA entry', async () => {
    await import('../registry');
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes(`[registry] missing SAMPLE_DATA for "${MISSING_ID}"`))).toBe(true);
  });

  it('does NOT warn when every built-in id has a SAMPLE_DATA entry', async () => {
    // Re-mock sample-data with the full payload by overriding the factory for
    // this single test via vi.doMock (not hoisted).
    vi.doUnmock('../manifests/sample-data');
    await import('../registry');
    await import('../registry');
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.startsWith('[registry] missing SAMPLE_DATA'))).toBe(false);
  });
});