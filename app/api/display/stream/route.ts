import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserId, getUserIdFromShareToken } from '@/lib/session';
import { listDashboards, listProviders, listStocks, listWidgets, type DashboardRow, type Provider, type Stock, type WidgetRow } from '@/lib/db';
import { safeJson } from '@/lib/safe-json';
import { validateManifest } from '@/lib/widgets/ir';
import type { DeviceId } from '@/lib/widgets/devices';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * SSE live-push for /display.
 *
 * Design notes
 * ------------
 * - Same auth model as /api/snapshot: session cookie OR `?share=<token>`. No
 *   `?u=` fallback (F2/F12/F18 already removed that).
 * - The body is a single ReadableStream<Uint8Array> that emits
 *   `text/event-stream` frames. The browser's `EventSource` will deliver each
 *   frame as a typed event.
 * - Two event names:
 *     - `refresh` (heartbeat, every 15s) — the client just reloads. The point
 *       is to keep proxies / load balancers from idle-closing the socket.
 *     - `patch` (per-widget) — emitted when a widget's effective
 *       `refresh_seconds` has elapsed. The payload is `{ widgetId, ts }`. For
 *       Phase 1 the client treats this identically to `refresh` and reloads;
 *       a future commit can switch to a real DOM patch on top of the
 *       `data-w-inst` markers that soft-refresh already uses.
 * - We poll a *lightweight* view of the user's data (manifest refresh + per-
 *   row override) rather than re-running `resolveDashboard` — the source layer
 *   can issue real HTTP fetches, and we don't want the SSE itself to act as a
 *   refresh driver. The page's own meta-refresh / soft-refresh still owns
 *   re-fetching upstream data.
 * - Hard 5-minute cap on every connection so a forgotten tab doesn't hold a
 *   server-side timer forever; the client's reconnect (browser auto-reconnects
 *   on transient drops) will open a fresh one.
 */

const HEARTBEAT_MS = 15_000;
const TICK_MS = 5_000;
const STREAM_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_REFRESH = 60;

export interface StreamTarget {
  /** Stable id used in the `patch` event payload. */
  id: string;
  /** Effective refresh period in seconds (manifest + per-device override). */
  refreshSeconds: number;
}

/**
 * Snapshot the user's streamable widgets: dashboard widgets (one per placement
 * on the dashboard's base device) plus the legacy provider/stock rows. The
 * caller is expected to invoke this on every tick so the poll reflects edits
 * made in /admin mid-session.
 */
export function loadStreamTargets(userId: string): StreamTarget[] {
  const out: StreamTarget[] = [];

  // --- Dashboard widgets ----------------------------------------------------
  // We don't call `resolveDashboard` (which can trigger real HTTP fetches via
  // the http source). The SSE only needs the *cadence* of each widget, which
  // is `manifest.refresh` modulated by the per-device override. Reading the
  // manifest JSON + dashboards row directly is enough.
  const dashboards: DashboardRow[] = listDashboards(userId);
  const widgets: WidgetRow[] = listWidgets(userId);
  const widgetById = new Map(widgets.map((w) => [w.id, w]));
  for (const d of dashboards) {
    const layouts = safeJson(d.layouts_json, 'dashboards.layouts_json') as Partial<
      Record<DeviceId, Array<{ id: string; widgetId: string }>>
    >;
    const overrides = safeJson(d.refresh_overrides_json, 'dashboards.refresh_overrides_json') as Partial<
      Record<DeviceId, number>
    >;
    const baseDevice = d.base_device as DeviceId;
    const override = overrides[baseDevice];
    const placements = layouts[baseDevice] ?? [];
    for (const p of placements) {
      const w = widgetById.get(p.widgetId);
      if (!w) continue;
      let refresh = DEFAULT_REFRESH;
      try {
        const m = validateManifest(JSON.parse(w.manifest_json));
        if (typeof m.refresh === 'number' && m.refresh >= 15) refresh = m.refresh;
      } catch {
        // Skip a corrupt manifest: the next read of /display would have
        // skipped it too. Don't kill the SSE just because one row is bad.
        continue;
      }
      // Per-device override acts as a cap (smaller override => more frequent
      // refresh). Same semantics the meta-refresh path uses in
      // app/display/page.tsx; we don't re-clamp here because the source data
      // comes from the same UI form.
      if (typeof override === 'number' && override >= 15) {
        refresh = Math.min(refresh, override);
      }
      out.push({ id: p.id || `i-${p.widgetId}`, refreshSeconds: refresh });
    }
  }

  // --- Legacy provider / stock rows ----------------------------------------
  // These still show on /display for users without a canvas. Their
  // `refresh_seconds` is the source-of-truth cadence.
  for (const p of listProviders(userId) as Provider[]) {
    out.push({ id: `provider:${p.id}`, refreshSeconds: p.refresh_seconds ?? DEFAULT_REFRESH });
  }
  for (const s of listStocks(userId) as Stock[]) {
    out.push({ id: `stock:${s.id}`, refreshSeconds: s.refresh_seconds ?? DEFAULT_REFRESH });
  }

  return out;
}

