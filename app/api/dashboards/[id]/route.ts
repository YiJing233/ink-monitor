import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRequiredUserId } from '@/lib/session';
import {
  getDashboard,
  updateDashboard,
  deleteDashboard,
  getWidget,
  insertWidget,
  listWidgets,
  deleteWidget,
  listDashboards,
  withTx,
} from '@/lib/db';
import { DEVICE_IDS } from '@/lib/widgets/devices';
import { BUILTIN_MANIFESTS } from '@/lib/widgets/registry';
import { safeValidateManifest, type Manifest } from '@/lib/widgets/ir';
import { hasCollision, type Placement } from '@/lib/widgets/placement';
import { safeJson } from '@/lib/safe-json';
import { randomId } from '@/lib/utils';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const PlacementSchema = z.object({
  id: z.string(),
  widgetId: z.string(),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});

// F22: refresh_overrides contract. The map is keyed by `DeviceId` and each
// value is either an integer in [15, 86400] (a per-device cap on refresh
// frequency, in seconds) or `null` (no override for that device). Values
// outside this range would either burn the e-ink panel (< 15s) or
// effectively disable refresh (> 1 day), so we reject up front rather than
// silently clamping on the read path. The display side also re-applies
// the floor of 15s as defense-in-depth for legacy rows — see the
// `refresh_overrides_json` comment in `lib/db.ts`.
const DeviceIdSchema = z.enum(DEVICE_IDS as [string, ...string[]]);
const RefreshOverrideValueSchema = z.union([z.number().int().min(15).max(86400), z.null()]);
const RefreshOverridesSchema = z.record(DeviceIdSchema, RefreshOverrideValueSchema);

const PatchSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  base_device: DeviceIdSchema.optional(),
  display_order: z.number().int().optional(),
  // layouts: { [deviceId]: Placement[] }
  layouts: z.record(z.array(PlacementSchema)).optional(),
  // refresh_overrides: { [deviceId]: refreshSeconds | null }
  refresh_overrides: RefreshOverridesSchema.optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const d = getDashboard(userId, id);
  if (!d) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ dashboard: d });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  if (!getDashboard(userId, id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.base_device !== undefined) patch.base_device = parsed.data.base_device;
  if (parsed.data.display_order !== undefined) patch.display_order = parsed.data.display_order;
  if (parsed.data.layouts !== undefined) patch.layouts_json = JSON.stringify(parsed.data.layouts);
  if (parsed.data.refresh_overrides !== undefined) patch.refresh_overrides_json = JSON.stringify(parsed.data.refresh_overrides);

  updateDashboard(userId, id, patch);
  recordAudit({
    userId,
    action: 'dashboard.update',
    targetType: 'dashboard',
    targetId: id,
    // Summarize what changed -- layouts/refresh_overrides are large JSON, so
    // record only the shape (per-device counts + override keys) instead of
    // the full payload to keep the audit table readable.
    after: {
      name: parsed.data.name !== undefined,
      base_device: parsed.data.base_device !== undefined,
      display_order: parsed.data.display_order !== undefined,
      layouts_devices: parsed.data.layouts ? Object.keys(parsed.data.layouts) : undefined,
      refresh_overrides_devices: parsed.data.refresh_overrides
        ? Object.keys(parsed.data.refresh_overrides)
        : undefined,
    },
  });
  return NextResponse.json({ ok: true });
}

// Full canvas save: rebuild this device's layout from the editor's items in one
// atomic call. Each item becomes a fresh widget instance; the device's layout is
// rewritten to reference them; orphaned widgets (no longer in any layout) are GC'd.
// The client just sends the whole canvas — no widget-id juggling.
const SaveSchema = z.object({
  device: z.enum(DEVICE_IDS as [string, ...string[]]),
  items: z.array(
    z.object({
      widgetId: z.string().optional(), // reuse an existing instance's manifest
      manifestId: z.string().optional(), // instantiate a built-in
      manifest: z.any().optional(), // or an inline manifest
      config: z.record(z.any()).optional(),
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      w: z.number().int().min(1),
      h: z.number().int().min(1),
    }),
  ),
});

