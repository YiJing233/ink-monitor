/**
 * Tests for the `widget_resolve_log` instrumentation helpers
 * (`logWidgetResolve` / `latestWidgetResolve`).
 *
 * The native `better-sqlite3` binding is not always available in CI/sandbox
 * environments (it must be compiled per-platform), so we mock the module
 * with a tiny in-memory fake that implements the small slice of the API
 * these helpers touch (`exec` for CREATE TABLE, `prepare(...).run(...)` for
 * INSERT, `prepare(...).get(...)` for SELECT-LIMIT-1). The fake enforces the
 * same `ORDER BY ts DESC, id DESC LIMIT 1` semantics the real SQL has, so a
 * regression in the query would surface here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Minimal in-memory store shaped like the widget_resolve_log table. The
// `prepare()` factory dispatches on the SQL string the helpers pass in —
// we don't parse SQL, we just recognize the exact statements logWidgetResolve
// and latestWidgetResolve issue. Adding a new helper means extending the
// `prepare` switch below.
interface LogRow {
  id: number;
  user_id: string;
  widget_id: string;
  ms: number;
  error: string | null;
  ts: number;
}

function createFakeDb() {
  const rows: LogRow[] = [];
  let nextId = 1;
  function exec(sql: string) {
    // Only the statements we use; everything else is a no-op. CREATE TABLE
    // and DELETE FROM are not enforced — the fake's "schema" is implicit.
    if (/DELETE FROM widget_resolve_log/i.test(sql)) rows.length = 0;
  }
  function prepare(sql: string) {
    if (/INSERT INTO widget_resolve_log/i.test(sql)) {
      return {
        run(userId: string, widgetId: string, ms: number, error: string | null, ts: number) {
          const row: LogRow = { id: nextId++, user_id: userId, widget_id: widgetId, ms, error, ts };
          rows.push(row);
          return { lastInsertRowid: row.id, changes: 1 };
        },
      };
    }
    if (/SELECT ms, error, ts FROM widget_resolve_log/i.test(sql)) {
      return {
        get(userId: string, widgetId: string): { ms: number; error: string | null; ts: number } | undefined {
          // Mirror the SQL: ORDER BY ts DESC, id DESC LIMIT 1. The id tie-
          // break matters when two rows share the same ts (millisecond
          // granularity is not unique under burst writes).
          let best: LogRow | undefined;
          for (const r of rows) {
            if (r.user_id !== userId || r.widget_id !== widgetId) continue;
            if (!best || r.ts > best.ts || (r.ts === best.ts && r.id > best.id)) best = r;
          }
          if (!best) return undefined;
          return { ms: best.ms, error: best.error, ts: best.ts };
        },
      };
    }
    // Anything else the helpers don't issue — throw so a future regression
    // surfaces a clear "unexpected SQL" error rather than silently passing.
    throw new Error(`fakeDb: unhandled SQL in test: ${sql}`);
  }
  return { exec, prepare, _rows: rows };
}

const fakeDb = createFakeDb();

vi.mock('better-sqlite3', () => ({
  default: function FakeDatabase() {
    return fakeDb;
  },
}));

// Import AFTER vi.mock so the helpers see the fake module.
import { logWidgetResolve, latestWidgetResolve } from '../db';

beforeEach(() => {
  // Each case starts with an empty log so ordering assertions are stable.
  fakeDb.exec('DELETE FROM widget_resolve_log');
});

describe('widget_resolve_log helpers', () => {
  it('round-trips a single resolve row via logWidgetResolve + latestWidgetResolve', () => {
    // Success row: error stays null so the diagnostics UI can distinguish
    // "healthy last run" from "last run failed".
    logWidgetResolve('user-1', 'w-1', 123, null);
    const row = latestWidgetResolve('user-1', 'w-1');
    expect(row).not.toBeNull();
    expect(row!.ms).toBe(123);
    expect(row!.error).toBeNull();
    // `ts` should be a recent unix-ms — we don't pin the exact value
    // because Date.now() drifts; just confirm it looks like ms.
    expect(typeof row!.ts).toBe('number');
    expect(row!.ts).toBeGreaterThan(Date.now() - 10_000);
  });

  it('returns the most recent row when multiple have been logged for one widget', async () => {
    // Pin the wall clock so the `ORDER BY ts DESC` ordering is deterministic
    // — without this the three rows below could end up with identical `ts`
    // values and the test would race on the tie-break.
    vi.useFakeTimers();
    const startMs = Date.UTC(2026, 6, 9, 12, 0, 0);
    vi.setSystemTime(new Date(startMs));

    logWidgetResolve('user-1', 'w-1', 100, null);
    await vi.advanceTimersByTimeAsync(50);
    logWidgetResolve('user-1', 'w-1', 200, 'transient error');
    await vi.advanceTimersByTimeAsync(50);
    logWidgetResolve('user-1', 'w-1', 300, null);

    vi.useRealTimers();

    const row = latestWidgetResolve('user-1', 'w-1');
    expect(row).not.toBeNull();
    expect(row!.ms).toBe(300);
    expect(row!.error).toBeNull();
    // ts should equal start + 100ms (the third log); if a regression flips
    // ORDER BY to ASC the test would see 100 instead.
    expect(row!.ts).toBe(startMs + 100);
  });

  it('does not leak rows between widget instances or users', () => {
    logWidgetResolve('user-1', 'w-a', 50, null);
    logWidgetResolve('user-1', 'w-b', 75, 'boom');
    logWidgetResolve('user-2', 'w-a', 999, null);

    expect(latestWidgetResolve('user-1', 'w-a')).toMatchObject({ ms: 50, error: null });
    expect(latestWidgetResolve('user-1', 'w-b')).toMatchObject({ ms: 75, error: 'boom' });
    // Different user, same widgetId → must not see user-1's row.
    expect(latestWidgetResolve('user-2', 'w-a')).toMatchObject({ ms: 999, error: null });
    // Never-logged combination returns null so the diagnostics UI can
    // render "—" rather than fabricate values.
    expect(latestWidgetResolve('user-1', 'w-never')).toBeNull();
    expect(latestWidgetResolve('user-3', 'w-a')).toBeNull();
  });
});