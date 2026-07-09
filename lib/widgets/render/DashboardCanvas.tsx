/**
 * Renders a full dashboard at a device's native pixel size: each widget
 * absolutely positioned per its placement, drawn by WidgetRenderer. This is the
 * shared surface — `/display` (e-ink) and `/preview` (web 1:1) both render it,
 * which is what guarantees the preview matches the glass.
 */
import type { Manifest } from '../ir';
import { getDevice, type DeviceId } from '../devices';
import { rectPx, type Placement } from '../placement';
import { NotesWidget } from './widgets/NotesWidget';
import { WidgetRenderer } from './WidgetRenderer';

export interface CanvasItem {
  placement: Placement;
  manifest: Manifest;
  data: unknown;
  /** Widget row id (= `widgets.id`, the id used by `/api/widgets/[id]`).
   *  Required so widgets that stamp a scan-to-edit QR (currently `notes`)
   *  can deep-link to their per-instance admin editor. */
  widgetInstanceId: string;
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
        const instId = it.placement.id || `i${i}`;
        // The notes widget gets its own renderer so it can append a scan-to-
        // edit QR in the bottom-right corner. Other widgets fall through to
        // the standard renderer; this keeps the special case opt-in (a single
        // `if manifest.id === 'notes'`) and avoids polluting the generic
        // render path with widget-id plumbing.
        const isNotes = it.manifest.id === 'notes';
        return (
          <div
            key={instId}
            data-w-inst={instId}
            data-w-id={it.widgetInstanceId}
            style={{ position: 'absolute', left: r.left, top: r.top, width: r.width, height: r.height }}
          >
            {isNotes ? (
              <NotesWidget manifest={it.manifest} data={it.data} w={it.placement.w} h={it.placement.h} widgetInstanceId={it.widgetInstanceId} />
            ) : (
              <WidgetRenderer manifest={it.manifest} data={it.data} w={it.placement.w} h={it.placement.h} />
            )}
          </div>
        );
      })}
    </div>
  );
}
