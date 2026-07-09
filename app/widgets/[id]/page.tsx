/**
 * Public widget detail page — `/widgets/:id`.
 *
 * Shows the manifest's metadata, every supported family as a small preview
 * (rendered through the trusted `WidgetRenderer` with sample data), and
 * the raw manifest JSON behind a collapsible `<details>`. The Install
 * button deep-links into `/admin/market` (or `/signin` when not signed in),
 * matching the behaviour the install flow already expects.
 *
 * Resolution order:
 *   1. `BUILTIN_MANIFESTS[id]` — always available.
 *   2. If `MARKET_REGISTRY_URL` is set, probe `/api/market` for an entry
 *      with a matching `id`. The marketplace shadow wins if it's a newer
 *      version of the built-in (rare — curated registry just decorates the
 *      same IR). Invalid entries are dropped.
 *   3. Otherwise `notFound()`.
 *
 * Public (not in the middleware matcher): the gallery is content, not
 * per-user data.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BUILTIN_MANIFESTS, SAMPLE_DATA } from '@/lib/widgets/registry';
import { safeValidateManifest, type Manifest } from '@/lib/widgets/ir';
import { WidgetRenderer } from '@/lib/widgets/render/WidgetRenderer';
import { describeCapabilities } from '@/lib/widgets/capabilities';
import { EGRESS_UNRESTRICTED } from '@/lib/widgets/registry-meta';
import { getCurrentUserId } from '@/lib/session';
import { getDevice } from '@/lib/widgets/devices';

export const dynamic = 'force-dynamic';

interface ResolvedManifest {
  manifest: Manifest;
  category?: string;
  author?: string;
}

async function resolveManifest(id: string): Promise<ResolvedManifest | null> {
  const built = BUILTIN_MANIFESTS[id];
  if (built) return { manifest: built };

  if (process.env.MARKET_REGISTRY_URL) {
    try {
      const r = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/market`, { cache: 'no-store' });
      if (r.ok) {
        const j = (await r.json()) as {
          items: { manifest: unknown; category?: string; author?: string }[];
        };
        for (const e of j.items) {
          const v = safeValidateManifest(e.manifest);
          if (v.success && v.data.id === id) {
            return { manifest: v.data, category: e.category, author: e.author };
          }
        }
      }
    } catch {
      /* ignore — fall through to notFound() */
    }
  }
  return null;
}

export default async function WidgetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const resolved = await resolveManifest(id);
  if (!resolved) notFound();

  const { manifest, category, author } = resolved;
  const userId = await getCurrentUserId();
  const installHref = userId ? '/admin/market' : '/signin?callbackUrl=/admin/market';
  const notices = describeCapabilities(manifest);

  return (
    <div className="admin" data-testid="widget-detail" data-widget-id={manifest.id}>
      <p className="hint">
        <Link href="/widgets">← Widget gallery</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>{manifest.name}</h1>
      {manifest.description && <p style={{ marginTop: 0 }}>{manifest.description}</p>}

      <div className="row" style={{ gap: 6, fontSize: 12 }}>
        <span className="pill">{manifest.id}</span>
        {manifest.version && <span className="pill">v{manifest.version}</span>}
        <span className="pill">{manifest.source.kind}</span>
        {category && <span className="pill">{category}</span>}
        {author && <span>· @{author}</span>}
      </div>

      <h2>Capabilities</h2>
      {notices.length === 0 ? (
        <div className="hint">无外部访问，无需密钥。</div>
      ) : (
        <ul>
          {notices.map((n, i) => (
            <li
              key={i}
              style={n.kind === EGRESS_UNRESTRICTED ? { color: '#b58900', fontWeight: 600 } : undefined}
            >
              <strong>{n.kind}</strong> — {n.text}
            </li>
          ))}
        </ul>
      )}

      <h2>Layouts</h2>
      <p className="hint">
        每个 family 一个 1:1 缩略预览，数据来自 <code>SAMPLE_DATA</code>。完整 1:1 渲染见{' '}
        <Link href={`/preview?demo=${encodeURIComponent(manifest.id)}`} target="_blank" rel="noreferrer">
          /preview
        </Link>
        。
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {manifest.families.map((family) => {
          const [w, h] = family.split('x').map(Number);
          const dev = getDevice('kindle-pw');
          const data = SAMPLE_DATA[manifest.id] ?? {};
          // Scale the e-ink native px down to a thumbnail so multiple families
          // fit on screen. The actual e-ink size is preserved by `/preview`.
          const scale = 240 / Math.max(dev.width, dev.height);
          return (
            <div key={family} className="panel" style={{ margin: 0 }} data-family={family}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                <strong>{family}</strong>
                <Link
                  className="btn"
                  href={`/preview?demo=${encodeURIComponent(manifest.id)}&family=${family}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  1:1 preview ↗
                </Link>
              </div>
              <div style={{ overflow: 'auto', maxWidth: '100%', background: '#fff' }}>
                <div
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: 'top left',
                    width: dev.width,
                    height: dev.height,
                  }}
                >
                  <WidgetRenderer manifest={manifest} data={data} w={w} h={h} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <h2 style={{ marginTop: 24 }}>Manifest JSON</h2>
      <details>
        <summary>展开完整 manifest</summary>
        <pre
          style={{
            fontSize: 11,
            padding: 12,
            border: '2px solid #000',
            overflow: 'auto',
            background: '#fff',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          }}
        >
{JSON.stringify(manifest, null, 2)}
        </pre>
      </details>

      <div style={{ marginTop: 24 }}>
        <Link className="btn primary" href={installHref}>
          Install →
        </Link>
      </div>
    </div>
  );
}