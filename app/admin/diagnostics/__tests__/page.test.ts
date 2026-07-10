/**
 * Tests for the /admin/diagnostics page (server component).
 *
 * The page does three things:
 *   1. Resolves the current user (NextAuth session) and redirects to
 *      /signin if there's no session.
 *   2. Fetches `/api/diagnostics/widgets` (same process) and threads the
 *      payload into a client island.
 *   3. Computes a static "platform health" snapshot (DB connectivity,
 *      album store type, SSRF guard, Node version, uptime).
 *
 * We mock the heavy bits — NextAuth, `next/headers`, `lib/db`, and
 * `globalThis.fetch` — and render the resulting React tree with
 * `react-dom/server`'s `renderToString`. Asserting on the rendered HTML
 * confirms the page wires up the data correctly and exercises the
 * ≥3 widget rows + top-level platform health section as required.
 *
 * The page's client component is `use client`; in this test it's server-
 * rendered as a plain React element (its hooks would not run on the
 * server). The rendered HTML still contains the initial payload because
 * that's what we hand to the component via props.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';

// vi.mock factories hoist above the imports, so all behavior must be wired
// via module-scope `vi.fn()` variables that the factory returns.
const getCurrentUserId = vi.fn();
const cookies = vi.fn();
const headers = vi.fn();
const getDb = vi.fn();
const redirect = vi.fn((url: string) => {
  // `redirect()` from `next/navigation` throws a special error that
  // Next.js catches at the framework boundary. In a unit-test render
  // context we surface it as a regular Error so the assertion in the
  // "no session" test can detect the redirect target.
  throw new Error(`REDIRECT:${url}`);
});

vi.mock('next/headers', () => ({
  cookies: () => cookies(),
  headers: () => headers(),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
}));

vi.mock('@/lib/session', () => ({
  getCurrentUserId: () => getCurrentUserId(),
}));

vi.mock('@/lib/db', () => ({
  // Don't actually open SQLite in the test — return a fake `prepare()` that
  // round-trips a trivial `SELECT 1` so the page's DB-probe path reports OK.
  getDb: () => getDb(),
}));

import DiagnosticsPage from '../page';

const FAKE_WIDGETS_PAYLOAD = {
  userId: 'user-1',
  locale: 'en',
  widgets: [
    {
      instanceId: 'w-1',
      manifestId: 'clock',
      version: '1.0.0',
      validate: 'ok',
      source: 'builtin',
      refresh: 60,
      lastResolveMs: 42,
      lastError: null,
      lastResolvedAt: '2026-07-08T10:00:00.000Z',
    },
    {
      instanceId: 'w-2',
      manifestId: 'weather',
      version: '0.9.1',
      validate: 'ok',
      source: 'http',
      refresh: 300,
      lastResolveMs: 250,
      lastError: null,
      lastResolvedAt: '2026-07-08T10:01:00.000Z',
    },
    {
      instanceId: 'w-3',
      manifestId: 'notes',
      version: '1.2.0',
      validate: 'fail: missing source',
      source: null,
      refresh: null,
      lastResolveMs: null,
      lastError: null,
      lastResolvedAt: null,
    },
    {
      instanceId: 'w-4',
      manifestId: 'countdown',
      version: '2.0.0',
      validate: 'ok',
      source: 'owned',
      refresh: 120,
      lastResolveMs: 88,
      lastError: 'HTTP 503',
      lastResolvedAt: '2026-07-08T09:58:30.000Z',
    },
  ],
  dashboards: [
    {
      id: 'd-1',
      name: 'Bedroom',
      widgetCount: 3,
      devices: ['kindle-pw', 'kindle-oasis'],
    },
    {
      id: 'd-2',
      name: 'Kitchen',
      widgetCount: 1,
      devices: ['kindle-basic'],
    },
  ],
};

// Minimal `Response`-shaped object that satisfies the page's `fetch` contract
// (we only read `ok` and `json()`).
function fakeJsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default session = authenticated. Individual tests override as needed.
  getCurrentUserId.mockResolvedValue('user-1');
  // `cookies()` and `headers()` are awaited in the page; return empty
  // record-like objects so `resolveLocale(...)` falls back to 'en'.
  cookies.mockResolvedValue({ get: () => undefined });
  headers.mockResolvedValue({ get: () => null });
  // `getDb()` returns an object with a `prepare(...).get()` chain that
  // reports a successful `SELECT 1` round-trip.
  getDb.mockReturnValue({
    prepare: () => ({
      get: () => ({ ok: 1 }),
    }),
  });
  // Mock the same-process fetch that loads the diagnostics payload.
  fetchMock = vi.fn(async () => fakeJsonResponse(FAKE_WIDGETS_PAYLOAD));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe('/admin/diagnostics page', () => {
  it('redirects to /signin when there is no authenticated user', async () => {
    getCurrentUserId.mockResolvedValueOnce(null);

    let caught: Error | null = null;
    try {
      // The page returns a promise; renderToString would attempt to await it
      // and call the inner redirect, which throws. We catch and assert.
      await renderToString(await DiagnosticsPage());
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(String(caught?.message || '')).toMatch(/REDIRECT:\/signin/);
    // The page must not have called the diagnostics endpoint — we have no
    // session, so the redirect fires before the API call.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renders the platform health section + ≥3 widget rows from the diagnostics payload', async () => {
    const html = renderToString(await DiagnosticsPage());

    // The diagnostics endpoint must have been hit exactly once for the
    // initial server render — confirms the page is wired to /api/diagnostics.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/diagnostics\/widgets$/);
    expect(init?.cache).toBe('no-store');

    // The platform-health section header is in the page.
    expect(html).toContain('Platform health');

    // The four fake widgets all render — ≥3 as the test contract requires.
    // We assert on the manifestId (the human-facing name) and the
    // instanceId (the unique row key) so a future rename of either
    // doesn't silently break the test.
    expect(html).toContain('clock');
    expect(html).toContain('weather');
    expect(html).toContain('notes');
    expect(html).toContain('countdown');
    expect(html).toContain('w-1');
    expect(html).toContain('w-2');
    expect(html).toContain('w-3');
    expect(html).toContain('w-4');

    // The failing widget's `validate` string flows through verbatim — the
    // server doesn't normalize it, it just renders what the API returned.
    expect(html).toContain('fail: missing source');

    // Dashboard rows also render — the Bedrom + Kitchen dashboards seeded
    // in the fake payload. widgetCount surfaces as a pill.
    expect(html).toContain('Bedroom');
    expect(html).toContain('Kitchen');
    expect(html).toContain('kindle-pw');
    expect(html).toContain('kindle-oasis');
    expect(html).toContain('kindle-basic');
  });

  it('surfaces a stale-error widget as visually distinct from healthy ones', async () => {
    // The fake payload includes `countdown` with lastResolveMs=88 +
    // lastError='HTTP 503'. The page must surface both so an operator can
    // see "this widget resolved, but it errored". We assert on the error
    // string and the millisecond timing pill.
    const html = renderToString(await DiagnosticsPage());

    expect(html).toContain('HTTP 503');
    // The timing pill renders as `<span class="pill">88<!-- -->ms</span>` —
    // React inserts a comment between adjacent text nodes so the prefix
    // can be hot-swapped at hydration. We assert on the numeric value
    // alone plus the surrounding pill markup rather than the exact text.
    expect(html).toMatch(/<span class="pill">88<!--\s*-->ms<\/span>/);
    // A widget that has never resolved (notes) surfaces a "never" badge —
    // not a millisecond value — so the operator can distinguish "fast
    // failure" from "never tried".
    expect(html).toContain('never');
  });

  it('shows an error banner when /api/diagnostics/widgets is unreachable', async () => {
    // Simulate a network failure during the same-process fetch. The page
    // catches the exception and renders an error banner instead of the
    // tables.
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const html = renderToString(await DiagnosticsPage());

    // The localized error string must surface — `admin.diag.loadFailed`
    // is `{message}`-templated, so the actual error text appears in HTML.
    expect(html).toContain('ECONNREFUSED');
    // We must NOT have rendered the healthy widget rows when the API
    // call failed — the error banner replaces them.
    expect(html).not.toContain('clock');
    expect(html).not.toContain('Bedroom');
  });
});