/**
 * Placement + dashboard model. A dashboard holds a set of widget instances and
 * a *per-device* layout (point 4: cross-device adaptation lives in the data
 * model, not at render time). `layouts[baseDevice]` is authored by hand; other
 * devices can be auto-reflowed and then hand-overridden.
 *
 * Client-safe.
 */
import { cellSize, getDevice, type DeviceId, type DeviceProfile } from './devices';
import { FAMILIES, type Family } from './ir';

export interface Placement {
  id: string; // placement id (stable within a dashboard)
  widgetId: string; // -> Dashboard.widgets[].id
  x: number; // grid column origin (0-based)
  y: number; // grid row origin (0-based)
  w: number; // span in columns
  h: number; // span in rows
}

export interface WidgetRef {
  id: string;
  manifestId: string;
  config?: Record<string, unknown>;
}

export interface Dashboard {
  id: string;
  name: string;
  baseDevice: DeviceId;
  widgets: WidgetRef[];
  layouts: Partial<Record<DeviceId, Placement[]>>;
}

function familyArea(f: Family): number {
  const [w, h] = f.split('x').map(Number);
  return w * h;
}

/**
 * Pick the layout variant for a placement of size (w,h) given the families a
 * manifest supports. Exact match wins; else the largest variant that still
 * fits inside (w,h); else the smallest supported variant (centered + letterboxed
 * by the renderer — never upscaled into an empty box).
 */
export function resolveFamily(supported: Family[], w: number, h: number): Family {
  const want = `${w}x${h}` as Family;
  if ((FAMILIES as readonly string[]).includes(want) && supported.includes(want)) return want;

  const fits = supported
    .map((f) => {
      const [fw, fh] = f.split('x').map(Number);
      return { f, fw, fh };
    })
    .filter((c) => c.fw <= w && c.fh <= h)
    .sort((a, b) => familyArea(b.f) - familyArea(a.f));
  if (fits.length) return fits[0].f;

  return [...supported].sort((a, b) => familyArea(a) - familyArea(b))[0] ?? supported[0];
}

/** Absolute px rect for a placement on a device — used by the e-ink renderer. */
export function rectPx(p: Placement, d: DeviceProfile): { left: number; top: number; width: number; height: number } {
  const { cw, ch } = cellSize(d);
  return {
    left: d.pad + p.x * (cw + d.gap),
    top: d.pad + p.y * (ch + d.gap),
    width: p.w * cw + (p.w - 1) * d.gap,
    height: p.h * ch + (p.h - 1) * d.gap,
  };
}

/**
 * Naive auto-reflow when copying the base layout to a device with a different
 * grid: clamp spans to the target grid and row-pack left→right, top→down.
 * Good enough as a starting point; users can hand-override per device.
 */
export function autoReflow(base: Placement[], to: DeviceProfile): Placement[] {
  let x = 0;
  let y = 0;
  let rowH = 0;
  return base.map((p) => {
    const w = Math.min(p.w, to.cols);
    const h = Math.min(p.h, to.rows);
    if (x + w > to.cols) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    const np: Placement = { ...p, x, y, w, h };
    x += w;
    rowH = Math.max(rowH, h);
    return np;
  });
}

/** Resolve the placements to use for a given device, reflowing from base if absent. */
export function layoutFor(dash: Dashboard, deviceId: DeviceId): Placement[] {
  const own = dash.layouts[deviceId];
  if (own && own.length) return own;
  const base = dash.layouts[dash.baseDevice] ?? [];
  return autoReflow(base, getDevice(deviceId));
}

/** Clamp a placement inside the device grid (used by the editor on drag/resize). */
export function clampToGrid(p: Placement, d: DeviceProfile): Placement {
  const w = Math.max(1, Math.min(p.w, d.cols));
  const h = Math.max(1, Math.min(p.h, d.rows));
  return {
    ...p,
    w,
    h,
    x: Math.max(0, Math.min(p.x, d.cols - w)),
    y: Math.max(0, Math.min(p.y, d.rows - h)),
  };
}

/** True iff two placements share at least one cell. */
export function overlaps(a: Placement, b: Placement): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** True iff `candidate` collides with any existing placement (optionally ignoring one by id). */
export function hasCollision(items: Placement[], candidate: Placement, ignoreId?: string): boolean {
  for (const p of items) {
    if (ignoreId && p.id === ignoreId) continue;
    if (overlaps(p, candidate)) return true;
  }
  return false;
}
