/**
 * Trusted render primitives: IR Node -> e-ink HTML. Reuses the `eink-*` classes
 * from globals.css so generated widgets are pixel-identical to the hand-written
 * provider/stock cards. No 'use client' — this renders to static HTML, which is
 * exactly what the e-ink display and the 1:1 preview both consume.
 *
 * The set is intentionally closed: a manifest can only compose these nodes, so
 * the output is guaranteed B&W, animation-free, and old-WebKit safe.
 */
import { formatNumber, timeUntil } from '../../utils';
import { resolveArray, resolveBind, resolveNumber, resolveString } from '../bind';
import type { Node } from '../ir';
import { qrMatrix } from '../qr';

export function RenderNode({ node, data }: { node: Node; data: unknown }) {
  switch (node.t) {
    case 'text': {
      const v = resolveString(data, node.value);
      const style =
        node.size === 'title'
          ? { fontSize: 22, fontWeight: 800 }
          : node.size === 'caption'
          ? { fontSize: 12 }
          : { fontSize: 16 };
      return (
        <div className={node.mono ? 'eink-mono' : undefined} style={style}>
          {v}
        </div>
      );
    }

    case 'bignum': {
      const v = resolveBind(data, node.value);
      const num = typeof v === 'number' ? formatNumber(v, Number.isInteger(v) ? 0 : 1) : String(v ?? '—');
      const sub = node.sub != null ? resolveString(data, node.sub) : '';
      // `unit` accepts a Bind so dynamic suffixes work (e.g. clock minute).
      const unit = node.unit != null ? resolveBind(data, node.unit) : null;
      const unitText = unit == null ? '' : typeof unit === 'number' ? formatNumber(unit, 0) : String(unit);
      return (
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
          <div className="eink-mono" style={{ fontSize: 44, fontWeight: 800, lineHeight: 1 }}>
            {num}
            {unitText ? <span style={{ fontSize: 20 }}> {unitText}</span> : null}
          </div>
          {sub ? (
            <div className="eink-subtitle" style={{ marginTop: 4 }}>
              {sub}
            </div>
          ) : null}
        </div>
      );
    }

    case 'metric': {
      const used = resolveNumber(data, node.value) ?? 0;
      const max = node.max != null ? resolveNumber(data, node.max) : null;
      const pct = max ? Math.min(100, Math.round((used / max) * 100)) : 0;
      const resetAt = node.reset != null ? resolveNumber(data, node.reset) : null;
      return (
        <div style={{ marginBottom: 6 }}>
          <div className="eink-row" style={{ borderBottom: 0, padding: 0 }}>
            <span>
              {node.label || ''}
              {node.window ? <span className="eink-subtitle"> [{node.window}]</span> : null}
            </span>
            <span className="eink-mono">
              {formatNumber(used, 0)}
              {max != null ? ` / ${formatNumber(max, 0)}` : ''}
              {node.unit ? ` ${node.unit}` : ''}
            </span>
          </div>
          <div className="eink-bar-wrap">
            {max != null ? <div className="eink-bar-fill" style={{ width: `${pct}%` }} /> : null}
            <div className="eink-bar-label">{max != null ? `${pct}%` : formatNumber(used, 0)}</div>
          </div>
          {resetAt ? (
            <div className="eink-subtitle" style={{ fontSize: 12 }}>
              resets in {timeUntil(resetAt)}
            </div>
          ) : null}
        </div>
      );
    }

    case 'series': {
      const arr = resolveArray(data, node.data)
        .map(Number)
        .filter((n) => Number.isFinite(n));
      if (!arr.length) return <div className="eink-subtitle">no data</div>;
      return node.kind === 'spark' ? <SparkChart data={arr} /> : <BarChart data={arr} window={node.window} unit={node.unit} />;
    }

    case 'table': {
      const rows = resolveArray(data, node.rows) as Record<string, unknown>[];
      return (
        <table className="eink-stock-table">
          <thead>
            <tr>
              {node.columns.map((c) => (
                <th key={c.key} className={c.align === 'right' ? 'num' : undefined}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {node.columns.map((c) => (
                  <td key={c.key} className={[c.align === 'right' ? 'num' : '', c.mono ? 'eink-mono' : ''].join(' ').trim() || undefined}>
                    {String(r?.[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    case 'list': {
      const items = resolveArray(data, node.items) as Record<string, unknown>[];
      const shown = node.max ? items.slice(0, node.max) : items;
      return (
        <div>
          {shown.map((it, i) => {
            const checked = node.check ? Boolean(it?.[node.check]) : undefined;
            return (
              <div key={i} className="eink-row" style={{ padding: '4px 0' }}>
                <span style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  {node.check != null ? (
                    <span className="eink-mono" aria-hidden>
                      {checked ? '[x]' : '[ ]'}
                    </span>
                  ) : null}
                  <span style={checked ? { textDecoration: 'line-through' } : undefined}>{String(it?.[node.primary] ?? '')}</span>
                </span>
                {node.secondary ? <span className="eink-subtitle">{String(it?.[node.secondary] ?? '')}</span> : null}
              </div>
            );
          })}
        </div>
      );
    }

    case 'image': {
      // NOTE: in production `src` is a server-dithered asset URL (Atkinson/FS to
      // 1-bit, pre-rendered at the family's pixel size). The skeleton renders the
      // bound value directly so the album shows without the asset pipeline.
      const src = resolveString(data, node.src);
      return (
        <img
          src={src}
          alt={node.alt || ''}
          data-dither={node.dither || 'none'}
          style={{ width: '100%', height: '100%', objectFit: node.fit || 'cover', display: 'block', imageRendering: 'pixelated' }}
        />
      );
    }

    case 'qr': {
      const v = resolveString(data, node.value);
      const cap = node.caption != null ? resolveString(data, node.caption) : '';
      let matrix: boolean[][] | null = null;
      if (v) {
        try {
          matrix = qrMatrix(v);
        } catch {
          matrix = null;
        }
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          {matrix ? (
            <QrSvg matrix={matrix} />
          ) : (
            <div style={{ width: 96, height: 96, border: '2px solid #000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="eink-mono" style={{ fontSize: 9 }}>no QR</span>
            </div>
          )}
          {cap ? (
            <div className="eink-subtitle" style={{ fontSize: 11 }}>
              {cap}
            </div>
          ) : null}
        </div>
      );
    }

    case 'divider':
      return <div style={{ borderTop: '2px solid #000', margin: '6px 0' }} />;

    case 'row':
      return (
        <div style={{ display: 'flex', flexDirection: 'row', gap: node.gap ?? 10 }}>
          {node.children.map((c, i) => (
            <div key={i} style={{ flex: '1 1 0', minWidth: 0 }}>
              <RenderNode node={c} data={data} />
            </div>
          ))}
        </div>
      );

    case 'col':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: node.gap ?? 8 }}>
          {node.children.map((c, i) => (
            <RenderNode key={i} node={c} data={data} />
          ))}
        </div>
      );

    case 'grid': {
      // globals.css avoids CSS Grid for old Kindle — flex-wrap instead.
      const cols = node.cols ?? 2;
      const basis = Math.max(10, Math.floor(100 / cols) - 2);
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: node.gap ?? 8 }}>
          {node.children.map((c, i) => (
            <div key={i} style={{ flex: `1 1 ${basis}%`, minWidth: 0 }}>
              <RenderNode node={c} data={data} />
            </div>
          ))}
        </div>
      );
    }

    default:
      return null;
  }
}

/** 24-bucket hourly bar chart, ported from the provider history chart. */
function BarChart({ data, window: win, unit }: { data: number[]; window?: string; unit?: string }) {
  const W = 240;
  const H = 40;
  const labelH = 12;
  const innerH = H - labelH;
  const n = data.length;
  const barW = W / n;
  const max = Math.max(...data, 1);
  const labelEvery = Math.max(1, Math.floor(n / 4));
  return (
    <div style={{ marginTop: 6 }}>
      <div className="eink-subtitle" style={{ fontSize: 10, marginBottom: 2 }}>
        {win || ''} {unit ? `· ${unit}` : ''}
      </div>
      <svg width="100%" height={H + 2} viewBox={`0 0 ${W} ${H + 2}`} preserveAspectRatio="none" role="img" aria-label="history">
        <line x1="0" y1={innerH + 0.5} x2={W} y2={innerH + 0.5} stroke="#000" strokeWidth="0.5" />
        {data.map((v, i) => {
          const h = (v / max) * (innerH - 1);
          const x = i * barW;
          const y = innerH - h;
          const showLabel = i % labelEvery === 0;
          return (
            <g key={i}>
              <rect x={x + 0.5} y={y} width={Math.max(1, barW - 1.5)} height={h} fill="#000" />
              {showLabel ? (
                <text x={x + barW / 2} y={H} fontSize="8" fontFamily="ui-monospace, Menlo, monospace" textAnchor="middle" fill="#000">
                  {n - 1 - i}h
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Line + hatched-area sparkline, ported from the stock sparkline. */
function SparkChart({ data }: { data: number[] }) {
  const W = 120;
  const H = 28;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = W / (data.length - 1 || 1);
  const points = data.map((v, i) => [i * stepX, H - ((v - min) / range) * H] as const);
  const linePath = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const areaPath = `M0,${H} ` + points.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ') + ` L${W},${H} Z`;
  const last = points[points.length - 1];
  // Deterministic id (no Math.random -> no hydration mismatch). Identical data
  // sharing an id is harmless (same def); cheap hash keeps distinct data apart.
  const uid = 'sp' + (data.length * 131 + Math.round((data[0] || 0) + (data[data.length - 1] || 0))).toString(36);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="trend" style={{ display: 'block' }}>
      <defs>
        <pattern id={`${uid}-h`} patternUnits="userSpaceOnUse" width="3" height="3" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="3" stroke="#000" strokeWidth="1.4" />
        </pattern>
        <clipPath id={`${uid}-c`}>
          <path d={areaPath} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${uid}-c)`}>
        <rect x="0" y="0" width={W} height={H} fill={`url(#${uid}-h)`} />
      </g>
      <path d={linePath} fill="none" stroke="#000" strokeWidth="1.4" />
      <circle cx={last[0]} cy={last[1]} r="1.8" fill="#000" />
    </svg>
  );
}

/** Render a QR matrix as crisp B&W modules. Horizontal dark runs are merged into
 *  single rects to keep the node count low (good for e-ink + DOM size). */
function QrSvg({ matrix }: { matrix: boolean[][] }) {
  const n = matrix.length;
  const px = 4; // integer px/module → crisp, scannable on e-ink
  const S = n * px;
  const rects: { x: number; y: number; w: number }[] = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (matrix[r][c]) {
        let len = 1;
        while (c + len < n && matrix[r][c + len]) len++;
        rects.push({ x: c, y: r, w: len });
        c += len;
      } else {
        c++;
      }
    }
  }
  return (
    <svg width={S} height={S} viewBox={`0 0 ${n} ${n}`} shapeRendering="crispEdges" role="img" aria-label="QR code" style={{ maxWidth: '100%' }}>
      <rect x={0} y={0} width={n} height={n} fill="#fff" />
      {rects.map((rt, i) => (
        <rect key={i} x={rt.x} y={rt.y} width={rt.w} height={1} fill="#000" />
      ))}
    </svg>
  );
}
