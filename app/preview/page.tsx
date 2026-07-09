/**
 * 1:1 e-ink preview. Renders a dashboard at the device's native pixel size
 * through the same DashboardCanvas / WidgetRenderer that /display uses — so the
 * web preview is a perfect replica of the glass (one renderer, no drift). The
 * canvas editor iframes this route and scales it down.
 *
 * Public (not in the middleware matcher): it renders only built-in sample data.
 *
 * Query: ?d=<urlencoded JSON {device, items:[{m,x,y,w,h}]}>
 */
import type { DeviceId } from '@/lib/widgets/devices';
import type { Placement } from '@/lib/widgets/placement';
import { BUILTIN_MANIFESTS, SAMPLE_DATA } from '@/lib/widgets/registry';
import { DashboardCanvas, type CanvasItem } from '@/lib/widgets/render/DashboardCanvas';
import { getCurrentUserId } from '@/lib/session';
import { getDashboard, listUserManifests } from '@/lib/db';
import { resolveDashboard } from '@/lib/widgets/source';
import type { Manifest } from '@/lib/widgets/ir';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface LightItem {
  m: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface LightDash {
  device: DeviceId;
  items: LightItem[];
}

const SAMPLE: LightDash = {
  device: 'kindle-pw',
  items: [
    { m: 'api-usage', x: 0, y: 0, w: 2, h: 2 },
    { m: 'todo-lark', x: 2, y: 0, w: 2, h: 2 },
    { m: 'gallery', x: 0, y: 2, w: 2, h: 2 },
    { m: 'stocks-table', x: 2, y: 2, w: 2, h: 2 },
  ],
};

export default async function PreviewPage({ searchParams }: { searchParams: Promise<{ d?: string; dashboard?: string }> }) {
  const sp = await searchParams;

  // Real-data mode: render the logged-in owner's actual dashboard 1:1 (same
  // renderer as /display). Only ever renders the requester's own dashboard.
  if (sp.dashboard) {
    const userId = await getCurrentUserId();
    if (userId) {
      const row = getDashboard(userId, sp.dashboard);
      if (row) {
        const { deviceId, items } = await resolveDashboard(userId, row);
        return <DashboardCanvas deviceId={deviceId} items={items} />;
      }
    }
  }

  let dash: LightDash = SAMPLE;
  if (sp.d) {
    try {
      const parsed = JSON.parse(sp.d);
      if (parsed && Array.isArray(parsed.items)) dash = parsed;
    } catch {
      // keep sample
    }
  }

  // Resolve custom manifests from the logged-in owner's library so the live
  // layout preview also covers skill-authored / installed widgets.
  const userId = await getCurrentUserId();
  const userLib = new Map<string, Manifest>();
  if (userId) {
    for (const r of listUserManifests(userId)) {
      try {
        const m = JSON.parse(r.manifest_json) as Manifest;
        userLib.set(m.id, m);
      } catch {
        /* ignore */
      }
    }
  }

  const items: CanvasItem[] = dash.items
    .map((it, i): CanvasItem | null => {
      const manifest = BUILTIN_MANIFESTS[it.m] ?? userLib.get(it.m);
      if (!manifest) return null;
      const placement: Placement = { id: String(i), widgetId: it.m, x: it.x, y: it.y, w: it.w, h: it.h };
      // Sample data for built-ins; demo-source data for custom; else empty (layout still renders).
      const data = SAMPLE_DATA[it.m] ?? (manifest.source.kind === 'demo' ? manifest.source.data : {}) ?? {};
      // Lightweight preview mode: there's no real widget row id in the URL —
      // we synthesize one from the index so `NotesWidget`'s QR link is at
      // least syntactically valid (it'll 404 on click, which is the expected
      // behavior in a sandboxed preview).
      return { placement, manifest, data, widgetInstanceId: `preview-${i}` };
    })
    .filter((x): x is CanvasItem => x !== null);

  return <DashboardCanvas deviceId={dash.device} items={items} />;
}
