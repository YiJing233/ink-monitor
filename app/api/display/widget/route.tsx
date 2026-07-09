import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getCurrentUserId, getUserIdFromShareToken } from '@/lib/session';
import { getWidget, listDashboards, type DashboardRow } from '@/lib/db';
import { safeJson } from '@/lib/safe-json';
import { getDevice, type DeviceId } from '@/lib/widgets/devices';
import { validateManifest, type Manifest } from '@/lib/widgets/ir';
import { rectPx, type Placement } from '@/lib/widgets/placement';
import { resolveSource } from '@/lib/widgets/source';
import { WidgetRenderer } from '@/lib/widgets/render/WidgetRenderer';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/display/widget?instance=<placementId>&share=<token>
 *
 * Returns a single, freshly-resolved widget HTML fragment for the SSE `patch`
 * event to splice back into the live DOM. The response is JUST the
 * `<div data-w-inst="<id>">…</div>` wrapper that DashboardCanvas emits (no
 * `data-display-root` around it) so the client can do
 * `node.outerHTML = responseText` and the absolute-positioned layout, the
 * `data-w-inst` key, and the WidgetRenderer output all arrive together.
 *
 * Why a dedicated endpoint instead of a full /display re-render:
 *   - The SSE patch fires once per widget per refresh tick — re-rendering the
 *     whole dashboard would (a) be expensive (every widget does an upstream
 *     fetch on the source layer), and (b) cost more on the wire than the
 *     full-page body even when only one tile changed.
 *   - The wire format is a tiny slice of HTML; the patch is two sequential
 *     round-trips (patch-event → widget-fetch), each tens of bytes.
 *
 * Auth: same model as /api/display/stream — session OR a valid `?share=`
 * token. The two endpoints MUST agree on auth because the token is forwarded
 * from /display and the browser's EventSource won't attach cookies for a
 * cross-origin SSE if it ever moves.
 */
interface FoundInstance {
  dashboard: DashboardRow;
  deviceId: DeviceId;
  placement: Placement;
  manifest: Manifest;
  config: Record<string, unknown>;
}

/**
 * Walk the user's dashboards and find the placement whose id matches
 * `instanceId`. Returns the full context needed to render: the dashboard row
 * (for ownership), the device (to compute the absolute rect), the placement
 * geometry, the validated manifest, and the per-instance config.
 *
 * Returns null when no placement matches — the route maps that to a 404.
 *
 * Note: placement ids are scoped to their dashboard. A single owner could in
 * principle have two placements with the same id across different dashboards
 * — we return the first match. The canvas editor never produces a
 * cross-dashboard collision in practice (uids are 6-hex chars); documenting
 * the tiebreaker here so a future refactor that allows collisions doesn't
 * silently pick a different widget.
 */
function findInstance(userId: string, instanceId: string): FoundInstance | null {
  const dashboards = listDashboards(userId);
  for (const dashboard of dashboards) {
    const layouts = safeJson(dashboard.layouts_json, 'dashboards.layouts_json') as Partial<
      Record<DeviceId, Placement[]>
    >;
    for (const deviceIdStr of Object.keys(layouts) as DeviceId[]) {
      const placements = layouts[deviceIdStr] ?? [];
      for (const p of placements) {
        if (p.id !== instanceId) continue;
        const widgetRow = getWidget(userId, p.widgetId);
        if (!widgetRow) continue;
        let manifest: Manifest;
        try {
          manifest = validateManifest(JSON.parse(widgetRow.manifest_json));
        } catch {
          // Corrupt manifest on a placement the SSE was about to patch —
          // the regular page render would have skipped it too. 404 here is
          // the right outcome: we can't render partial HTML for an
          // unvalidated IR.
          continue;
        }
        const config =
          (safeJson(widgetRow.config_json, 'widgets.config_json') as Record<string, unknown>) || {};
        return { dashboard, deviceId: deviceIdStr, placement: p, manifest, config };
      }
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  // --- Auth gate (mirrors /api/display/stream) -------------------------------
  let userId = await getCurrentUserId();
  if (!userId) {
    userId = await getUserIdFromShareToken(req.nextUrl.searchParams.get('share'));
  }
  if (!userId) {
    return NextResponse.json(
      { error: 'auth required' },
      { status: 401, headers: { 'Cache-Control': 'no-store, must-revalidate' } },
    );
  }

  const instanceId = req.nextUrl.searchParams.get('instance');
  if (!instanceId) {
    return NextResponse.json({ error: 'instance required' }, { status: 400 });
  }

  const found = findInstance(userId, instanceId);
  if (!found) {
    // 404 is intentionally distinct from a 401 — the page may want to fall
    // back to a full reload for legacy provider/stock ticks (no marker, no
    // partial-patch slice). The client treats !ok as "full reload" rather
    // than bailing.
    return NextResponse.json(
      { error: 'widget instance not found' },
      { status: 404, headers: { 'Cache-Control': 'no-store, must-revalidate' } },
    );
  }

  // --- Resolve data through the Source layer ---------------------------------
  // resolveSource may issue real HTTP fetches (http / album / calendar) but
  // for built-in widgets it piggy-backs on getDisplayData's per-render cache.
  // Either way, a single placement is far cheaper than resolving every widget
  // on the dashboard.
  const data = await resolveSource(found.manifest, found.config, { userId });

  // --- Render to the same wrapper the canvas uses ---------------------------
  // We deliberately don't reuse DashboardCanvas here: that component renders
  // the *full* canvas (data-display-root + every widget). We want only this
  // tile's outerHTML so the client can drop it in via `outerHTML = html` and
  // keep the data-w-inst marker identical (the locator key the SSE payload
  // uses to find the node in the live DOM).
  //
  // Implemented with createElement rather than JSX so this .tsx file
  // transforms correctly under vitest's esbuild (which uses the classic JSX
  // runtime here — there's no vitest config to opt into the automatic
  // runtime). Reading the inline the same way DashboardCanvas does is the
  // important part.
  const device = getDevice(found.deviceId);
  const r = rectPx(found.placement, device);
  const wrapperStyle = {
    position: 'absolute' as const,
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
  };
  const html = renderToStaticMarkup(
    createElement(
      'div',
      { 'data-w-inst': found.placement.id, style: wrapperStyle },
      createElement(WidgetRenderer, {
        manifest: found.manifest,
        data,
        w: found.placement.w,
        h: found.placement.h,
      }),
    ),
  );

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Each patch is a one-shot fragment — the browser must not cache it,
      // else a later tick with the same byte payload would replay stale HTML.
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}
