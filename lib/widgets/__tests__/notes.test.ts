/**
 * Pure-function tests for the Phase 2 `notes` built-in.
 *
 * Contracts (per task spec):
 *   - When the user has never written to `settings:notes`, the resolver
 *     returns `{ lines: [] }` so the `list` node renders a blank tile
 *     instead of throwing.
 *   - When the user has saved lines, the resolver returns them in order.
 *
 * The Source layer is responsible for the `getOwnedState` round-trip; the
 * helper itself takes the stored value so it stays client-safe (no DB
 * import). The dispatcher in `source.ts` is the only thing that actually
 * touches SQLite.
 *
 * The manifest validation block catches drift the moment the manifest or
 * the IR schema changes — `capabilities.writes: true` is the key thing
 * here, because it drives the install-time "will write to your data" notice
 * in `describeCapabilities`.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../ir';
import notesManifest from '../manifests/notes.json';
import { resolveNotesSource } from '../builtin-sources';
import { describeCapabilities } from '../capabilities';

const USER = 'user-test';

describe('resolveNotesSource', () => {
  it('returns { lines: [] } when the user has never written to the store', () => {
    // The Source layer passes through whatever `getOwnedState` returns for
    // a missing row, which is `null`. The helper must collapse that into
    // an empty list so the `list` node renders a blank tile, not an error.
    expect(resolveNotesSource(USER, null)).toEqual({ lines: [] });
    expect(resolveNotesSource(USER, undefined)).toEqual({ lines: [] });
  });

  it('returns the stored lines in order when the user has saved some', () => {
    const stored = { lines: ['Buy milk', 'Ship the widget', 'Read the RFC'] };
    const out = resolveNotesSource(USER, stored);
    expect(out.lines).toEqual(['Buy milk', 'Ship the widget', 'Read the RFC']);
  });

  it('coerces non-string entries to nothing and drops empty strings', () => {
    // The editor stores whatever the user types; we want a clean string[] so
    // the `list` renderer can call `String(it)` on every entry without
    // surprises. `null`, numbers, and `""` are all dropped.
    const messy = { lines: ['keep', null as unknown, 42, '', 'also keep', false as unknown] };
    const out = resolveNotesSource(USER, messy);
    expect(out.lines).toEqual(['keep', 'also keep']);
  });

  it('returns { lines: [] } when the stored value is not the expected shape', () => {
    // A row from a different feature that happened to land on this key
    // (or a corrupted write) must not crash the renderer. Tolerate any
    // non-array `lines` field.
    expect(resolveNotesSource(USER, { items: ['x'] })).toEqual({ lines: [] });
    expect(resolveNotesSource(USER, { lines: 'not an array' })).toEqual({ lines: [] });
  });
});

describe('notes manifest', () => {
  it('validates against the IR schema with the expected source + families', () => {
    const m = validateManifest(notesManifest);
    expect(m.id).toBe('notes');
    // 0.2.0 added the per-instance write-back path (QR-backed admin editor
    // + POST /api/widgets/[id]/config). The version bump is what makes the
    // Market surface "update available" to existing users.
    expect(m.version).toBe('0.2.0');
    expect(m.source).toEqual({ kind: 'owned', store: 'settings:notes' });
    expect(m.families).toEqual(['1x2', '2x2', '4x4']);
  });

  it('declares capabilities.writes: true and surfaces the "will write" notice', () => {
    // The whole point of `writes: true` is to drive the install-time
    // "会写入你的数据" notice so the user knows the widget will mutate their
    // platform-owned state. If this assertion ever fails, the manifest has
    // dropped the declaration and the install flow will silently stop
    // warning.
    const m = validateManifest(notesManifest);
    expect(m.capabilities?.writes).toBe(true);
    const notices = describeCapabilities(m);
    expect(notices.some((n) => n.kind === 'write')).toBe(true);
  });
});
