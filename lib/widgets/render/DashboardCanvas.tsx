/**
 * Renders a full dashboard at a device's native pixel size: each widget
 * absolutely positioned per its placement, drawn by WidgetRenderer. This is the
 * shared surface — `/display` (e-ink) and `/preview` (web 1:1) both render it,
 * which is what guarantees the preview matches the glass.
 */
import type { Manifest } from '../ir';
import { getDevice, type DeviceId } from '../devices';
import { rectPx, type Placement } from '../placement';
import { WidgetRenderer } from './WidgetRenderer';

export interface CanvasItem {
  placement: Placement;
  manifest: Manifest;
  data: unknown;
}

export function DashboardCanvas({ deviceId, items }: { deviceId: DeviceId; items: CanvasItem[] }) {
  const device = getDevice(deviceId);
  return (
    <div
      className="eink"
      style={{ position: 'relative', width: device.width, height: device.height, background: '#fff', overflow: 'hidden' }}
      data-preview-canvas
      data-display-root
    >
      {items.map((it, i) => {
        const r = rectPx(it.placement, device);
        return (
          <div
            key={it.placement.id || i}
            data-w-inst={it.placement.id || `i${i}`}
            style={{ position: 'absolute', left: r.left, top: r.top, width: r.width, height: r.height }}
          >
            <WidgetRenderer manifest={it.manifest} data={it.data} w={it.placement.w} h={it.placement.h} />
          </div>
        );
      })}
    </div>
  );
}
