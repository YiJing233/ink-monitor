/**
 * Device profiles — the grid geometry per e-ink target. A "cell" is the base
 * unit; widget families (1x1 … 4x4) are spans of cells. The same dashboard can
 * be laid out per-device (see placement.ts#autoReflow) so a 2x2 on a big Boox
 * can become a 2x1 on a small Kindle.
 *
 * Pixel dimensions are the device's native browser viewport. The preview route
 * renders at these exact pixels so the web preview is a 1:1 replica of the glass.
 *
 * Client-safe.
 */
export interface DeviceProfile {
  id: string;
  label: string;
  width: number;
  height: number;
  cols: number;
  rows: number;
  gap: number; // px between cells
  pad: number; // px outer padding
}

export const DEVICES = {
  'kindle-pw': { id: 'kindle-pw', label: 'Kindle Paperwhite (竖)', width: 1072, height: 1448, cols: 4, rows: 6, gap: 14, pad: 14 },
  'kindle-oasis': { id: 'kindle-oasis', label: 'Kindle Oasis (竖)', width: 1264, height: 1680, cols: 4, rows: 6, gap: 16, pad: 16 },
  'xiaomi-mireader': { id: 'xiaomi-mireader', label: '小米多看 Pro (竖)', width: 1648, height: 2200, cols: 4, rows: 7, gap: 18, pad: 18 },
  'boox-note': { id: 'boox-note', label: 'Boox Note (竖)', width: 1404, height: 1872, cols: 6, rows: 8, gap: 16, pad: 16 },
  'generic-land': { id: 'generic-land', label: '通用横屏', width: 1448, height: 1072, cols: 6, rows: 4, gap: 14, pad: 14 },
} as const satisfies Record<string, DeviceProfile>;

export type DeviceId = keyof typeof DEVICES;
export const DEVICE_IDS = Object.keys(DEVICES) as DeviceId[];

/** Width/height of a single 1x1 cell in px for a given device. */
export function cellSize(d: DeviceProfile): { cw: number; ch: number } {
  const cw = (d.width - 2 * d.pad - (d.cols - 1) * d.gap) / d.cols;
  const ch = (d.height - 2 * d.pad - (d.rows - 1) * d.gap) / d.rows;
  return { cw, ch };
}

export function getDevice(id: string): DeviceProfile {
  return (DEVICES as Record<string, DeviceProfile>)[id] ?? DEVICES['kindle-pw'];
}
