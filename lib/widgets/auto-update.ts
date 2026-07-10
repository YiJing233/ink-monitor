/**
 * Auto-update plumbing for installed market widgets.
 *
 * The Marketplace distributes manifests under a `version` field. When the user
 * has installed one (recorded in `user_manifests` with `origin='installed'`),
 * the Canvas dashboard load path can ask the registry "is there a newer
 * version of this same `id` on the market?" and surface a banner.
 *
 * This module keeps the comparison + registry loading in one pure place so:
 *   - The canvas page server-component can call `findAvailableUpdates()` to
 *     decide whether to render a banner, and
 *   - The `/api/widgets/batch-update` POST endpoint can call the same
 *     function to know which widgets to upgrade and from which version.
 *
 * Pure design: every dependency (fetch + db reads) is injectable so the test
 * suite can run the comparison logic against fake registries without HTTP.
 */
import 'server-only';

import { isNewer } from './version';
import { safeValidateManifest, type Manifest } from './ir';

export interface WidgetUpdate {
  /** Widget instance id (== `widgets.id`). */
  widgetId: string;
  /** The manifest's `id` field (the palette key — e.g. "london-weather"). */
  manifestId: string;
  /** Installed version string (may be undefined for very old rows). */
  installedVersion: string | null;
  /** Latest version per the registry. */
  latestVersion: string;
  /** The latest manifest itself, ready to write into `widgets.manifest_json`. */
  latestManifest: Manifest;
}

/** Minimal row shape `checkUpdates` needs from `widgets`. */
export interface WidgetLike {
  id: string;
  manifest_json: string;
}

/** Minimal row shape `checkUpdates` needs from `user_manifests`. */
export interface UserManifestLike {
  manifest_id: string;
  manifest_json: string;
  origin: string;
}

export type RegistryFetcher = () => Promise<{ items: { manifest: unknown; version?: string }[] }>;

const DEFAULT_FETCHER: RegistryFetcher = async () => {
  const base = process.env.NEXT_PUBLIC_BASE_URL || '';
  const r = await fetch(`${base}/api/market`, { cache: 'no-store' });
  if (!r.ok) return { items: [] };
  const j = (await r.json()) as { items: { manifest: unknown; version?: string }[] };
  return { items: j.items ?? [] };
};

/**
 * Pure: compare installed widgets against the registry and report which
 * instances have a newer version available.
 *
 * Rules:
 *   - Built-in widgets (no matching row in `user_manifests`) are skipped:
 *     they're versioned with the repo, not the market.
 *   - `origin='custom'` user manifests are skipped: they're authored by the
 *     user / a skill, not pulled from the registry, so the registry has no
 *     meaningful "newer" to compare against.
 *   - A widget with no `version` on either side is treated as 0.0.0
 *     (handled by `isNewer`).
 *
 * The fetcher + widget/user-manifest lists are injected so tests can run
 * without spinning up SQLite or HTTP.
 */
export async function findAvailableUpdates(
  widgets: WidgetLike[],
  userManifests: UserManifestLike[],
  fetcher: RegistryFetcher = DEFAULT_FETCHER,
): Promise<WidgetUpdate[]> {
  // Index user manifests by manifest_id so each widget can look up "where
  // did this manifest come from?" in O(1).
  const userByManifestId = new Map<string, UserManifestLike>();
  for (const u of userManifests) userByManifestId.set(u.manifest_id, u);

  // Pull + validate the registry once.
  let reg: Awaited<ReturnType<RegistryFetcher>>;
  try {
    reg = await fetcher();
  } catch {
    return [];
  }
  const remoteByManifestId = new Map<string, { manifest: Manifest; version: string }>();
  for (const e of reg.items ?? []) {
    const r = safeValidateManifest(e.manifest);
    if (!r.success) continue;
    const v = r.data.version ?? e.version ?? '';
    if (!v) continue;
    if (!remoteByManifestId.has(r.data.id)) remoteByManifestId.set(r.data.id, { manifest: r.data, version: v });
  }

  const out: WidgetUpdate[] = [];
  for (const w of widgets) {
    let parsedInstalled: unknown;
    try {
      parsedInstalled = JSON.parse(w.manifest_json);
    } catch {
      continue;
    }
    const installedId = (parsedInstalled as { id?: string })?.id;
    if (!installedId) continue;
    const user = userByManifestId.get(installedId);
    // Not installed from market → skip. No row, or `origin !== 'installed'`.
    if (!user || user.origin !== 'installed') continue;
    let installedParsed: unknown;
    try {
      installedParsed = JSON.parse(user.manifest_json);
    } catch {
      continue;
    }
    const installedVersion = ((installedParsed as { version?: string })?.version ?? '').trim() || null;
    const remote = remoteByManifestId.get(installedId);
    if (!remote) continue;
    if (!isNewer(remote.version, installedVersion)) continue;
    out.push({
      widgetId: w.id,
      manifestId: installedId,
      installedVersion,
      latestVersion: remote.version,
      latestManifest: remote.manifest,
    });
  }
  return out;
}
