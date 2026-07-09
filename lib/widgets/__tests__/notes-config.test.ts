/**
 * Tests for the `notes` widget's per-instance write-back path
 * (`resolveNotesSource` + the storage priority rules).
 *
 * The widget stores its lines in `widget.config_json.lines` (written through
 * the QR-backed editor at `/api/widgets/[id]/config`). For legacy installs
 * predating that path, lines can also live in the shared
 * `settings:notes` owned_state row. The priority is:
 *
 *   1. If `configLines` is a string array (including the empty array), it
 *      wins — the editor's "delete everything" case is also authoritative,
 *      we don't want a stale shared store to fill back in.
 *   2. Otherwise we fall back to `ownedState.lines`.
 *
 * The Source layer (server-only) wires the two paths together; the helper
 * itself takes both shapes so it stays client-safe (no DB import).
 */
import { describe, it, expect } from 'vitest';
import { resolveNotesSource } from '../builtin-sources';

const USER = 'user-test';

describe('resolveNotesSource — config write-back path', () => {
  it('uses widget.config_json.lines when provided (per-instance write-back wins)', () => {
    // The editor wrote `['a', 'b']` to widget.config_json. The Source layer
    // hands that to the helper. We should see those exact lines back,
    // regardless of what's in the legacy owned_state row.
    const ownedState = { lines: ['stale', 'from', 'shared', 'store'] };
    const configLines = ['a', 'b'];
    expect(resolveNotesSource(USER, ownedState, configLines)).toEqual({ lines: ['a', 'b'] });
  });

  it('falls back to owned_state when configLines is absent (legacy single-store path)', () => {
    // No config write yet → the user is on a pre-write-back install.
    // The Source layer passes the raw owned_state value through.
    const ownedState = { lines: ['legacy line one', 'legacy line two'] };
    expect(resolveNotesSource(USER, ownedState)).toEqual({
      lines: ['legacy line one', 'legacy line two'],
    });
  });

  it('treats an empty configLines array as authoritative (no stale fallback)', () => {
    // The editor saved an empty list — the user explicitly cleared the
    // widget. The Source layer must NOT fall back to the shared store's
    // (potentially outdated) lines; the user wants an empty tile.
    const ownedState = { lines: ['still', 'there'] };
    expect(resolveNotesSource(USER, ownedState, [])).toEqual({ lines: [] });
  });

  it('falls through to owned_state when configLines is not an array (defensive)', () => {
    // A legacy config_json might carry `lines: null` or `lines: 'broken'`
    // from before the schema locked down. We don't want a malformed config
    // to blank out the widget — fall through to the shared store.
    const ownedState = { lines: ['shared'] };
    expect(resolveNotesSource(USER, ownedState, null)).toEqual({ lines: ['shared'] });
    expect(resolveNotesSource(USER, ownedState, 'not an array' as unknown)).toEqual({
      lines: ['shared'],
    });
  });

  it('coerces non-string entries + drops empties from configLines, same as owned_state', () => {
    // The editor sanitizes, but the storage field is plain JSON — a buggy
    // writer could still hand us numbers, nulls, or empty strings. Match
    // the owned_state cleanup rules so the `list` renderer never has to
    // think about it.
    const messy = ['keep', null as unknown, 42, '', 'also keep'];
    expect(resolveNotesSource(USER, null, messy)).toEqual({ lines: ['keep', 'also keep'] });
  });
});