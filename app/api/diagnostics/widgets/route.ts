import { NextResponse } from 'next/server';
import { getRequiredUserId } from '@/lib/session';
import { listWidgets, listDashboards } from '@/lib/db';
import { safeValidateManifest } from '@/lib/widgets/ir';
import { safeJson } from '@/lib/safe-json';

export const dynamic = 'force-dynamic';

/**
 * GET /api/diagnostics/widgets
 *
 * Owner-only diagnostic view of the current user's widget platform state.
 * Reports each widget instance with its manifest validation status, plus a
 * summary of every dashboard and the devices that have a layout for it.
 *
 * Designed for the admin / debug surface: a single payload that answers
 * "what do I have, is each manifest valid, and where is it placed?"
 * without the caller having to fan-out to /api/widgets and /api/dashboards.
 *
 * Auth: requires an authenticated session (`getRequiredUserId`).
 *
 * Response shape:
 *   {
 *     userId,
 *     widgets: [
 *       { instanceId, manifestId, version, validate, source, refresh,
 *         lastResolveMs, lastError, lastResolvedAt }
 *     ],
 *     dashboards: [
 *       { id, name, widgetCount, devices }
 *     ]
 *   }
 *
 * `lastResolveMs` / `lastError` / `lastResolvedAt` are placeholders for a
 * future `widget_resolve_log` table (per-instrumentation history of source
 * resolution). They are always `null` for now; the schema is reserved so the
 * client contract doesn't have to shift when the table lands.
 */
export async function GET() {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const widgets = listWidgets(userId).map((w) => {
    let parsed: unknown = null;
    let parseErr: string | null = null;
    try {
      parsed = JSON.parse(w.manifest_json);
    } catch (e) {
      parseErr = e instanceof Error ? e.message : 'invalid JSON';
    }

    let validate: string;
    let manifestId: string | null = null;
    let version: string | null = null;
    let source: string | null = null;
    let refresh: number | null = null;

    if (parseErr) {
      validate = `fail: manifest_json parse error: ${parseErr}`;
    } else {
      const r = safeValidateManifest(parsed);
      if (r.success) {
        validate = 'ok';
        manifestId = r.data.id;
        version = r.data.version ?? null;
        source = r.data.source.kind;
        refresh = r.data.refresh ?? null;
      } else {
        // Surface the first Zod issue's message — enough for the operator to
        // know what's wrong without dumping the full issue tree into the JSON
        // response. `flatten()` gives a stable `{ formErrors, fieldErrors }`
        // shape; prefer a per-field message if present, else the form-level.
        const flat = r.error.flatten() as { formErrors: string[]; fieldErrors: Record<string, string[]> };
        const firstField = Object.values(flat.fieldErrors).find((arr) => arr && arr.length);
        const reason = (firstField && firstField[0]) || flat.formErrors[0] || r.error.message;
        validate = `fail: ${reason}`;
        // Best-effort fields even on failure: pull what we can from the raw
        // object so the response is still useful for triage.
        const raw = parsed as { id?: unknown; version?: unknown; source?: { kind?: unknown }; refresh?: unknown };
        manifestId = typeof raw.id === 'string' ? raw.id : null;
        version = typeof raw.version === 'string' ? raw.version : null;
        source = raw.source && typeof raw.source.kind === 'string' ? raw.source.kind : null;
        refresh = typeof raw.refresh === 'number' ? raw.refresh : null;
      }
    }

    return {
      instanceId: w.id,
      manifestId,
      version,
      validate,
      source,
      refresh,
      lastResolveMs: null,
      lastError: null,
      lastResolvedAt: null,
    };
  });

  const dashboards = listDashboards(userId).map((d) => {
    const layouts = safeJson(d.layouts_json || '{}', 'dashboards.layouts_json') as Record<string, unknown>;
    const devices = Object.keys(layouts).filter((k) => Array.isArray(layouts[k]) && (layouts[k] as unknown[]).length > 0);
    // Count distinct widget instances referenced across all device layouts —
    // a widget can be placed on multiple devices for the same dashboard, so we
    // dedupe by `widgetId`. Placements are objects with a `widgetId` field
    // (see lib/widgets/placement.ts#Placement); coerce defensively because
    // legacy rows written before the schema locked may not match exactly.
    const ids = new Set<string>();
    for (const arr of Object.values(layouts)) {
      if (!Array.isArray(arr)) continue;
      for (const p of arr) {
        const id = (p as { widgetId?: unknown })?.widgetId;
        if (typeof id === 'string' && id) ids.add(id);
      }
    }
    return { id: d.id, name: d.name, widgetCount: ids.size, devices };
  });

  return NextResponse.json({ userId, widgets, dashboards });
}
