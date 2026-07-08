/**
 * F19 regression: the PUT /api/dashboards/[id] route must reject a save that
 * contains two overlapping placements. The client UI already prevents this,
 * but the server is the source of truth — without the check, a hand-crafted
 * PUT (curl, replayed request, buggy client) could write a layout that the
 * renderer can't draw.
 *
 * The full DB / Next.js request context is hard to spin up under vitest, so
 * we mock the auth + DB layers and drive the real route handler with a
 * NextRequest. Everything else (zod parsing, manifest resolution, the
 * collision check itself) runs against the real implementations.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock hoists to the top of the file, BEFORE the import of the route. The
// factory bodies must not reference variables from module scope.
vi.mock('@/lib/session', () => ({
  getRequiredUserId: vi.fn(async () => 'user-1'),
}));

const FAKE_DASHBOARD = {
  id: 'd1',
  user_id: 'user-1',
  name: 'Test',
  base_device: 'kindle_basic',
  display_order: 0,
  layouts_json: '{}',
  refresh_overrides_json: '{}',
  created_at: 0,
  updated_at: 0,
};

vi.mock('@/lib/db', () => ({
  getDashboard: vi.fn(() => FAKE_DASHBOARD),
  updateDashboard: vi.fn(),
  insertWidget: vi.fn(),
  listWidgets: vi.fn(() => []),
  listDashboards: vi.fn(() => [FAKE_DASHBOARD]),
  deleteWidget: vi.fn(),
  deleteDashboard: vi.fn(),
  getWidget: vi.fn(),
  withTx: vi.fn((fn: () => unknown) => fn()),
}));

import { PUT } from '../route';
import { NextRequest } from 'next/server';

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dashboards/d1', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const params = Promise.resolve({ id: 'd1' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PUT /api/dashboards/[id] — F19 server-side collision check', () => {
  it('returns 400 placement-collision when two items overlap', async () => {
    const body = {
      device: 'kindle-pw',
      items: [
        { manifestId: 'api-usage', x: 0, y: 0, w: 2, h: 2 },
        { manifestId: 'api-usage', x: 1, y: 1, w: 2, h: 2 }, // overlaps the first
      ],
    };
    const res = await PUT(makeReq(body), { params });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('placement collision');
  });

  it('accepts a save where two items only touch edges (snapped grid, no half-cells)', async () => {
    const body = {
      device: 'kindle-pw',
      items: [
        { manifestId: 'api-usage', x: 0, y: 0, w: 2, h: 2 },
        { manifestId: 'api-usage', x: 2, y: 0, w: 2, h: 2 }, // edge-touching, not overlapping
      ],
    };
    const res = await PUT(makeReq(body), { params });
    expect(res.status).toBe(200);
  });
});
