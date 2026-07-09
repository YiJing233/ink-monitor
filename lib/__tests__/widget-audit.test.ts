/**
 * Audit emission tests for widget-platform write endpoints.
 *
 * Each case drives a real route handler with a mocked `@/lib/session` +
 * `@/lib/db` + (where needed) crypto deps, and asserts that `recordAudit`
 * fires with the expected action / targetType / targetId / payload. We mock
 * the audit helper itself so the assertions are pure call inspections -- no
 * need to spin up SQLite.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Audit capture -----------------------------------------------------------
//
// `vi.mock` hoists to the top of the file, before any imports. The factory
// body can't close over module-scope vars, so we expose a mutable array via
// a symbol the route modules can push into. The test resets the array in
// beforeEach, then reads it through the mocked `recordAudit` arg shape.
const auditCalls: any[] = [];
vi.mock('@/lib/audit', () => ({
  recordAudit: vi.fn((e: any) => {
    auditCalls.push(e);
  }),
  listAudit: vi.fn(),
  parseAuditEntry: vi.fn(),
}));

// --- Session stub ------------------------------------------------------------
vi.mock('@/lib/session', () => ({
  getRequiredUserId: vi.fn(async () => 'user-1'),
}));

// --- Route-level DB + crypto stubs -------------------------------------------
//
// Only the helpers each route touches are listed here. Tests can re-stub
// individual fns by importing the mock via `vi.mocked()` and reassigning
// per-case -- see the dashboard PUT case below for an example.

vi.mock('@/lib/db', () => ({
  // widgets
  listWidgets: vi.fn(() => []),
  getWidget: vi.fn(),
  insertWidget: vi.fn(),
  updateWidget: vi.fn(),
  deleteWidget: vi.fn(),
  // manifests
  listUserManifests: vi.fn(() => []),
  getUserManifest: vi.fn(),
  upsertUserManifest: vi.fn(),
  deleteUserManifest: vi.fn(),
  // dashboards
  listDashboards: vi.fn(() => []),
  getDashboard: vi.fn(() => FAKE_DASHBOARD),
  insertDashboard: vi.fn(),
  updateDashboard: vi.fn(),
  deleteDashboard: vi.fn(),
  // secrets
  listWidgetSecretNames: vi.fn(() => []),
  setWidgetSecret: vi.fn(),
  getWidgetSecret: vi.fn(),
  deleteWidgetSecret: vi.fn(),
  // save/GC: used by dashboards PUT
  withTx: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('@/lib/crypto', () => ({
  encryptForUser: vi.fn((_uid: string, v: string) => `enc(${v.length})`),
}));

// Album store: in-memory map keeps the test fully in-process and lets us
// observe `before` shape (item_count) without touching disk/blob SDKs.
const albumStoreState = new Map<string, any[]>();
const stubAlbumStore = {
  list: vi.fn(async (_uid: string, name: string) => albumStoreState.get(name) ?? []),
  set: vi.fn(async (_uid: string, name: string, items: any[]) => {
    albumStoreState.set(name, [...items]);
  }),
  addFile: vi.fn(),
  removeFile: vi.fn(),
};
vi.mock('@/lib/widgets/album-store', () => ({
  getAlbumStore: () => stubAlbumStore,
  isUploadSupported: () => false,
  AlbumStoreError: class AlbumStoreError extends Error {},
}));

import { recordAudit } from '@/lib/audit';
import * as db from '@/lib/db';

// Route imports AFTER the mocks above.
import { POST as widgetsPost } from '@/app/api/widgets/route';
import { PATCH as widgetsPatch, DELETE as widgetsDelete } from '@/app/api/widgets/[id]/route';
import { POST as manifestsPost } from '@/app/api/manifests/route';
import { DELETE as manifestsDelete } from '@/app/api/manifests/[id]/route';
import { POST as secretsPost, DELETE as secretsDelete } from '@/app/api/widget-secrets/route';
import { POST as dashboardsPost } from '@/app/api/dashboards/route';
import { PATCH as dashboardsPatch, PUT as dashboardsPut, DELETE as dashboardsDelete } from '@/app/api/dashboards/[id]/route';
import { POST as albumsPost, DELETE as albumsDelete } from '@/app/api/albums/[name]/route';

const FAKE_DASHBOARD = {
  id: 'd1',
  user_id: 'user-1',
  name: 'Test',
  base_device: 'kindle-pw',
  layouts_json: '{}',
  refresh_overrides_json: '{}',
  display_order: 0,
  created_at: 0,
  updated_at: 0,
};

// Smallest valid manifest the IR validator accepts. Mirrors the shape of the
// `api-usage` built-in (which the dashboard-PUT test in
// `app/api/dashboards/[id]/__tests__/route.test.ts` also references), so the
// routes' `safeValidateManifest` call returns `success: true`.
const MIN_MANIFEST = {
  v: 1,
  id: 'api-usage',
  name: 'API Usage',
  source: { kind: 'builtin', ref: 'provider' },
  families: ['1x1'],
  layout: {
    '1x1': { t: 'bignum', value: { '$': 'used_pct' }, unit: '%' },
  },
  refresh: 300,
} as const;

function makeJsonReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

function makeJsonReqMethod(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
  });
}

function lastAudit() {
  expect(auditCalls.length).toBeGreaterThan(0);
  return auditCalls[auditCalls.length - 1];
}

beforeEach(() => {
  auditCalls.length = 0;
  vi.clearAllMocks();
  // Reset stubs that some tests rely on (vi.clearAllMocks only clears call
  // history, not return values -- reassert the common ones each case).
  vi.mocked(db.getDashboard).mockReturnValue(FAKE_DASHBOARD as any);
  stubAlbumStore.set.mockClear();
  stubAlbumStore.list.mockClear();
  albumStoreState.clear();
});

describe('widget.create -- POST /api/widgets', () => {
  it('records widget.create with manifest_id after insertion', async () => {
    const req = makeJsonReq('http://localhost/api/widgets', {
      manifest: MIN_MANIFEST,
      config: { x: 1 },
    });
    const res = await widgetsPost(req);
    expect(res.status).toBe(200);
    const audit = lastAudit();
    expect(audit.action).toBe('widget.create');
    expect(audit.targetType).toBe('widget');
    expect(audit.userId).toBe('user-1');
    expect(typeof audit.targetId).toBe('string');
    expect(audit.after).toEqual({ manifest_id: MIN_MANIFEST.id, config: { x: 1 } });
    // `recordAudit` is the only thing we care about for these tests.
    expect(vi.mocked(recordAudit)).toHaveBeenCalledTimes(1);
  });
});

describe('widget.update -- PATCH /api/widgets/[id]', () => {
  it('records widget.update summarizing what changed', async () => {
    vi.mocked(db.getWidget).mockReturnValue({
      id: 'w1',
      user_id: 'user-1',
      manifest_json: JSON.stringify(MIN_MANIFEST),
      config_json: '{}',
      created_at: 0,
      updated_at: 0,
    } as any);
    const req = makeJsonReqMethod('http://localhost/api/widgets/w1', 'PATCH', {
      config: { x: 2 },
    });
    const params = Promise.resolve({ id: 'w1' });
    const res = await widgetsPatch(req, { params });
    expect(res.status).toBe(200);
    const audit = lastAudit();
    expect(audit.action).toBe('widget.update');
    expect(audit.targetType).toBe('widget');
    expect(audit.targetId).toBe('w1');
    // Body summary should expose which fields were touched (manifest: false,
    // config: true). Important so audit UI doesn't claim a manifest edit
    // happened when only config was patched.
    expect(audit.after).toEqual({ manifest: false, config: true });
  });
});

describe('widget.delete -- DELETE /api/widgets/[id]', () => {
  it('records widget.delete with the manifest_id of the doomed widget', async () => {
    vi.mocked(db.getWidget).mockReturnValue({
      id: 'w9',
      user_id: 'user-1',
      manifest_json: JSON.stringify(MIN_MANIFEST),
      config_json: '{}',
      created_at: 0,
      updated_at: 0,
    } as any);
    const params = Promise.resolve({ id: 'w9' });
    const res = await widgetsDelete({} as NextRequest, { params });
    expect(res.status).toBe(200);
    const audit = lastAudit();
    expect(audit.action).toBe('widget.delete');
    expect(audit.targetType).toBe('widget');
    expect(audit.targetId).toBe('w9');
    expect(audit.before).toEqual({ manifest_id: MIN_MANIFEST.id });
  });
});

describe('manifest.install -- POST /api/manifests', () => {
  it('records manifest.install with origin (custom vs installed)', async () => {
    const req = makeJsonReq('http://localhost/api/manifests', {
      manifest: MIN_MANIFEST,
      origin: 'installed',
    });
    const res = await manifestsPost(req);
    expect(res.status).toBe(200);
    const audit = lastAudit();
    expect(audit.action).toBe('manifest.install');
    expect(audit.targetType).toBe('manifest');
    expect(audit.targetId).toBe(MIN_MANIFEST.id);
    expect(audit.after).toEqual({ origin: 'installed' });
  });
});

describe('manifest.delete -- DELETE /api/manifests/[id]', () => {
  it('records manifest.delete with the existing origin in `before`', async () => {
    vi.mocked(db.getUserManifest).mockReturnValue({
      id: 'um_x',
      user_id: 'user-1',
      manifest_id: 'api-usage',
      manifest_json: JSON.stringify(MIN_MANIFEST),
      origin: 'installed',
      created_at: 0,
      updated_at: 0,
    } as any);
    const params = Promise.resolve({ id: 'api-usage' });
    const res = await manifestsDelete({} as NextRequest, { params });
    expect(res.status).toBe(200);
    const audit = lastAudit();
    expect(audit.action).toBe('manifest.delete');
    expect(audit.targetType).toBe('manifest');
    expect(audit.targetId).toBe('api-usage');
    expect(audit.before).toEqual({ origin: 'installed' });
  });
});

describe('secret.add -- POST /api/widget-secrets', () => {
  it('records secret.add with the name only (never the value)', async () => {
    const req = makeJsonReq('http://localhost/api/widget-secrets', {
      name: 'OWM_KEY',
      value: 'super-secret-plaintext',
    });
    const res = await secretsPost(req);
    expect(res.status).toBe(200);
    const audit = lastAudit();
    expect(audit.action).toBe('secret.add');
    expect(audit.targetType).toBe('secret');
    expect(audit.targetId).toBe('OWM_KEY');
    expect(audit.after).toEqual({ name: 'OWM_KEY' });
    // Defense in depth: the payload must not contain the plaintext or any
    // ciphertext returned by `encryptForUser`.
    const stringified = JSON.stringify(audit);
    expect(stringified).not.toContain('super-secret-plaintext');
    expect(stringified).not.toContain('enc(');
  });
});

describe('secret.remove -- DELETE /api/widget-secrets', () => {
  it('records secret.remove with the name (no value ever)', async () => {
    const url = new URL('http://localhost/api/widget-secrets');
    url.searchParams.set('name', 'OWM_KEY');
    const req = new NextRequest(url.toString(), { method: 'DELETE' });
    const res = await secretsDelete(req);
    expect(res.status).toBe(200);
    const audit = lastAudit();
    expect(audit.action).toBe('secret.remove');
    expect(audit.targetType).toBe('secret');
    expect(audit.targetId).toBe('OWM_KEY');
    expect(audit.before).toEqual({ name: 'OWM_KEY' });
  });
});

describe('dashboard.create -- POST /api/dashboards', () => {
  it('records dashboard.create with name + base_device', async () => {
    vi.mocked(db.listDashboards).mockReturnValue([]);
    const req = makeJsonReq('http://localhost/api/dashboards', {
      name: 'Living Room',
      base_device: 'kindle-pw',
    });
    const res = await dashboardsPost(req);
    expect(res.status).toBe(200);
    const audit = lastAudit();
    expect(audit.action).toBe('dashboard.create');
    expect(audit.targetType).toBe('dashboard');
    expect(audit.after).toEqual({ name: 'Living Room', base_device: 'kindle-pw' });
  });
});

describe('dashboard.update -- PATCH /api/dashboards/[id]', () => {
  it('records dashboard.update with a per-field change summary', async () => {
    const params = Promise.resolve({ id: 'd1' });
    const req = makeJsonReqMethod('http://localhost/api/dashboards/d1', 'PATCH', {
      name: 'Renamed',
      layouts: { 'kindle-pw': [] },
      refresh_overrides: { 'kindle-pw': null },
    });
    const res = await dashboardsPatch(req, { params });
    expect(res.status).toBe(200);
    const audit = lastAudit();
    expect(audit.action).toBe('dashboard.update');
    expect(audit.targetType).toBe('dashboard');
    expect(audit.targetId).toBe('d1');
    // Summaries only -- the real layout JSON is large, the audit shouldn't
    // duplicate it.
    expect(audit.after).toMatchObject({
      name: true,
      base_device: false,
      display_order: false,
      layouts_devices: ['kindle-pw'],
      refresh_overrides_devices: ['kindle-pw'],
    });
  });
});

describe('dashboard.save -- PUT /api/dashboards/[id] (canvas save)', () => {
  it('records dashboard.save with manifest_id list and count', async () => {
    const params = Promise.resolve({ id: 'd1' });
    const req = makeJsonReqMethod('http://localhost/api/dashboards/d1', 'PUT', {
      device: 'kindle-pw',
      items: [
        { manifestId: 'api-usage', x: 0, y: 0, w: 2, h: 2 },
        { manifestId: 'api-usage', x: 2, y: 0, w: 2, h: 2 },
      ],
    });
    const res = await dashboardsPut(req, { params });
    expect(res.status).toBe(200);
    const audit = lastAudit();
    expect(audit.action).toBe('dashboard.save');
    expect(audit.targetType).toBe('dashboard');
    expect(audit.targetId).toBe('d1');
    expect(audit.after).toEqual({
      device: 'kindle-pw',
      count: 2,
      manifest_ids: ['api-usage', 'api-usage'],
    });
  });
});

describe('dashboard.delete -- DELETE /api/dashboards/[id]', () => {
  it('records dashboard.delete with the doomed dashboard name + base_device', async () => {
    const params = Promise.resolve({ id: 'd1' });
    const res = await dashboardsDelete({} as NextRequest, { params });
    expect(res.status).toBe(200);
    const audit = lastAudit();
    expect(audit.action).toBe('dashboard.delete');
    expect(audit.targetType).toBe('dashboard');
    expect(audit.targetId).toBe('d1');
    expect(audit.before).toEqual({ name: 'Test', base_device: 'kindle-pw' });
  });
});

describe('album.save -- POST /api/albums/[name] (JSON replace)', () => {
  it('records album.save with item count', async () => {
    const params = Promise.resolve({ name: 'graduation' });
    const req = makeJsonReqMethod('http://localhost/api/albums/graduation', 'POST', {
      items: [
        { src: 'https://cdn.example/a.jpg', caption: 'A' },
        { src: 'https://cdn.example/b.jpg' },
      ],
    });
    const res = await albumsPost(req, { params });
    expect(res.status).toBe(200);
    const audit = lastAudit();
    expect(audit.action).toBe('album.save');
    expect(audit.targetType).toBe('album');
    expect(audit.targetId).toBe('graduation');
    expect(audit.after).toEqual({ count: 2 });
  });
});

describe('album.delete -- DELETE /api/albums/[name]', () => {
  it('records album.delete with the prior item_count in `before`', async () => {
    // Seed the stub store with 3 items so the route can build a meaningful
    // `before` snapshot.
    albumStoreState.set('graduation', [
      { src: 'https://cdn.example/a.jpg' },
      { src: 'https://cdn.example/b.jpg' },
      { src: 'https://cdn.example/c.jpg' },
    ]);
    const params = Promise.resolve({ name: 'graduation' });
    const res = await albumsDelete({} as NextRequest, { params });
    expect(res.status).toBe(200);
    const audit = lastAudit();
    expect(audit.action).toBe('album.delete');
    expect(audit.targetType).toBe('album');
    expect(audit.targetId).toBe('graduation');
    expect(audit.before).toEqual({ item_count: 3 });
    // The store was wiped by the handler.
    expect(albumStoreState.get('graduation')).toEqual([]);
  });
});
