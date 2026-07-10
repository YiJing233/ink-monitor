/**
 * Special-case renderer for the `notes` widget.
 *
 * Composes the standard `WidgetRenderer` (which renders the manifest's
 * `list` node) with a small scan-to-edit QR anchored to the bottom-right
 * corner. The QR encodes the absolute URL of the widget's admin editor;
 * scanning it on a phone takes the user straight to the textarea, no URL
 * juggling required.
 *
 * Why a separate component rather than folding the QR into the manifest
 * itself: the QR target depends on the *widget instance id*, which only
 * the canvas knows. The manifest is shared across instances and is
 * render-time pure data, so the instance id has to be injected from the
 * renderer side. Keeping the special-case in a dedicated component keeps
 * the generic `WidgetRenderer` clean.
 *
 * Visual contract:
 *   - The list node takes the full eink-section body (unchanged).
 *   - The QR sits absolutely positioned in the bottom-right corner, 24x24
 *     px — small enough not to dominate the smallest (1x2) family, big
 *     enough to be scannable on a phone. The QR is wrapped in a clickable
 *     <a> so the preview page (which renders on a normal browser) makes
 *     the affordance obvious; on e-ink browsers the QR is what the user
 *     scans with their phone, so the <a> is harmless dead weight there.
 *   - If the widget has no widgetInstanceId (defensive — preview mode
 *     always provides one), the QR is omitted entirely rather than
 *     pointing at `/admin/widgets//edit-config`.
 */
import type { Manifest } from '../../ir';
import { qrMatrix } from '../../qr';
import { WidgetRenderer } from '../WidgetRenderer';

interface NotesWidgetProps {
  manifest: Manifest;
  data: unknown;
  w: number;
  h: number;
  widgetInstanceId: string;
}

export function NotesWidget({ manifest, data, w, h, widgetInstanceId }: NotesWidgetProps) {
  // Render the manifest's body the same way the generic renderer does, then
  // overlay the QR. Wrapping in a relative-positioned div keeps the overlay
  // anchored to this widget's bounding box rather than the whole canvas.
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <WidgetRenderer manifest={manifest} data={data} w={w} h={h} />
      {widgetInstanceId ? <NotesEditQr widgetInstanceId={widgetInstanceId} /> : null}
    </div>
  );
}

function NotesEditQr({ widgetInstanceId }: { widgetInstanceId: string }) {
  // The URL the QR encodes. Absolute-path form (no host) so a phone on the
  // same network reaches the dev server; in prod the user scans from a
  // public URL and the page hydrates the absolute host from the request.
  // We deliberately don't add `?from=qr` query strings — the editor is
  // already unambiguous (it's the only route at this URL), and adding
  // bookkeeping flags just bloats the QR matrix.
  //
  // The QR points at the *generic* per-widget config editor; the `notes`
  // manifest declares its `lines` field via `config_schema` so the editor
  // renders the same line-by-line form the old `/edit-notes` page had.
  // The legacy path remains as a redirect for any QR codes minted before
  // the migration — see `app/admin/widgets/[id]/edit-notes/page.tsx`.
  const url = `/admin/widgets/${encodeURIComponent(widgetInstanceId)}/edit-config`;
  let matrix: boolean[][] | null = null;
  try {
    matrix = qrMatrix(url);
  } catch {
    matrix = null;
  }
  // 24x24 px module size: empirically scannable on a phone at arm's length
  // for a 25-module QR. We don't add a quiet zone — the eink-section's white
  // background already provides the 4-module margin the spec recommends.
  return (
    <a
      href={url}
      title="扫码编辑"
      data-notes-edit
      style={{
        position: 'absolute',
        right: 2,
        bottom: 2,
        width: 24,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 0,
        background: '#fff',
        // `text-decoration: none` keeps the default browser underline off —
        // e-ink link rendering doesn't have a "visited" state worth honoring.
        textDecoration: 'none',
        opacity: 0.85,
      }}
    >
      {matrix ? <MiniQrSvg matrix={matrix} /> : null}
    </a>
  );
}

/** Tiny B&W QR renderer for the 24px overlay. The generic `QrSvg` in
 *  primitives.tsx uses 4px modules with horizontal run-merging — that's
 *  tuned for the larger scan-to-add tiles. Here we want a flat list of
 *  rects (no merging) so each module stays at 1 logical px and the QR
 *  remains scannable at 24px on the smallest e-ink family. */
function MiniQrSvg({ matrix }: { matrix: boolean[][] }) {
  const n = matrix.length;
  return (
    <svg
      width="24"
      height="24"
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Scan to edit notes"
      style={{ display: 'block' }}
    >
      <rect x={0} y={0} width={n} height={n} fill="#fff" />
      {matrix.flatMap((row, r) =>
        row.map((on, c) =>
          on ? <rect key={`${r}-${c}`} x={c} y={r} width={1} height={1} fill="#000" /> : null,
        ),
      )}
    </svg>
  );
}