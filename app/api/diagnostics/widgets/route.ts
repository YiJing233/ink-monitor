import { NextResponse } from 'next/server';
import { cookies, headers } from 'next/headers';
import { getRequiredUserId } from '@/lib/session';
import { listWidgets, listDashboards, latestWidgetResolve } from '@/lib/db';
import { safeValidateManifest } from '@/lib/widgets/ir';
import { safeJson } from '@/lib/safe-json';
import { resolveLocale, t } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

/**
 * GET /api/diagnostics/widgets
 *
 * Owner-only diagnostic view of the current user's widget platform state.
 * Reports each widget instance with its manifest validation status, the most
 * recent source-resolution timing + outcome (sourced from `widget_resolve_log`),
 * plus a summary of every dashboard and the devices that have a layout for it.
 *
 * Designed for the admin / debug surface: a single payload that answers
 * "what do I have, is each manifest valid, did its last resolve succeed, and
 * where is it placed?" without the caller having to fan-out to /api/widgets
 * and /api/dashboards.
 *
 * Auth: requires an authenticated session (`getRequiredUserId`).
 *
 * The `validate` field is human-facing text (e.g. "fail: <reason>") and is
 * localized to the request's `NEXT_LOCALE` cookie / Accept-Language. The
 * exact reason comes from Zod, so we don't translate that; the prefix and
 * the "ok" sentinel are translated. Consumers that need a stable machine
 * code should switch to a separate `validateCode` field — out of scope for
 * now (this is a debug endpoint, not a public API).
 *
 * Response shape:
 *   {
 *     userId,
 *     locale,
 *     widgets: [
 *       { instanceId, manifestId, version, validate, source, refresh,
 *         lastResolveMs, lastError, lastResolvedAt }
 *     ],
 *     dashboards: [
 *       { id, name, widgetCount, devices }
 *     ]
 *   }
 *
 * `lastResolveMs` / `lastError` / `lastResolvedAt` come from the
 * `widget_resolve_log` table (written by the Source layer each time
 * `resolveSource` runs for a widget instance). They are `null` when no
 * resolve has been recorded yet — e.g. a widget that was never placed on a
 * dashboard, or one whose manifest was corrupt at validate time and so never
 * reached the source layer. `lastResolvedAt` is an ISO-8601 string for easy
 * client rendering.
 */
export async function GET() {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'content-language': 'en' } },
    );
  }

  // Resolve the request's locale for the human-facing `validate` strings.
  // We don't fail the request if cookie/headers are unavailable — fall back
  // to the default English dictionary.
  let locale: ReturnType<typeof resolveLocale> = 'en';
  try {
    const c = await cookies();
    const h = await headers();
    locale = resolveLocale(c.get('NEXT_LOCALE')?.value || null, h.get('accept-language'));
  } catch {
    /* use 'en' default */
  }

  const widgets = listWidgets(userId).map((w) => {
    let parsed: unknown = null;
    let parseErr: string | null = null;
    try {
      parsed = JSON.parse(w.manifest_json);
    } catch (e) {
      parseErr = e instanceof Error ? e.message : t(locale, 'api.diag.invalidJson');
    }

    let validate: string;
    let manifestId: string | null = null;
    let version: string | null = null;
    let source: string | null = null;
    let refresh: number | null = null;

    if (parseErr) {
      validate = t(locale, 'api.diag.validate.parseError', { message: parseErr });
    } else {
      const r = safeValidateManifest(parsed);
      if (r.success) {
        validate = t(locale, 'api.diag.validate.ok');
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
        validate = t(locale, 'api.diag.validate.failed', { message: reason });
        // Best-effort fields even on failure: pull what we can from the raw
        // object so the response is still useful for triage.
        const raw = parsed as { id?: unknown; version?: unknown; source?: { kind?: unknown }; refresh?: unknown };
        manifestId = typeof raw.id === 'string' ? raw.id : null;
        version = typeof raw.version === 'string' ? raw.version : null;
        source = raw.source && typeof raw.source.kind === 'string' ? raw.source.kind : null;
        refresh = typeof raw.refresh === 'number' ? raw.refresh : null;
      }
    }

    // Pull the most recent source-resolution row for this widget instance
    // (per-instrumentation history lives in `widget_resolve_log`). `null`
    // means we've never resolved it — typical for an orphan widget that
    // isn't placed on any dashboard, or whose manifest was corrupt at
    // validate time and so never reached the source layer.
    const last = latestWidgetResolve(userId, w.id);
    return {
      instanceId: w.id,
      manifestId,
      version,
      validate,
      source,
      refresh,
      lastResolveMs: last?.ms ?? null,
      lastError: last?.error ?? null,
      lastResolvedAt: last ? new Date(last.ts).toISOString() : null,
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

  return NextResponse.json(
    { userId, locale, widgets, dashboards },
    { headers: { 'content-language': locale } },
  );
}
