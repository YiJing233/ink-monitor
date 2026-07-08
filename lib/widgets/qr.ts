/**
 * QR matrix generation, backed by the well-tested `qrcode` library so the output
 * is guaranteed to scan (which a hand-rolled encoder couldn't be without a real
 * scanner). Returns a boolean grid the renderer draws as B&W modules — perfect
 * for e-ink (no grayscale, integer pixels).
 *
 * Used by the `qr` render primitive for "scan to add a TODO / open this URL on
 * your phone" — the e-ink-native way to make a read-only display actionable.
 */
import * as QRCode from 'qrcode';

export function qrMatrix(text: string, ecl: 'L' | 'M' | 'Q' | 'H' = 'M'): boolean[][] {
  const qr = QRCode.create(text || ' ', { errorCorrectionLevel: ecl });
  const size = qr.modules.size;
  const data = qr.modules.data;
  const out: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) row.push(data[r * size + c] === 1);
    out.push(row);
  }
  return out;
}
