/**
 * Tests for the SSE live-push route at `GET /api/display/stream`.
 *
 * Coverage:
 *   1. No auth → 401 (session-less AND no `?share=`). Body is JSON, not
 *      text/event-stream — a 401 with the wrong content-type would have the
 *      browser's EventSource retry forever.
 *   2. Authed request → 200 with the SSE-specific headers
 *      (text/event-stream + Cache-Control no-transform + X-Accel-Buffering).
 *   3. `startDisplayStream` (the exported poll loop) emits a `refresh`
 *      heartbeat on its tick and a `patch` event once a target's
 *      `refreshSeconds` elapses, AND stops emitting after `.stop()`. This is
 *      the server-side interval cleanup the route's `abort` handler depends
 *      on.
 *
 * The route handler is exercised in (1) and (2); the abort/cleanup contract
 * is exercised in (3) against the pure `startDisplayStream` export so we can
 * drive fake timers and observe every `send()` call without reading a
 * ReadableStream chunk-by-chunk.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/session', () => ({
  getCurrentUserId: vi.fn(async () => null),
  getUserIdFromShareToken: vi.fn(async () => null),
}));

// Mock the DB layer so the route's `loadStreamTargets` call doesn't try to
// open the SQLite file — the better-sqlite3 native binding isn't available
// in the test env, and we're not testing the DB read here anyway (that's
// covered by `startDisplayStream` with an injected `loadTargets`).
vi.mock('@/lib/db', () => ({
  listDashboards: vi.fn(() => []),
  listWidgets: vi.fn(() => []),
  listProviders: vi.fn(() => []),
  listStocks: vi.fn(() => []),
}));

import { GET, startDisplayStream, type StreamTarget } from '../route';
import { NextRequest } from 'next/server';

function makeReq(url = 'http://localhost/api/display/stream'): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/display/stream — auth gate (F2/F12/F18)', () => {
  it('returns 401 JSON when neither session nor share token resolves a user', async () => {
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('auth required');
    // Critical: the body MUST be JSON, not an SSE stream. A 401 with
    // text/event-stream would have EventSource retry forever.
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});

describe('GET /api/display/stream — authed response shape', () => {
  it('returns 200 + text/event-stream + SSE headers when session auth resolves', async () => {
    const sessionMod = await import('@/lib/session');
    (sessionMod.getCurrentUserId as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce('user-1');

    const res = await GET(makeReq());

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('cache-control')).toMatch(/no-cache/);
    // no-transform: the proxy must not gzip or buffer this — gzip turns a
    // long-poll into a held connection; buffering delays the heartbeat.
    expect(res.headers.get('cache-control')).toMatch(/no-transform/);
    expect(res.headers.get('connection')).toMatch(/keep-alive/i);
    // Disable nginx response buffering for the same reason.
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    // Body MUST be a ReadableStream (the controller's enqueue path).
    expect(res.body).toBeTruthy();

    // Drain + abort so the route's start() callback tears down its
    // intervals. Without this the test process would hang on a live timer.
    if (res.body) await res.body.cancel();
  });
});

describe('startDisplayStream — poll loop and cleanup', () => {
  it('emits patch for a target whose refreshSeconds elapses, and stops on .stop()', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    const sent: Array<[string, unknown]> = [];
    const send = (e: string, d: unknown) => sent.push([e, d]);

    const handle = startDisplayStream({
      userId: 'u1',
      send,
      now: () => Date.now(),
      heartbeatMs: 1000,
      tickMs: 1000,
      loadTargets: () => [{ id: 'w1', refreshSeconds: 5 }] as StreamTarget[],
    });

    // First tick at t+1s: 1s elapsed, target wants 5s → no patch yet.
    vi.advanceTimersByTime(1000);
    expect(sent.filter(([e]) => e === 'patch')).toEqual([]);

    // Second tick at t+2s: still 2s elapsed, no patch.
    vi.advanceTimersByTime(1000);
    expect(sent.filter(([e]) => e === 'patch')).toEqual([]);

    // At t+6s the tick sees 6s elapsed ≥ 5s → patch.
    vi.advanceTimersByTime(4000);
    const patches = sent.filter(([e]) => e === 'patch');
    expect(patches.length).toBe(1);
    expect(patches[0][1]).toEqual({ widgetId: 'w1', ts: expect.any(Number) });

    // After stop(), no more events should fire even if we advance further.
    handle.stop();
    const beforeCount = sent.length;
    vi.advanceTimersByTime(60_000);
    expect(sent.length).toBe(beforeCount);

    vi.useRealTimers();
  });

  it('clears both registered intervals on .stop() (server-side cleanup contract)', () => {
    // The route wires request.signal.abort → handle.stop(); this is the
    // most direct way to verify the cleanup that the abort handler relies on.
    const setHandles: unknown[] = [];
    const clearHandles: unknown[] = [];
    const setIntervalFn = vi.fn((_cb: () => void, _ms: number) => {
      const h = Symbol('interval');
      setHandles.push(h);
      return h;
    });
    const clearIntervalFn = vi.fn((h: unknown) => {
      clearHandles.push(h);
    });

    const handle = startDisplayStream({
      userId: 'u1',
      send: () => {},
      now: () => 0,
      heartbeatMs: 1000,
      tickMs: 1000,
      loadTargets: () => [],
      setIntervalFn,
      clearIntervalFn,
    });

    // Two intervals registered: heartbeat + tick.
    expect(setIntervalFn).toHaveBeenCalledTimes(2);
    expect(clearIntervalFn).toHaveBeenCalledTimes(0);

    handle.stop();

    // Both intervals cleared, with the right handles.
    expect(clearIntervalFn).toHaveBeenCalledTimes(2);
    expect(clearIntervalFn).toHaveBeenNthCalledWith(1, setHandles[0]);
    expect(clearIntervalFn).toHaveBeenNthCalledWith(2, setHandles[1]);

    // .stop() is idempotent — a second call must not double-clear (the
    // route's abort listener and the hard-timeout can both fire on a
    // normal shutdown).
    handle.stop();
    expect(clearIntervalFn).toHaveBeenCalledTimes(2);
  });

  it('drops widgets that disappear from the loader between ticks', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const sent: Array<[string, unknown]> = [];
    const targets: StreamTarget[] = [
      { id: 'w1', refreshSeconds: 1 },
      { id: 'w2', refreshSeconds: 1 },
    ];

    const handle = startDisplayStream({
      userId: 'u1',
      send: (e, d) => sent.push([e, d]),
      now: () => Date.now(),
      heartbeatMs: 1000,
      tickMs: 1000,
      loadTargets: () => targets,
    });

    // Two ticks → both widgets should have produced one patch each.
    vi.advanceTimersByTime(2000);
    const ids = sent
      .filter(([e]) => e === 'patch')
      .map(([, d]) => (d as { widgetId: string }).widgetId);
    expect(ids).toContain('w1');
    expect(ids).toContain('w2');

    // Drop w2 from the loader. w2's entry is stale in lastEmitted; the
    // next tick should GC it instead of emitting another patch. Advance
    // exactly one tick so only one w1 patch is produced (refreshSeconds=1).
    targets.length = 0;
    targets.push({ id: 'w1', refreshSeconds: 1 });
    sent.length = 0;
    vi.advanceTimersByTime(1000);
    const idsAfter = sent
      .filter(([e]) => e === 'patch')
      .map(([, d]) => (d as { widgetId: string }).widgetId);
    expect(idsAfter).toEqual(['w1']);

    handle.stop();
    vi.useRealTimers();
  });
});
