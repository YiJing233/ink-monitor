'use client';

/**
 * Snap-grid canvas editor (authoring plane). LEFT grid = interactive arrangement
 * (drag to move, corner handle to resize, both snap to cells). RIGHT pane = the
 * 1:1 device preview (an iframe to /preview at native px, scaled to fit).
 *
 * Per-device layouts: the editor holds one EditorItem[] per device. Switching
 * device loads that device's saved/edited layout, or seeds it by auto-reflowing
 * the current one. Save persists the active device's layout via PUT.
 *
 * Palette = built-ins + the user's library (custom/installed, marked ◇). Built-ins
 * save by manifestId; custom save inline as a manifest.
 *
 * EditorItem namespace:
 *   - `widgetInstanceId`  : the *widget instance* id (the row id in the
 *     `widgets` table; persisted as `widgetId` in `Placement` and the
 *     `layouts` payload). Stable per instance; survives reloads. For
 *     newly-added items the editor mints a fresh client-side id — it gets
 *     replaced with a real server id on the next save+reload.
 *   - `manifestId`        : the *manifest* id (the palette key — e.g.
 *     "api-usage", "stocks-table"). Identifies the widget TYPE, not the
 *     instance. Two EditorItems can share a manifestId with different
 *     widgetInstanceIds. Sent to the API as `manifestId` (for built-ins)
 *     or as an inline `manifest` (for custom).
 *
 * Don't conflate the two: `widgetInstanceId` is identity (which row), and
 * `manifestId` is type (what it renders). The two are linked through the
 * `widgets` table (instance.manifest_json.id === manifestId) but they
 * travel on different wires and must be tracked separately.
 *
 * Known limit: overlaps are allowed (no auto-resolve) — see ARCHITECTURE.md.
 */
import { useMemo, useRef, useState } from 'react';
import { DEVICE_IDS, DEVICES, getDevice, type DeviceId } from '@/lib/widgets/devices';
import { autoReflow, clampToGrid, hasCollision, resolveFamily, type Placement } from '@/lib/widgets/placement';
import { BUILTIN_LIST } from '@/lib/widgets/registry';
import type { Manifest } from '@/lib/widgets/ir';
import { t, type Locale } from '@/lib/i18n';

