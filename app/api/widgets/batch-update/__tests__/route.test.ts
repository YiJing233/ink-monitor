/**
 * Tests for POST /api/widgets/batch-update.
 *
 * Covered:
 *   1. No session → 401 before any DB read or write (the auth gate is the
 *      first thing the route does; failing it must not touch `audit` or
 *      `db`).
 *   2. Authenticated + a payload { dashboardId: 'd1' } with one upgrade
 *      candidate → 200 and `updated: 1`. Asserts that:
 *        - `updateWidget` is called once with the new manifest_json
 *        - `upsertUserManifest` mirrors the new manifest into the library
 *          with `origin='installed'` preserved
 *        - `recordAudit` fires a `widget.update` row whose `after` includes
 *          `auto_update: true` and the from/to versions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Audit capture (recordAudit is module-imported by the route) ------------
//
// `vi.mock` hoists above the import statements, so we can't close over outer
// state from the factory. We push to a module-scoped array via a simple
// `vi.fn()` shim; tests reset it in `beforeEach`.
const auditCalls: any[] = [];
vi.mock('@/lib/audit', () => ({
  recordAudit: vi.fn((e: any) => {
    auditCalls.push(e);
  }),
  listAudit: vi.fn(),
  parseAuditEntry: vi.fn(),
}));

// --- Session stub -----------------------------------------------------------
//
// Mocked to return the same id used in the seed widget row below so the
// route's owner-scoped reads see a row.
vi.mock('@/lib/session', () => ({
  getRequiredUserId: vi.fn(async () => 'user-self'),
  getCurrentUserId: vi.fn(async () => 'user-self'),
}));

// --- DB stubs --------------------------------------------------------------
//
// Only the exports the route touches are listed. The route imports
// `findAvailableUpdates` from `@/lib/widgets/auto-update`; the real
// implementation runs (we don't mock it here) but operates against our
// stubbed widget / user_manifest rows.
const FAKE_DASHBOARD = {
  id: 'd1',
  user_id: 'user-self',
  name: 'main',
  base_device: 'kindle-pw',
  layouts_json: JSON.stringify({ 'kindle-pw': [{ widgetId: 'w1', x: 0, y: 0, w: 2, h: 2 }] }),
  refresh_overrides_json: '{}',
  display_order: 0,
  created_at: 0,
  updated_at: 0,
};

const FAKE_WIDGET = {
  id: 'w1',
  user_id: 'user-self',
  manifest_json: JSON.stringify({ v: 1, id: 'london-weather', name: 'London Weather', version: '0.2.0' }),
  config_json: '{}',
  created_at: 0,
  updated_at: 0,
};

const FAKE_USER_MANIFEST = {
  id: 'um1',
  user_id: 'user-self',
  manifest_id: 'london-weather',
  manifest_json: JSON.stringify({ v: 1, id: 'london-weather', name: 'London Weather', version: '0.2.0' }),
  origin: 'installed',
  created_at: 0,
  updated_at: 0,
};

const updateWidget = vi.fn();
const upsertUserManifest = vi.fn();
const getDashboard = vi.fn(() => FAKE_DASHBOARD);
const listWidgets = vi.fn(() => [FAKE_WIDGET]);
const listUserManifests = vi.fn(() => [FAKE_USER_MANIFEST]);
const listDashboards = vi.fn(() => [FAKE_DASHBOARD]);

vi.mock('@/lib/db', () => ({
  getDashboard: () => getDashboard(),
  listDashboards: () => listDashboards(),
  listWidgets: () => listWidgets(),
  listUserManifests: () => listUserManifests(),
  updateWidget: (uid: string, id: string, patch: Record<string, unknown>) => updateWidget(uid, id, patch),
  upsertUserManifest: (uid: string, mid: string, json: string, origin: string) =>
    upsertUserManifest(uid, mid, json, origin),
  // Anything else the imports might pull in: list/get/insert/delete/etc.
  getWidget: vi.fn(),
  insertWidget: vi.fn(),
  deleteWidget: vi.fn(),
  getUserManifest: vi.fn(),
  deleteUserManifest: vi.fn(),
  insertDashboard: vi.fn(),
  updateDashboard: vi.fn(),
  deleteDashboard: vi.fn(),
}));

// --- Stub the registry fetch so findAvailableUpdates sees a newer version ---
//
// `findAvailableUpdates` is imported by the route; it calls `fetch('/api/market')`
// by default. We stub global `fetch` so the test stays fully in-process.
const REMOTE = {
  items: [
    {
      manifest: {
        v: 1,
        id: 'london-weather',
        name: 'London Weather',
        version: '0.3.0',
        source: { kind: 'demo', data: {} },
        families: ['2x2'],
        layout: { '2x2': { t: 'text', value: 'updated' } },
      },
      version: '0.3.0',
    },
  ],
};
const origFetch = globalThis.fetch;
beforeEach(() => {
  vi.clearAllMocks();
  auditCalls.length = 0;
  updateWidget.mockReset();
  upsertUserManifest.mockReset();
  getDashboard.mockReset();
  listWidgets.mockReset();
  listUserManifests.mockReset();
  listDashboards.mockReset();
  // Restore the default seed for the "happy path" test.
  getDashboard.mockImplementation(() => FAKE_DASHBOARD);
  listDashboards.mockImplementation(() => [FAKE_DASHBOARD]);
  listWidgets.mockImplementation(() => [FAKE_WIDGET]);
  listUserManifests.mockImplementation(() => [FAKE_USER_MANIFEST]);
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => REMOTE })) as unknown as typeof fetch;
});
// (afterEach not used: test isolation handled by beforeEach.)

import { POST } from '../route';

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/widgets/batch-update', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/widgets/batch-update', () => {
  it('returns 401 when there is no session, without touching db or audit', async () => {
    // Override the session stub for this case only.
    const sessionMod = (await import('@/lib/session')) as unknown as { getRequiredUserId: ReturnType<typeof vi.fn> };
    vi.mocked(sessionMod.getRequiredUserId).mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    const res = await POST(makeReq({ dashboardId: 'd1' }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('unauthorized');
    // Crucially: we must not have read or written anything while unauthorized.
    expect(updateWidget).not.toHaveBeenCalled();
    expect(upsertUserManifest).not.toHaveBeenCalled();
    expect(auditCalls).toHaveLength(0);
  });

  it('returns 200 + updated:1 for a session with one upgradable widget on the active dashboard', async () => {
    const res = await POST(makeReq({ dashboardId: 'd1' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      updated: number;
      updates: Array<{ widgetId: string; manifestId: string; installedVersion: string | null; latestVersion: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.updated).toBe(1);
    expect(body.updates).toEqual([
      { widgetId: 'w1', manifestId: 'london-weather', installedVersion: '0.2.0', latestVersion: '0.3.0' },
    ]);

    // The DB write: the widget row was updated with the *new* manifest JSON.
    expect(updateWidget).toHaveBeenCalledTimes(1);
    const [uid, wid, patch] = updateWidget.mock.calls[0] as [string, string, { manifest_json: string }];
    expect(uid).toBe('user-self');
    expect(wid).toBe('w1');
    const written = JSON.parse(patch.manifest_json) as { id?: string; version?: string };
    expect(written.id).toBe('london-weather');
    expect(written.version).toBe('0.3.0');

    // The user_manifests mirror: keeps `installed` origin (not `custom`).
    expect(upsertUserManifest).toHaveBeenCalledTimes(1);
    const [uid2, mid, json, origin] = upsertUserManifest.mock.calls[0] as [string, string, string, string];
    expect(uid2).toBe('user-self');
    expect(mid).toBe('london-weather');
    expect(JSON.parse(json).version).toBe('0.3.0');
    expect(origin).toBe('installed');

    // Audit row: action 'widget.update', target the widget instance, with
    // the auto_update flag + from/to for downstream filtering.
    expect(auditCalls).toHaveLength(1);
    const a = auditCalls[0] as {
      action: string;
      targetType: string;
      targetId: string;
      after: { auto_update: boolean; from: string | null; to: string };
    };
    expect(a.action).toBe('widget.update');
    expect(a.targetType).toBe('widget');
    expect(a.targetId).toBe('w1');
    expect(a.after.auto_update).toBe(true);
    expect(a.after.from).toBe('0.2.0');
    expect(a.after.to).toBe('0.3.0');
  });

  it('returns 200 + updated:0 when nothing on the dashboard qualifies (registry carries same version)', async () => {
    // Swap the registry payload so the manifest's own `version` field matches
    // the installed version. `findAvailableUpdates` reads `manifest.version`
    // first (the registry wrapper sometimes adds a redundant outer `version`,
    // but the canonical source is the embedded one) — so we override that.
    const sameVersionRemote = {
      items: [
        {
          ...REMOTE.items[0],
          manifest: { ...REMOTE.items[0].manifest, version: '0.2.0' },
        },
      ],
    };
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => sameVersionRemote,
    })) as unknown as typeof fetch;
    const res = await POST(makeReq({ dashboardId: 'd1' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { updated: number };
    expect(body.updated).toBe(0);
    expect(updateWidget).not.toHaveBeenCalled();
    expect(upsertUserManifest).not.toHaveBeenCalled();
    expect(auditCalls).toHaveLength(0);
  });
});
