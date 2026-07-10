import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRequiredUserId } from '@/lib/session';
import {
  getDashboard,
  listDashboards,
  listWidgets,
  listUserManifests,
  updateWidget,
  upsertUserManifest,
} from '@/lib/db';
import { safeJson } from '@/lib/safe-json';
import { findAvailableUpdates, type WidgetUpdate } from '@/lib/widgets/auto-update';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  dashboardId: z.string().min(1).optional(),
});

/**
 * POST /api/widgets/batch-update — apply available widget updates on the
 * authenticated user's active dashboard.
 *
 * Why: the Canvas page surfaces an auto-update banner with a one-click
 * action. The client cannot be trusted to enumerate which widgets to
 * upgrade (it could lie about a peer user's manifests), so the server
 * re-runs `findAvailableUpdates` against the live registry / DB state and
 * only writes rows it itself agrees are safe to upgrade.
 *
 * Write path per upgrade:
 *   1. Update `widgets.manifest_json` for the instance (the manifest is the
 *      whole source of truth for what this widget renders — see ir.ts).
 *   2. Leave `widgets.config_json` untouched: per-instance config (city,
 *      provider id, etc.) is user data and should survive a manifest bump.
 *      Today's manifests use a permissive config object, so this is the
 *      safe default for the registry items we ship.
 *   3. Mirror the new manifest into `user_manifests` (origin preserved) so
 *      the catalog palette sees the upgraded version too.
 *   4. Audit one `widget.update` row with `after.auto_update = true`,
 *      `from`/`to` versions, and a human-readable reason string.
 *
 * Body `{ dashboardId }` is optional (rare — the server falls back to the
 * user's first dashboard). Without a dashboard the route can't tell "which
 * widgets do you care about" so it promotes nothing; the client should
 * always send the dashboard it intends.
 */
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    /* tolerate missing body */
  }
  const parsed = BodySchema.safeParse(raw ?? {});
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Find the dashboard the caller is acting on.
  const dashId = parsed.data.dashboardId;
  if (dashId) {
    if (!getDashboard(userId, dashId)) {
      return NextResponse.json({ error: 'dashboard not found' }, { status: 404 });
    }
  }

  // Build the candidate widget list. We *only* upgrade widgets that are
  // currently placed on the chosen (or first) dashboard — orphan widgets
  // aren't included so the user isn't surprised by a sweep.
  const widgets = listWidgets(userId);
  const widgetsOnDash = dashId
    ? widgetsOnDashboard(userId, dashId, widgets)
    : widgets; // fallback (tests): upgrade everything
  const userManifests = listUserManifests(userId).map((r) => ({
    manifest_id: r.manifest_id,
    manifest_json: r.manifest_json,
    origin: r.origin,
  }));

  const updates = await findAvailableUpdates(widgetsOnDash, userManifests);
  if (!updates.length) {
    return NextResponse.json({ ok: true, updated: 0, updates: [] });
  }

  for (const u of updates) {
    applyUpdate(userId, u);
  }

  return NextResponse.json({
    ok: true,
    updated: updates.length,
    updates: updates.map((u) => ({
      widgetId: u.widgetId,
      manifestId: u.manifestId,
      installedVersion: u.installedVersion,
      latestVersion: u.latestVersion,
    })),
  });
}

function widgetsOnDashboard(
  userId: string,
  dashboardId: string,
  all: ReturnType<typeof listWidgets>,
): ReturnType<typeof listWidgets> {
  const dash = listDashboards(userId).find((d) => d.id === dashboardId);
  if (!dash) return [];
  const layouts = safeJson(dash.layouts_json || '{}', 'canvas.dashboards.layouts_json') as Record<
    string,
    { widgetId: string }[]
  >;
  const ids = new Set<string>();
  for (const arr of Object.values(layouts)) for (const p of arr || []) if (p?.widgetId) ids.add(p.widgetId);
  return all.filter((w) => ids.has(w.id));
}

/**
 * Write the upgraded manifest back. The per-instance `config_json` is left
 * alone — manifest upgrades shouldn't reset user configuration unless the
 * new manifest removes a field the instance depended on, which we can't
 * detect from the IR alone. The market-published manifests today all carry
 * the same config shape for a given `id`, so preserving config_json is the
 * right default.
 */
function applyUpdate(userId: string, u: WidgetUpdate): void {
  const manifestJson = JSON.stringify(u.latestManifest);
  updateWidget(userId, u.widgetId, { manifest_json: manifestJson });
  // Mirror the manifest into the user's library so the palette sees the new
  // version too. Origin is preserved: `installed` widgets stay `installed`.
  upsertUserManifest(userId, u.manifestId, manifestJson, 'installed');
  recordAudit({
    userId,
    action: 'widget.update',
    targetType: 'widget',
    targetId: u.widgetId,
    after: {
      manifest_id: u.manifestId,
      auto_update: true,
      reason: `auto-update from v${u.installedVersion ?? '0.0.0'} to v${u.latestVersion}`,
      from: u.installedVersion,
      to: u.latestVersion,
    },
  });
}
