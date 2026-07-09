/**
 * Tests for GET /api/display/widget — the per-instance patch slice the SSE
 * `patch` event fetches. We mock the auth + DB layers and let the real route
 * + the real Source/Renderer pipeline run end-to-end.
 *
 * Coverage:
 *   1. No session AND no `?share=` → 401 JSON. Same shape as the stream
 *      route's auth gate — unauthenticated probes must not return a stream
 *      or partial HTML (which could leak per-user data via a tile header).
 *   2. Session auth + valid instance id → 200, Content-Type text/html,
 *      body contains the `data-w-inst="<id>"` locator the client uses to
 *      splice the slice back into the live DOM via outerHTML.
 *   3. Session auth + instance id that doesn't appear in any of the user's
 *      dashboards → 404 JSON. The SSE patcher treats !ok as "no slice;
 *      full reload" so a 404 is the right granularity — and is also
 *      semantically distinguishable from a transient 5xx.
 *
 * The widget-row manifest is a real `Manifest` shape (`api-usage` ref would
 * issue a real HTTP fetch — we use `demo` source here so the test stays
 * hermetic and fast). The renderer flow is what we care about, not the
 * upstream data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/session', () => ({
  getCurrentUserId: vi.fn(async () => null),
  getUserIdFromShareToken: vi.fn(async () => null),
}));

const listDashboards = vi.fn();
const getWidget = vi.fn();
vi.mock('@/lib/db', () => ({
  listDashboards: (uid: string) => listDashboards(uid),
  getWidget: (uid: string, id: string) => getWidget(uid, id),
}));

import { GET } from '../route';
import { NextRequest } from 'next/server';

function makeReq(qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/display/widget${qs}`, { method: 'GET' });
}

// A real, validated-by-Zod manifest with a `demo` source — keeps resolveSource
// hermetic (no HTTP fetch, no DB read).
const DEMO_MANIFEST = {
  v: 1,
  id: 'demo-clock',
  name: 'Demo Clock',
  source: { kind: 'demo', data: { label: 'patch-test' } },
  families: ['2x2'],
  layout: {
    '2x2': { t: 'text', value: 'hello-from-patch' },
  },
  refresh: 30,
};

const FAKE_DASHBOARD = {
  id: 'd1',
  user_id: 'user-1',
  name: 'Bedroom',
  base_device: 'kindle-pw',
  layouts_json: JSON.stringify({
    'kindle-pw': [
      { id: 'inst-1', widgetId: 'wid-1', x: 0, y: 0, w: 2, h: 2 },
      { id: 'inst-2', widgetId: 'wid-2', x: 2, y: 0, w: 2, h: 2 },
    ],
  }),
  refresh_overrides_json: '{}',
  display_order: 0,
  created_at: 0,
  updated_at: 0,
};

function widgetRow(id: string) {
  return {
    id,
    user_id: 'user-1',
    manifest_json: JSON.stringify(DEMO_MANIFEST),
    config_json: '{}',
    created_at: 0,
    updated_at: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/display/widget — auth gate', () => {
  it('returns 401 JSON when neither session nor share token resolves a user', async () => {
    const res = await GET(makeReq('?instance=inst-1'));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('auth required');
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});

describe('GET /api/display/widget — authed response shape', () => {
  it('returns 200 + text/html containing data-w-inst for a valid instance', async () => {
    const sessionMod = await import('@/lib/session');
    (sessionMod.getCurrentUserId as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('user-1');
    listDashboards.mockReturnValueOnce([FAKE_DASHBOARD]);
    getWidget.mockImplementation((_uid: string, id: string) => widgetRow(id));

    const res = await GET(makeReq('?instance=inst-1'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    // Per-tile HTML must NOT be cached — a stale slice would replay the
    // previous tick's data on the next patch.
    expect(res.headers.get('cache-control')).toMatch(/no-store/);

    const html = await res.text();
    // The locator key the client uses to splice this slice back must be
    // present in the response. Without it the SSE patcher would replace a
    // random node and lose every subsequent patch for this tile.
    expect(html).toContain('data-w-inst="inst-1"');
    // And the renderer must have actually run — the demo manifest's text
    // node value should appear in the output. (renderToStaticMarkup of a
    // text node includes the literal value.)
    expect(html).toContain('hello-from-patch');
  });

  it('returns 404 JSON for an instance id the user does not own', async () => {
    const sessionMod = await import('@/lib/session');
    (sessionMod.getCurrentUserId as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('user-1');
    listDashboards.mockReturnValueOnce([FAKE_DASHBOARD]);
    // No getWidget needed — the placement lookup fails before any widget row
    // is read, because no dashboard has a placement with id `ghost`.
    getWidget.mockImplementation(() => undefined);

    const res = await GET(makeReq('?instance=ghost'));

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('widget instance not found');
  });
});