function gcWidgets(userId: string): void {
  // NOTE: GC is user-scoped, not dashboard-scoped. We sweep any widget that no
  // dashboard layout references, so saves on dashboard A can legitimately
  // remove widgets that only lived on dashboard B. This is intentional
  // (widgets are addressable by ID across the user's whole canvas) — see the
  // PUT handler's commit comment. If finer-grained, per-dashboard GC is
  // wanted, restrict the outer loop to `dashboards where id = $id`.
  const referenced = new Set<string>();
  for (const d of listDashboards(userId)) {
    const layouts = safeJson(d.layouts_json || '{}', 'gc.dashboards.layouts_json') as Record<string, { widgetId?: string }[]>;
    for (const arr of Object.values(layouts)) for (const p of arr || []) if (p?.widgetId) referenced.add(p.widgetId);
  }
  for (const w of listWidgets(userId)) if (!referenced.has(w.id)) deleteWidget(userId, w.id);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const dash = getDashboard(userId, id);
  if (!dash) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const placements: { id: string; widgetId: string; x: number; y: number; w: number; h: number }[] = [];
  const widgetPayloads: { widgetId: string; manifest: Manifest; config: Record<string, any> }[] = [];
  for (const it of parsed.data.items) {
    let manifest: Manifest;
    if (it.manifest !== undefined) {
      const r = safeValidateManifest(it.manifest);
      if (!r.success) return NextResponse.json({ error: 'invalid manifest', issues: r.error.flatten() }, { status: 400 });
      manifest = r.data;
    } else if (it.manifestId && BUILTIN_MANIFESTS[it.manifestId]) {
      manifest = BUILTIN_MANIFESTS[it.manifestId];
    } else if (it.widgetId) {
      const w = getWidget(userId, it.widgetId);
      if (!w) return NextResponse.json({ error: `unknown widget ${it.widgetId}` }, { status: 400 });
      try {
        manifest = JSON.parse(w.manifest_json);
      } catch {
        return NextResponse.json({ error: 'corrupt widget manifest' }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: 'item needs manifestId, manifest, or widgetId' }, { status: 400 });
    }
    const wid = randomId();
    placements.push({ id: randomId(), widgetId: wid, x: it.x, y: it.y, w: it.w, h: it.h });
    widgetPayloads.push({ widgetId: wid, manifest, config: it.config ?? {} });
  }

  // F19: server-side collision check. The client UI already prevents overlaps,
  // but the PUT path was an open door — any caller (curl, replayed request,
  // buggy client) could write a layout with two widgets on top of each other,
  // and the renderer would silently draw garbage. Reject the whole save up
  // front, before we open the transaction.
  for (const p of placements as Placement[]) {
    if (hasCollision(placements as Placement[], p, p.id)) {
      return NextResponse.json({ error: 'placement collision' }, { status: 400 });
    }
  }

  const layouts = safeJson(dash.layouts_json || '{}', 'dashboards.layouts_json') as Record<string, unknown>;
  layouts[parsed.data.device] = placements;
  const newLayoutsJson = JSON.stringify(layouts);

  // Wrap all writes (widget inserts + dashboard update + GC) in a single SQLite
  // transaction so concurrent PUTs can't step on each other and a failed insert
  // can't leave the dashboard pointing at half-written widgets. Note: GC is
  // intentionally user-scoped (not dashboard-scoped) — see gcWidgets below.
  try {
    withTx(() => {
      for (const wp of widgetPayloads) {
        insertWidget({
          id: wp.widgetId,
          user_id: userId,
          manifest_json: JSON.stringify(wp.manifest),
          config_json: JSON.stringify(wp.config),
        });
      }
      updateDashboard(userId, id, { layouts_json: newLayoutsJson });
      gcWidgets(userId);
    });
  } catch {
    return NextResponse.json({ error: 'save failed' }, { status: 500 });
  }

  // Snapshot just the manifest ids we instantiated (no config / placement
  // payload) — enough to answer "what lives on this dashboard now" without
  // bloating the audit table with potentially-large layout JSON.
  recordAudit({
    userId,
    action: 'dashboard.save',
    targetType: 'dashboard',
    targetId: id,
    after: {
      device: parsed.data.device,
      count: placements.length,
      manifest_ids: widgetPayloads.map((w) => w.manifest.id),
    },
  });

  return NextResponse.json({ ok: true, count: placements.length });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const existing = getDashboard(userId, id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  deleteDashboard(userId, id);
  recordAudit({
    userId,
    action: 'dashboard.delete',
    targetType: 'dashboard',
    targetId: id,
    before: { name: existing.name, base_device: existing.base_device },
  });
  return NextResponse.json({ ok: true });
}
