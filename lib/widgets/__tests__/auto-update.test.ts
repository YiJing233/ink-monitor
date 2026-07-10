/**
 * Tests for `findAvailableUpdates` — the version-comparison + registry-resolve
 * helper powering both the Canvas auto-update banner and the
 * `/api/widgets/batch-update` POST handler.
 *
 * Covered:
 *   1. Detects a single upgrade candidate: installed widget on an older
 *      version of a remote registry entry reports the right (widgetId,
 *      manifestId, installedVersion, latestVersion) tuple. Skips widgets that
 *      match nothing in the registry (built-ins), and skips widgets whose
 *      installed version is already >= remote (no spurious upgrades).
 *   2. Skips `user_manifests` rows tagged `origin='custom'`: they were
 *      authored by the user / a skill, not pulled from the market, so the
 *      registry has no meaningful "newer" to compare against. Upgrading
 *      them silently would silently overwrite the user's bespoke work.
 *   3. Empty registry → empty result. Empty widget list → empty result.
 *      Fetcher throws → empty result (the canvas page must keep rendering
 *      when the market is down).
 */
import { describe, it, expect } from 'vitest';
import { findAvailableUpdates, type WidgetLike, type UserManifestLike } from '../auto-update';

const WEATHER = {
  v: 1,
  id: 'london-weather',
  name: 'London Weather',
  version: '0.3.0',
  source: { kind: 'demo', data: {} },
  families: ['2x2'] as const,
  layout: { '2x2': { t: 'text', value: 'hello' } },
};

const CLOCK = {
  v: 1,
  id: 'clock',
  name: 'Clock',
  source: { kind: 'owned', store: 'settings:clock' },
  families: ['1x1'] as const,
  layout: { '1x1': { t: 'text', value: 'x' } },
};

function widgets(rows: Array<{ id: string; manifestId: string; version?: string }>): WidgetLike[] {
  return rows.map((r) => ({
    id: r.id,
    manifest_json: JSON.stringify({ v: 1, id: r.manifestId, name: r.manifestId, ...(r.version ? { version: r.version } : {}) }),
  }));
}

function userManifests(rows: Array<{ manifestId: string; version?: string; origin?: string }>): UserManifestLike[] {
  return rows.map((r) => ({
    manifest_id: r.manifestId,
    manifest_json: JSON.stringify({ v: 1, id: r.manifestId, name: r.manifestId, ...(r.version ? { version: r.version } : {}) }),
    origin: r.origin ?? 'installed',
  }));
}

const registry = (items: { manifest: unknown; version?: string }[]) => async () => ({ items });

describe('findAvailableUpdates', () => {
  it('finds upgrades for installed widgets that have a newer registry version', async () => {
    // Two widgets on the canvas:
    //   - w-clock: a built-in (no user_manifests row, since the user never
    //     pulled it from the market) — the registry has no role in
    //     versioning it, so the check must skip it.
    //   - w-weather: a market-installed widget whose library row says
    //     v0.2.0 — the registry carries v0.3.0, so it's a match.
    //
    // The `installed.version` we compare against is the one in the user's
    // library row (manifest_json column on user_manifests), not the frozen
    // copy on the widget instance — the library row is what the Market UI
    // shows as "local vX" today, so banners and library must agree.
    const ws = widgets([
      { id: 'w-clock', manifestId: 'clock', version: '0.1.0' },
      { id: 'w-weather', manifestId: 'london-weather', version: '0.2.0' },
    ]);
    const ums = userManifests([{ manifestId: 'london-weather', version: '0.2.0' }]);

    const out = await findAvailableUpdates(ws, ums, registry([{ manifest: WEATHER, version: '0.3.0' }]));
    expect(out).toHaveLength(1);
    expect(out[0].widgetId).toBe('w-weather');
    expect(out[0].manifestId).toBe('london-weather');
    expect(out[0].installedVersion).toBe('0.2.0');
    expect(out[0].latestVersion).toBe('0.3.0');
    expect(out[0].latestManifest.id).toBe('london-weather');
  });

  it("skips user_manifests with origin='custom' even when the registry carries the same id", async () => {
    // A user-authored widget that happens to share an id with a registry
    // entry — the registry's version must NOT be treated as "newer": the
    // installed version belongs to the user, and upgrading silently would
    // discard their bespoke manifest body.
    const ws = widgets([{ id: 'w-mine', manifestId: 'london-weather', version: '0.2.0' }]);
    const ums: UserManifestLike[] = [
      {
        manifest_id: 'london-weather',
        manifest_json: JSON.stringify({ v: 1, id: 'london-weather', name: 'London Weather (mine)' }),
        origin: 'custom',
      },
    ];
    const out = await findAvailableUpdates(ws, ums, registry([{ manifest: WEATHER, version: '0.3.0' }]));
    expect(out).toHaveLength(0);
  });

  it('returns an empty list when the registry has nothing newer than what is installed', async () => {
    // Everything we have on the canvas is either built-in, custom, or
    // already at the latest version. The route + banner must see zero
    // upgrades.
    const ws = widgets([
      { id: 'w-clock', manifestId: 'clock', version: '0.1.0' },
      { id: 'w-weather', manifestId: 'london-weather', version: '0.3.0' },
    ]);
    const ums = userManifests([
      { manifestId: 'clock', version: '0.1.0' }, // built-in style; no registry entry anyway
      { manifestId: 'london-weather', version: '0.3.0' },
    ]);
    const out = await findAvailableUpdates(
      ws,
      ums,
      registry([
        { manifest: WEATHER, version: '0.3.0' },
        { manifest: CLOCK, version: '0.1.0' },
      ]),
    );
    expect(out).toEqual([]);
  });

  it('returns an empty list when the fetcher throws — the canvas must not crash', async () => {
    const ws = widgets([{ id: 'w-weather', manifestId: 'london-weather', version: '0.2.0' }]);
    const ums = userManifests([{ manifestId: 'london-weather', version: '0.2.0' }]);
    const failing = async () => {
      throw new Error('market down');
    };
    const out = await findAvailableUpdates(ws, ums, failing);
    expect(out).toEqual([]);
  });

  it('returns an empty list when there are no widgets', async () => {
    const out = await findAvailableUpdates([], userManifests([{ manifestId: 'london-weather', version: '0.2.0' }]), registry([{ manifest: WEATHER, version: '0.3.0' }]));
    expect(out).toEqual([]);
  });

  it('drops registry entries that fail IR validation rather than bubbling bad data up', async () => {
    // A junk entry from the registry must not be promoted as an "upgrade".
    const ws = widgets([{ id: 'w-weather', manifestId: 'london-weather', version: '0.2.0' }]);
    const ums = userManifests([{ manifestId: 'london-weather', version: '0.2.0' }]);
    // The first item is missing required fields (no `layout`) and must be
    // dropped. The second is valid and should match.
    const fetcher = registry([
      { manifest: { v: 1, id: 'broken', name: 'broken', families: ['1x1'], layout: {} }, version: '9.9.9' },
      { manifest: WEATHER, version: '0.3.0' },
    ]);
    const out = await findAvailableUpdates(ws, ums, fetcher);
    expect(out).toHaveLength(1);
    expect(out[0].manifestId).toBe('london-weather');
  });
});