export interface StartStreamOpts {
  userId: string;
  /** Called with the event name and a JSON-serialisable payload. */
  send: (event: string, data: unknown) => void;
  /** Override the clock; tests use this to fast-forward. */
  now?: () => number;
  heartbeatMs?: number;
  tickMs?: number;
  /** Override the target loader; tests use this to feed a fixed list. */
  loadTargets?: (userId: string) => StreamTarget[];
  /** Override timer APIs; tests use this to track interval/timeout instances. */
  setIntervalFn?: (cb: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}

export interface StreamHandle {
  stop: () => void;
}

/**
 * Run the SSE poll loop. Exported so the unit tests can drive it without
 * touching the HTTP layer.
 *
 * Lifetime:
 *   1. Snapshot the current targets.
 *   2. Stamp `lastEmitted[id] = now()` for each, so the first patch doesn't
 *      fire immediately on connect.
 *   3. Start a heartbeat (refresh) timer and a tick (patch-check) timer.
 *   4. The tick re-loads targets so edits to the canvas show up; emits `patch`
 *      for each target whose refresh period has elapsed since its last
 *      emission.
 *   5. `stop()` clears both timers. The route handler wires this to
 *      `request.signal.abort` so a client disconnect cleans up.
 */
export function startDisplayStream(opts: StartStreamOpts): StreamHandle {
  const now = opts.now ?? Date.now;
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const tickMs = opts.tickMs ?? TICK_MS;
  const load = opts.loadTargets ?? loadStreamTargets;
  const setInt = opts.setIntervalFn ?? ((cb, ms) => setInterval(cb, ms));
  const clearInt = opts.clearIntervalFn ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));

  const lastEmitted = new Map<string, number>();
  const stamp0 = now();
  for (const t of load(opts.userId)) lastEmitted.set(t.id, stamp0);

  let stopped = false;
  const safeSend = (event: string, data: unknown) => {
    if (stopped) return;
    try {
      opts.send(event, data);
    } catch {
      /* sink throw: the controller might already be closed if the client
         dropped mid-emit. The abort handler will run shortly. */
    }
  };

  const heartbeat = setInt(() => safeSend('refresh', 0), heartbeatMs);
  const tick = setInt(() => {
    const ts = now();
    const targets = load(opts.userId);
    const seen = new Set<string>();
    for (const t of targets) {
      seen.add(t.id);
      const last = lastEmitted.get(t.id) ?? ts;
      if (ts - last >= t.refreshSeconds * 1000) {
        safeSend('patch', { widgetId: t.id, ts });
        lastEmitted.set(t.id, ts);
      }
    }
    // Garbage-collect removed widgets so the Map doesn't grow unbounded
    // across canvas edits.
    for (const k of [...lastEmitted.keys()]) {
      if (!seen.has(k)) lastEmitted.delete(k);
    }
  }, tickMs);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInt(heartbeat);
      clearInt(tick);
    },
  };
}

export async function GET(req: NextRequest) {
  // --- Auth gate (same model as /api/snapshot) -----------------------------
  let userId = await getCurrentUserId();
  if (!userId) {
    userId = await getUserIdFromShareToken(req.nextUrl.searchParams.get('share'));
  }
  if (!userId) {
    return NextResponse.json(
      { error: 'auth required' },
      { status: 401, headers: { 'Cache-Control': 'no-store, must-revalidate' } },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          closed = true;
        }
      };
      const send = (event: string, data: unknown) => {
        safeEnqueue(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      // Frame the initial heartbeat immediately so a client that just
      // connected gets a byte to flush the headers (some proxies buffer
      // until they see the first body chunk).
      send('refresh', 0);

      const handle = startDisplayStream({ userId, send });

      const cleanup = () => {
        handle.stop();
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        if (hardTimeout) clearTimeout(hardTimeout);
      };

      // Client disconnect (browser tab closed, network drop, etc).
      if (req.signal.aborted) {
        cleanup();
        return;
      }
      req.signal.addEventListener('abort', cleanup);

      // Hard cap: a forgotten tab shouldn't keep a server-side timer alive
      // forever. Browser auto-reconnect handles the re-open.
      const hardTimeout = setTimeout(cleanup, STREAM_TIMEOUT_MS);
    },
    cancel() {
      // Runtime cancelled the stream. The abort handler above also fires for
      // most platforms; `cleanup` is idempotent.
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // no-transform: the proxy must not gzip or buffer this (gzip would
      // turn the long-poll into a held connection and buffering would delay
      // the heartbeat).
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable nginx response buffering for the same reason.
      'X-Accel-Buffering': 'no',
    },
  });
}
