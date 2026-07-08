import { getCurrentUserId } from '@/lib/session';
import { listDashboards, listWidgets, listUserManifests } from '@/lib/db';
import { safeJson } from '@/lib/safe-json';
import { BUILTIN_MANIFESTS } from '@/lib/widgets/registry';
import { validateManifest, type Manifest } from '@/lib/widgets/ir';
import type { DeviceId } from '@/lib/widgets/devices';
import CanvasEditor, { type EditorInitial, type EditorItem } from './canvas-editor';

export const dynamic = 'force-dynamic';

export default async function CanvasPage() {
  const userId = await getCurrentUserId();
  const userManifests = userId ? loadUserManifests(userId) : [];

  // Catalog = built-ins + the user's library (custom / skill-authored / installed).
  const catalog = new Map<string, Manifest>();
  for (const m of Object.values(BUILTIN_MANIFESTS)) catalog.set(m.id, m);
  for (const m of userManifests) if (!catalog.has(m.id)) catalog.set(m.id, m);

  const initial: EditorInitial = userId
    ? loadInitial(userId, catalog)
    : { dashboardId: null, name: 'My dashboard', device: 'kindle-pw', layouts: {}, refreshOverrides: {} };

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Canvas</h2>
      <p className="hint">
        拖拽排布小组件，右侧是水墨屏 <strong>1:1 实时预览</strong>。点 <strong>保存</strong> 写入你的看板，
        之后 <code>/display</code> 渲染它；保存后可「查看真实数据」用自己的数据 1:1 预览。自定义组件（◇）来自 skill
        或 <a href="/admin/market">Market</a> 安装。
        <br />
        <strong>每个设备各存一份布局 + 刷新节奏</strong>：切换设备会载入该设备已存的布局，没有就从当前布局自动重排作为起点。
        <strong>刷新覆盖</strong>是「不低于 manifest 默认 refresh」的上限——你设得越低，刷得越勤（更费电）。
      </p>
      <CanvasEditor initial={initial} userManifests={userManifests} />
    </div>
  );
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
