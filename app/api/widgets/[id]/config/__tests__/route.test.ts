/**
 * Tests for POST /api/widgets/[id]/config — the QR-backed notes editor's
 * write-back endpoint.
 *
 * Covered:
 *   1. No session → 401 (the auth gate fires before any DB work).
 *   2. Session + a widget owned by a *different* user → 403 (the ownership
 *      check distinguishes "not yours" from "doesn't exist" — the spec
 *      asked for 403 explicitly so admins can tell why a save was
 *      rejected).
 *   3. Session + your own widget + a valid body → 200 and the DB row's
 *      `config_json` is updated to contain the new lines (the contract
 *      the Source layer reads at render time).
 *
 * We mock `getRequiredUserId` + the `lib/db` modules so the route runs
 * end-to-end against real zod validation + real UPDATE SQL composition,
 * but without spinning up a Next.js request context or a SQLite database.
 * The `updateWidget` mock records the patch it was called with so we can
 * assert on what actually got written.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// vi.mock hoists above the import statements, so the factory bodies cannot
// reference module-scope variables. Wire up behavior in beforeEach.
const getRequiredUserId = vi.fn();
vi.mock('@/lib/session', () => ({
  getRequiredUserId: () => getRequiredUserId(),
}));

// We mock `getDb` (used by the route to peek at a widget's ownership when
// getWidget returns undefined) and the widget CRUD helpers. Both
// `updateWidget` and `getDb` are re-bound in beforeEach so each test can
// stage its own scenario.
const getWidget = vi.fn();
const updateWidget = vi.fn();
const getDb = vi.fn();
vi.mock('@/lib/db', () => ({
  getWidget: (uid: string, id: string) => getWidget(uid, id),
  updateWidget: (uid: string, id: string, patch: Record<string, unknown>) => updateWidget(uid, id, patch),
  getDb: () => getDb(),
}));

import { POST } from '../route';

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/widgets/w-mine/config', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const params = Promise.resolve({ id: 'w-mine' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/widgets/[id]/config', () => {
  it('returns 401 when there is no session', async () => {
    // The whole point of the explicit UNAUTHORIZED check is that it fires
    // before any DB lookup — same as the /api/widgets/[id] PATCH route, so
    // an unauthenticated probe can't enumerate widget ids or time the
    // response against a populated account.
    getRequiredUserId.mockRejectedValueOnce(new Error('UNAUTHORIZED'));
    const res = await POST(makeReq({ lines: ['hi'] }), { params });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('unauthorized');
    // Crucially: we must not touch the DB at all when unauthenticated.
    expect(getWidget).not.toHaveBeenCalled();
    expect(updateWidget).not.toHaveBeenCalled();
  });

  it('returns 403 when the widget belongs to a different user', async () => {
    getRequiredUserId.mockResolvedValueOnce('user-self');
    // getWidget is keyed by (user_id, id), so a foreign widget returns
    // undefined — same shape as "doesn't exist". The route then peeks via
    // getDb to distinguish the two cases: a row owned by someone else is a
    // 403, no row at all is a 404.
    getWidget.mockReturnValueOnce(undefined);
    const peek = { prepare: () => ({ get: () => ({ user_id: 'user-other' }) }) };
    getDb.mockReturnValueOnce(peek);

    const res = await POST(makeReq({ lines: ['hi'] }), { params });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('forbidden');
    // We must not have written anything on a forbidden request.
    expect(updateWidget).not.toHaveBeenCalled();
  });

  it('updates the widget config and returns 200 for a valid write', async () => {
    getRequiredUserId.mockResolvedValueOnce('user-self');
    // Existing widget owned by `user-self`. The route merges the new
    // `lines` field with the existing config_json, so we seed an unrelated
    // key (`theme`) here to confirm the merge preserves it — protects
    // against a future regression where someone replaces the whole config
    // instead of merging.
    getWidget.mockReturnValueOnce({
      id: 'w-mine',
      user_id: 'user-self',
      manifest_json: '{"id":"notes","v":1}',
      config_json: JSON.stringify({ theme: 'ink', lines: ['old'] }),
      created_at: 0,
      updated_at: 0,
    });
    updateWidget.mockReturnValueOnce(undefined);

    const lines = ['Buy milk', 'Ship the widget', 'Read the RFC'];
    const res = await POST(makeReq({ lines }), { params });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; lines?: string[] };
    expect(body.ok).toBe(true);
    expect(body.lines).toEqual(lines);

    // Confirm the DB write received the merged config (theme preserved,
    // lines replaced). We don't pin the JSON encoding exactly because
    // whitespace is unimportant — `JSON.parse` on either side normalizes.
    expect(updateWidget).toHaveBeenCalledTimes(1);
    const [uid, id, patch] = updateWidget.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(uid).toBe('user-self');
    expect(id).toBe('w-mine');
    const written = JSON.parse(patch.config_json as string) as { theme?: string; lines?: string[] };
    expect(written.theme).toBe('ink');
    expect(written.lines).toEqual(lines);
  });
});