export interface EditorItem {
  /** Widget instance id (== `widgets.id` / `Placement.widgetId`). Identity. */
  widgetInstanceId: string;
  /** Manifest id (== palette key, e.g. "api-usage"). Type. */
  manifestId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface EditorInitial {
  dashboardId: string | null;
  name: string;
  device: DeviceId;
  layouts: Partial<Record<DeviceId, EditorItem[]>>;
  refreshOverrides: Partial<Record<DeviceId, number>>;
}

const GAP = 6;
const PREVIEW_W = 360;

function famWH(f: string): { w: number; h: number } {
  const [w, h] = f.split('x').map(Number);
  return { w, h };
}

export default function CanvasEditor({
  initial,
  userManifests,
  locale,
}: {
  initial: EditorInitial;
  userManifests: Manifest[];
  locale: Locale;
}) {
  const [dashboardId, setDashboardId] = useState<string | null>(initial.dashboardId);
  const [name, setName] = useState(initial.name);
  const [deviceId, setDeviceId] = useState<DeviceId>(initial.device);
  const [itemsByDevice, setItemsByDevice] = useState<Record<string, EditorItem[]>>(() => {
    const init: Record<string, EditorItem[]> = {};
    for (const k of Object.keys(initial.layouts)) init[k] = initial.layouts[k as DeviceId] ?? [];
    if (!init[initial.device]) init[initial.device] = [];
    return init;
  });
  const [refreshOverrides, setRefreshOverrides] = useState<Partial<Record<DeviceId, number>>>(initial.refreshOverrides);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const drag = useRef<
    | null
    | { id: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number }
  >(null);

  // Palette catalog = built-ins + the user's library (custom/installed). Built-ins
  // save by `manifestId` (track repo updates); custom save inline as `manifest`.
  const catalog = useMemo(() => {
    const map = new Map<string, { manifest: Manifest; builtin: boolean }>();
    for (const m of BUILTIN_LIST) map.set(m.id, { manifest: m, builtin: true });
    for (const m of userManifests) if (!map.has(m.id)) map.set(m.id, { manifest: m, builtin: false });
    return map;
  }, [userManifests]);
  const paletteList = useMemo(() => Array.from(catalog.values()), [catalog]);

  const device = getDevice(deviceId);
  const cols = device.cols;
  const rows = device.rows;
  const cell = Math.max(28, Math.floor((380 - (cols - 1) * GAP) / cols));
  const step = cell + GAP;
  const scale = PREVIEW_W / device.width;

  const items = itemsByDevice[deviceId] ?? [];
  function updateItems(updater: (prev: EditorItem[]) => EditorItem[]) {
    setItemsByDevice((prev) => ({ ...prev, [deviceId]: updater(prev[deviceId] ?? []) }));
  }

  const clampItem = (it: EditorItem, d = device): EditorItem => {
    const c = clampToGrid(
      { id: it.widgetInstanceId, widgetId: it.manifestId, x: it.x, y: it.y, w: it.w, h: it.h },
      d,
    );
    return { ...it, x: c.x, y: c.y, w: c.w, h: c.h };
  };

  const previewSrc = useMemo(
    () =>
      `/preview?d=${encodeURIComponent(
        JSON.stringify({
          device: deviceId,
          items: items.map(({ manifestId, x, y, w, h }) => ({ m: manifestId, x, y, w, h })),
        }),
      )}`,
    [deviceId, items],
  );

  function onMove(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dxc = Math.round((e.clientX - d.sx) / step);
    const dyc = Math.round((e.clientY - d.sy) / step);
    updateItems((prev) => {
      const others: Placement[] = prev
        .filter((p) => p.widgetInstanceId !== d.id)
        .map((p) => ({ id: p.widgetInstanceId, widgetId: p.manifestId, x: p.x, y: p.y, w: p.w, h: p.h }));
      return prev.map((p) => {
        if (p.widgetInstanceId !== d.id) return p;
        const moved = d.mode === 'move' ? { ...p, x: d.ox + dxc, y: d.oy + dyc } : { ...p, w: Math.max(1, d.ow + dxc), h: Math.max(1, d.oh + dyc) };
        const clamped = clampItem(moved);
        const candidate: Placement = { id: clamped.widgetInstanceId, widgetId: clamped.manifestId, x: clamped.x, y: clamped.y, w: clamped.w, h: clamped.h };
        if (hasCollision(others, candidate)) return p; // block the move; keep current position
        return clamped;
      });
    });
  }
  function onUp() {
    drag.current = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }
  function startDrag(e: React.PointerEvent, it: EditorItem, mode: 'move' | 'resize') {
    e.preventDefault();
    e.stopPropagation();
    setSelected(it.widgetInstanceId);
    drag.current = { id: it.widgetInstanceId, mode, sx: e.clientX, sy: e.clientY, ox: it.x, oy: it.y, ow: it.w, oh: it.h };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function addWidget(manifestId: string) {
    const entry = catalog.get(manifestId);
    if (!entry) return;
    const { w, h } = famWH(entry.manifest.families[0]);
    // Client-minted widget instance id — replaced with a real server id on
    // the next save+reload. Stable for the editor's lifetime.
    const widgetInstanceId = 'w' + Math.random().toString(36).slice(2, 7);
    updateItems((prev) => [...prev, clampItem({ widgetInstanceId, manifestId, x: 0, y: 0, w, h })]);
    setSelected(widgetInstanceId);
  }
  function removeWidget(id: string) {
    updateItems((prev) => prev.filter((p) => p.widgetInstanceId !== id));
    if (selected === id) setSelected(null);
  }
  function changeDevice(id: DeviceId) {
    const nd = getDevice(id);
    setItemsByDevice((prev) => {
      if (prev[id]) return prev; // already have this device's layout (saved or edited)
      const base = prev[deviceId] ?? items;
      const pls = base.map((it) => ({ id: it.widgetInstanceId, widgetId: it.manifestId, x: it.x, y: it.y, w: it.w, h: it.h }));
      const reflowed = autoReflow(pls, nd);
      const seeded: EditorItem[] = reflowed.map((p, i) => ({
        widgetInstanceId: pls[i].id,
        manifestId: pls[i].widgetId,
        x: p.x,
        y: p.y,
        w: p.w,
        h: p.h,
      }));
      return { ...prev, [id]: seeded };
    });
    setDeviceId(id);
  }

  async function save() {
    setSaving(true);
    setStatus('');
    try {
      let id = dashboardId;
      if (!id) {
        const r = await fetch('/api/dashboards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, base_device: deviceId }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'create failed');
        id = j.id as string;
        setDashboardId(id);
      }
      const r2 = await fetch(`/api/dashboards/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device: deviceId,
          items: items.map((it) => {
            const e = catalog.get(it.manifestId);
            const base = { x: it.x, y: it.y, w: it.w, h: it.h };
            // Built-ins travel as `manifestId` (server re-resolves the
            // palette key); custom widgets travel as inline `manifest` so
            // edits persist with the layout. `widgetId` is intentionally
            // omitted — every save re-instantiates, so the server mints a
            // fresh id (the editor's local `widgetInstanceId` is replaced
            // on next reload).
            return e && !e.builtin ? { manifest: e.manifest, ...base } : { manifestId: it.manifestId, ...base };
          }),
        }),
      });
      const j2 = await r2.json();
      if (!r2.ok) throw new Error(typeof j2.error === 'string' ? j2.error : JSON.stringify(j2.error || j2.issues));
      // Persist the per-device refresh overrides too (separate call — light payload).
      await fetch(`/api/dashboards/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_overrides: refreshOverrides }),
      });
      setStatus(t(locale, 'admin.canvas.status.saved', { count: j2.count, device: DEVICES[deviceId].label }));
    } catch (e: any) {
      setStatus(t(locale, 'admin.canvas.status.saveFailed', { message: e?.message || String(e) }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="panel" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="row" style={{ gap: 6 }}>
          <span className="label" style={{ margin: 0 }}>
            {t(locale, 'admin.canvas.label.dashboardName')}
          </span>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: 160 }} />
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span className="label" style={{ margin: 0 }}>
            {t(locale, 'admin.canvas.label.device')}
          </span>
          <select value={deviceId} onChange={(e) => changeDevice(e.target.value as DeviceId)}>
            {DEVICE_IDS.map((id) => (
              <option key={id} value={id}>
                {DEVICES[id].label} · {DEVICES[id].cols}×{DEVICES[id].rows}
              </option>
            ))}
          </select>
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span className="label" style={{ margin: 0 }}>
            {t(locale, 'admin.canvas.label.refreshOverride')}
          </span>
          <input
            type="number"
            min={15}
            max={86400}
            value={refreshOverrides[deviceId] ?? ''}
            placeholder={t(locale, 'admin.canvas.placeholder.refreshOverride')}
            onChange={(e) => {
              const v = e.target.value.trim();
              setRefreshOverrides((prev) => {
                const n = { ...prev };
                if (v === '') delete n[deviceId];
                else n[deviceId] = Math.max(15, Math.min(86400, Number(v) || 0));
                return n;
              });
            }}
            style={{ width: 120 }}
          />
        </label>
        <span style={{ borderLeft: '2px solid #000', height: 22 }} />
        <span className="label" style={{ margin: 0 }}>
          {t(locale, 'admin.canvas.label.add')}
        </span>
        {paletteList.map((e) => (
          <button
            key={e.manifest.id}
            className="btn"
            onClick={() => addWidget(e.manifest.id)}
            title={e.builtin ? t(locale, 'admin.canvas.title.builtin') : t(locale, 'admin.canvas.title.custom')}
          >
            + {e.manifest.name}
            {e.builtin ? '' : ' ◇'}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? t(locale, 'admin.canvas.saving') : t(locale, 'admin.canvas.save')}
        </button>
        {dashboardId && (
          <a className="btn" href={`/preview?dashboard=${dashboardId}`} target="_blank" rel="noreferrer">
            {t(locale, 'admin.canvas.viewRealData')}
          </a>
        )}
      </div>
      {status && (
        <div className="ok" style={{ marginTop: 0 }}>
          {status}
        </div>
      )}

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* LEFT — arrangement grid */}
        <div>
          <div className="hint" style={{ marginBottom: 6 }}>
            {t(locale, 'admin.canvas.hint.layout', { cols, rows })}
          </div>
          <div
            style={{
              position: 'relative',
              width: cols * cell + (cols - 1) * GAP,
              height: rows * cell + (rows - 1) * GAP,
              backgroundImage: `linear-gradient(#0001 1px, transparent 1px), linear-gradient(90deg, #0001 1px, transparent 1px)`,
              backgroundSize: `${step}px ${step}px`,
              border: '2px solid #000',
            }}
            onPointerDown={() => setSelected(null)}
          >
            {items.map((it) => {
              const entry = catalog.get(it.manifestId);
              if (!entry) return null;
              const m = entry.manifest;
              const fam = resolveFamily(m.families, it.w, it.h);
              const isSel = selected === it.widgetInstanceId;
              return (
                <div
                  key={it.widgetInstanceId}
                  onPointerDown={(e) => startDrag(e, it, 'move')}
                  style={{
                    position: 'absolute',
                    left: it.x * step,
                    top: it.y * step,
                    width: it.w * cell + (it.w - 1) * GAP,
                    height: it.h * cell + (it.h - 1) * GAP,
                    border: `2px solid #000`,
                    background: isSel ? '#000' : '#fff',
                    color: isSel ? '#fff' : '#000',
                    boxSizing: 'border-box',
                    padding: 6,
                    cursor: 'move',
                    userSelect: 'none',
                    touchAction: 'none',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    {m.name}
                    {entry.builtin ? '' : ' ◇'}
                  </div>
                  <div style={{ fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                    {it.w}×{it.h} → {fam}
                  </div>
                  <button
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      removeWidget(it.widgetInstanceId);
                    }}
                    title={t(locale, 'admin.canvas.title.remove')}
                    style={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      width: 18,
                      height: 18,
                      lineHeight: '14px',
                      border: '1px solid currentColor',
                      background: 'transparent',
                      color: 'inherit',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                  <div
                    onPointerDown={(e) => startDrag(e, it, 'resize')}
                    title={t(locale, 'admin.canvas.title.resize')}
                    style={{
                      position: 'absolute',
                      right: 0,
                      bottom: 0,
                      width: 14,
                      height: 14,
                      cursor: 'nwse-resize',
                      borderLeft: '2px solid currentColor',
                      borderTop: '2px solid currentColor',
                      touchAction: 'none',
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT — 1:1 device preview */}
        <div>
          <div className="hint" style={{ marginBottom: 6 }}>
            {t(locale, 'admin.canvas.hint.preview', {
              w: device.width,
              h: device.height,
              pct: Math.round(scale * 100),
            })}
          </div>
          <div style={{ width: PREVIEW_W, height: device.height * scale, overflow: 'hidden', border: '4px solid #000', background: '#fff' }}>
            <iframe
              title={t(locale, 'admin.canvas.previewFrame.title')}
              src={previewSrc}
              width={device.width}
              height={device.height}
              style={{ transform: `scale(${scale})`, transformOrigin: 'top left', border: 0, background: '#fff' }}
            />
          </div>
          <div style={{ marginTop: 8 }}>
            <a className="btn" href={previewSrc} target="_blank" rel="noreferrer">
              {t(locale, 'admin.canvas.preview.openFull')}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
