import { cookies, headers } from 'next/headers';
import { getCurrentUserId } from '@/lib/session';
import { listDashboards, listWidgets, listUserManifests } from '@/lib/db';
import { safeJson } from '@/lib/safe-json';
import { BUILTIN_MANIFESTS } from '@/lib/widgets/registry';
import { validateManifest, type Manifest } from '@/lib/widgets/ir';
import type { DeviceId } from '@/lib/widgets/devices';
import { resolveLocale, t } from '@/lib/i18n';
import { findAvailableUpdates, type WidgetUpdate } from '@/lib/widgets/auto-update';
import CanvasEditor, { type EditorInitial, type EditorItem } from './canvas-editor';
import UpdateBanner from './update-banner';

export const dynamic = 'force-dynamic';

export default async function CanvasPage() {
  const userId = await getCurrentUserId();
  const c = await cookies();
  const h = await headers();
  const locale = resolveLocale(c.get('NEXT_LOCALE')?.value || null, h.get('accept-language'));
  const userManifests = userId ? loadUserManifests(userId) : [];

  // Catalog = built-ins + the user's library (custom / skill-authored / installed).
  const catalog = new Map<string, Manifest>();
  for (const m of Object.values(BUILTIN_MANIFESTS)) catalog.set(m.id, m);
  for (const m of userManifests) if (!catalog.has(m.id)) catalog.set(m.id, m);

  const initial: EditorInitial = userId
    ? loadInitial(userId, catalog)
    : { dashboardId: null, name: 'My dashboard', device: 'kindle-pw', layouts: {}, refreshOverrides: {} };

  // Auto-update check: for every installed widget on the canvas, ask the
  // registry if a newer version is available. The banner only shows when
  // the list is non-empty; the route at /api/widgets/batch-update re-runs
  // the same check on POST so we never drift between banner and server.
  const updates: WidgetUpdate[] = userId
    ? await loadUpdates(userId, initial.dashboardId)
    : [];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{t(locale, 'admin.canvas.h')}</h2>
      <p className="hint" dangerouslySetInnerHTML={{ __html: t(locale, 'admin.canvas.body') }} />
      <UpdateBanner
        dashboardId={initial.dashboardId}
        updates={updates.map((u) => ({
          widgetId: u.widgetId,
          manifestId: u.manifestId,
          installedVersion: u.installedVersion,
          latestVersion: u.latestVersion,
        }))}
      />
      <CanvasEditor initial={initial} userManifests={userManifests} locale={locale} />
    </div>
  );
}

/**
 * Compute the auto-update banner payload. We restrict the check to widgets
 * that are *actually on the active dashboard* — orphan widgets (referenced
 * by no layout) shouldn't trigger the banner, since the user has already
 * "abandoned" them on the canvas.
 *
 * Failures are swallowed: a downed registry must never break the canvas
 * page render — the banner just doesn't appear.
 */
async function loadUpdates(userId: string, dashboardId: string | null): Promise<WidgetUpdate[]> {
  if (!dashboardId) return [];
  try {
    const all = listWidgets(userId);
    const byId = new Map(all.map((w) => [w.id, w]));
    const dash = listDashboards(userId).find((d) => d.id === dashboardId);
    if (!dash) return [];
    const layouts = safeJson(dash.layouts_json || '{}', 'canvas.dashboards.layouts_json') as Record<
      string,
      { widgetId: string }[]
    >;
    const onCanvasIds = new Set<string>();
    for (const arr of Object.values(layouts)) for (const p of arr || []) if (p?.widgetId) onCanvasIds.add(p.widgetId);
    const onCanvas = Array.from(onCanvasIds)
      .map((id) => byId.get(id))
      .filter((w): w is NonNullable<typeof w> => !!w);
    const userManifests = listUserManifests(userId).map((r) => ({
      manifest_id: r.manifest_id,
      manifest_json: r.manifest_json,
      origin: r.origin,
    }));
    return await findAvailableUpdates(onCanvas, userManifests);
  } catch {
    return [];
  }
}

function loadUserManifests(userId: string): Manifest[] {
  const out: Manifest[] = [];
  for (const r of listUserManifests(userId)) {
    try {
      out.push(validateManifest(JSON.parse(r.manifest_json)));
    } catch {
      /* skip out-of-spec library entries */
    }
  }
  return out;
}

function loadInitial(userId: string, catalog: Map<string, Manifest>): EditorInitial {
  const dash = listDashboards(userId)[0];
  if (!dash) return { dashboardId: null, name: 'My dashboard', device: 'kindle-pw', layouts: {}, refreshOverrides: {} };

  const device = dash.base_device as DeviceId;
  // The on-disk layout uses `widgetId` (the *instance* id) — we resolve it
  // back to a `manifestId` by looking up the row in the `widgets` table.
  const raw = safeJson(dash.layouts_json || '{}', 'canvas.dashboards.layouts_json') as Record<
    string,
    { widgetId: string; x: number; y: number; w: number; h: number }[]
  >;
  const byId = new Map(listWidgets(userId).map((w) => [w.id, w]));

  const layouts: Partial<Record<DeviceId, EditorItem[]>> = {};
  for (const [dev, placements] of Object.entries(raw)) {
    const arr: EditorItem[] = [];
    for (const p of placements) {
      const w = byId.get(p.widgetId);
      if (!w) continue;
      let manifestId = '';
      try {
        manifestId = JSON.parse(w.manifest_json).id;
      } catch {
        /* ignore */
      }
      if (!manifestId || !catalog.has(manifestId)) continue;
      arr.push({ widgetInstanceId: p.widgetId, manifestId, x: p.x, y: p.y, w: p.w, h: p.h });
    }
    layouts[dev as DeviceId] = arr;
  }
  const refreshOverrides = safeJson(
    dash.refresh_overrides_json || '{}',
    'canvas.dashboards.refresh_overrides_json',
  ) as Partial<Record<DeviceId, number>>;
  return { dashboardId: dash.id, name: dash.name, device, layouts, refreshOverrides };
}
