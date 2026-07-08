/**
 * WidgetRenderer: (manifest, data, w, h) -> e-ink card.
 *
 * This is the single rendering path. Both the e-ink /display page and the web
 * 1:1 preview call it, which is what guarantees the preview is a perfect replica
 * of the glass — there is no second renderer to drift from.
 *
 * It picks the layout variant for the placed size (resolveFamily) and draws the
 * node tree inside the standard `eink-section` card frame.
 */
import type { Manifest } from '../ir';
import { resolveFamily } from '../placement';
import { RenderNode } from './primitives';

export function WidgetRenderer({
  manifest,
  data,
  w,
  h,
  frame = true,
}: {
  manifest: Manifest;
  data: unknown;
  w: number;
  h: number;
  frame?: boolean;
}) {
  const family = resolveFamily(manifest.families, w, h);
  const node = manifest.layout[family];
  const body = node ? <RenderNode node={node} data={data} /> : <div className="eink-subtitle">no {family} layout</div>;

  if (!frame) return body;

  return (
    <div
      className="eink-section"
      data-w={manifest.id}
      data-family={family}
      style={{ height: '100%', margin: 0, boxSizing: 'border-box', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
    >
      <div className="eink-section-h">
        <span>{manifest.name}</span>
        <span className="eink-badge">{family}</span>
      </div>
      <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>{body}</div>
    </div>
  );
}
