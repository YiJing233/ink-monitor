/**
 * Tests for the widget diagnostics endpoint (GET /api/diagnostics/widgets).
 *
 * The endpoint fans-out into:
 *   - getRequiredUserId (NextAuth session)
 *   - listWidgets / listDashboards (SQLite, mocked here)
 *   - safeValidateManifest (real, since the whole point of the route is to
 *     report per-widget validation outcomes — using the real schema is the
 *     only meaningful test)
 *
 * We mock session + DB to avoid spinning up a real Next.js request context,
 * and let the rest of the route run end-to-end. Pattern mirrors the existing
 * `app/api/dashboards/[id]/__tests__/route.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock hoists above the import statements, so the factory bodies cannot
// reference module-scope variables. Wire up behavior in beforeEach.
const getRequiredUserId = vi.fn();
vi.mock('@/lib/session', () => ({
  getRequiredUserId: () => getRequiredUserId(),
}));

const listWidgets = vi.fn();
const listDashboards = vi.fn();
const latestWidgetResolve = vi.fn();
vi.mock('@/lib/db', () => ({
  listWidgets: (uid: string) => listWidgets(uid),
  listDashboards: (uid: string) => listDashboards(uid),
  latestWidgetResolve: (uid: string, wid: string) => latestWidgetResolve(uid, wid),
}));

import { GET } from '../route';

// A minimal-but-valid manifest: keeps the test independent from
// lib/widgets/registry so the route is exercised against the *real* schema
// with the *real* Zod error formatting. The layout has a single text node
// with a literal value, so no `Bind` indirection is needed.
const VALID_MANIFEST = {
  v: 1,
  id: 'stocks-table',
  name: 'Stocks',
  source: { kind: 'builtin', ref: 'stocks' },
  families: ['2x2'],
  layout: {
    '2x2': { t: 'text', value: 'hello' },
  },
  refresh: 60,
};

// A broken manifest: missing `source` / `families` / `layout` so it fails
// `ManifestSchema`. Stored as the raw JSON string — the route is what
// parses + validates, so we feed it broken data the way a corrupted row
// would look in production.
const BROKEN_MANIFEST = {
  v: 1,
  id: 'broken-widget',
  name: 'Broken',
};

const FAKE_DASHBOARD = {
  id: 'd1',
  user_id: 'user-1',
  name: 'Bedroom',
  base_device: 'kindle-pw',
  // Two devices, two placements (one shares a widgetId across devices, the
  // other is unique) — exercises the distinct-widgetId counting in
  // `widgetCount` and the device-list filtering (empty arrays dropped).
  layouts_json: JSON.stringify({
    'kindle-pw': [
      { id: 'p1', widgetId: 'w-shared', x: 0, y: 0, w: 2, h: 2 },
    ],
    'kindle-oasis': [
      { id: 'p2', widgetId: 'w-shared', x: 0, y: 0, w: 2, h: 2 },
      { id: 'p3', widgetId: 'w-only-oasis', x: 2, y: 0, w: 2, h: 2 },
    ],
    'generic-land': [], // empty device layout — should be filtered out
  }),
  refresh_overrides_json: '{}',
  display_order: 0,
  created_at: 0,
  updated_at: 0,
};

function widgetRow(id: string, manifest: unknown) {
  return {
    id,
    user_id: 'user-1',
    manifest_json: JSON.stringify(manifest),
    config_json: '{}',
    created_at: 0,
    updated_at: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/diagnostics/widgets', () => {
  it('returns 401 when there is no session', async () => {
    getRequiredUserId.mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    const res = await GET();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('unauthorized');
    // Crucially, we must not touch the DB at all when unauthenticated —
    // otherwise an unauth probe would still load the user's widget list
    // and time the response against a populated account.
    expect(listWidgets).not.toHaveBeenCalled();
    expect(listDashboards).not.toHaveBeenCalled();
  });

  it('returns empty widgets + dashboard summary for a fresh user', async () => {
    getRequiredUserId.mockResolvedValueOnce('user-1');
    listWidgets.mockReturnValueOnce([]);
    listDashboards.mockReturnValueOnce([FAKE_DASHBOARD]);
    // No widgets means latestWidgetResolve is never called.
    latestWidgetResolve.mockReturnValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      userId: string;
      widgets: unknown[];
      dashboards: { id: string; name: string; widgetCount: number; devices: string[] }[];
    };
    expect(body.userId).toBe('user-1');
    expect(body.widgets).toEqual([]);
    expect(body.dashboards).toHaveLength(1);
    // widgetCount is the count of *distinct* widgetIds referenced in this
    // dashboard's placements, NOT the count of widget rows. The fake
    // dashboard has 2 distinct ids (w-shared used twice, w-only-oasis
    // once); generic-land is dropped because its array is empty.
    expect(body.dashboards[0]).toEqual({
      id: 'd1',
      name: 'Bedroom',
      widgetCount: 2,
      devices: ['kindle-pw', 'kindle-oasis'],
    });
  });

  it('reports a `fail: ...` validation outcome when a widget has an invalid manifest_json', async () => {
    getRequiredUserId.mockResolvedValueOnce('user-1');
    // Mix a valid widget and a broken one in the same payload: the route
    // must surface both, and must not bail at the first validation error.
    listWidgets.mockReturnValueOnce([
      widgetRow('w-ok', VALID_MANIFEST),
      widgetRow('w-bad', BROKEN_MANIFEST),
    ]);
    listDashboards.mockReturnValueOnce([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      widgets: {
        instanceId: string;
        manifestId: string | null;
        validate: string;
        source: string | null;
        refresh: number | null;
        version: string | null;
        lastResolveMs: null;
        lastError: null;
        lastResolvedAt: null;
      }[];
      dashboards: unknown[];
    };
    expect(body.widgets).toHaveLength(2);

    const byId = Object.fromEntries(body.widgets.map((w) => [w.instanceId, w]));

    // The valid widget comes through as `ok` with the parsed manifest fields
    // surfaced for the diagnostics UI.
    const ok = byId['w-ok'];
    expect(ok).toBeDefined();
    expect(ok.validate).toBe('ok');
    expect(ok.manifestId).toBe('stocks-table');
    expect(ok.source).toBe('builtin');
    expect(ok.refresh).toBe(60);
    expect(ok.version).toBeNull(); // no version in VALID_MANIFEST

    // The broken widget comes through with a `fail: ...` prefix and a
    // best-effort `manifestId` pulled from the raw object so the operator
    // can still identify it. The exact reason text comes from Zod; we don't
    // pin the body because Zod's wording drifts across versions.
    const bad = byId['w-bad'];
    expect(bad).toBeDefined();
    expect(bad.validate.startsWith('fail: ')).toBe(true);
    expect(bad.validate.length).toBeGreaterThan('fail: '.length);
    expect(bad.manifestId).toBe('broken-widget');

    // Telemetry placeholders are reserved for a future `widget_resolve_log`
    // table; they must be `null` so the client can rely on the shape.
    expect(ok.lastResolveMs).toBeNull();
    expect(ok.lastError).toBeNull();
    expect(ok.lastResolvedAt).toBeNull();
    expect(bad.lastResolveMs).toBeNull();
    expect(bad.lastError).toBeNull();
    expect(bad.lastResolvedAt).toBeNull();
  });

  it('surfaces last resolve timing + error from widget_resolve_log', async () => {
    getRequiredUserId.mockResolvedValueOnce('user-1');
    listWidgets.mockReturnValueOnce([widgetRow('w-ok', VALID_MANIFEST)]);
    listDashboards.mockReturnValueOnce([]);
    // The Source layer has run twice for this widget: once successfully
    // (123ms), then once with an HTTP error. latestWidgetResolve returns the
    // newer row. The route must:
    //   - call latestWidgetResolve(userId, widget.id) per widget
    //   - pass ms / error through verbatim
    //   - format the unix-ms ts as an ISO-8601 string in lastResolvedAt
    latestWidgetResolve.mockReturnValueOnce({
      ms: 250,
      error: 'HTTP 503',
      ts: Date.UTC(2026, 6, 9, 12, 0, 0), // 2026-07-09T12:00:00.000Z
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      widgets: {
        instanceId: string;
        lastResolveMs: number | null;
        lastError: string | null;
        lastResolvedAt: string | null;
      }[];
    };

    // The route must look up resolve history per (user, widget).
    expect(latestWidgetResolve).toHaveBeenCalledTimes(1);
    expect(latestWidgetResolve).toHaveBeenCalledWith('user-1', 'w-ok');

    expect(body.widgets).toHaveLength(1);
    const w = body.widgets[0];
    expect(w.instanceId).toBe('w-ok');
    expect(w.lastResolveMs).toBe(250);
    expect(w.lastError).toBe('HTTP 503');
    expect(w.lastResolvedAt).toBe('2026-07-09T12:00:00.000Z');
  });
});
