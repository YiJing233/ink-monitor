/**
 * Public widget gallery — no login required. Lists every BUILTIN_MANIFESTS
 * entry on the "Built-in" tab; when `MARKET_REGISTRY_URL` is set, also fetches
 * the curated remote registry and exposes it under "Marketplace". The
 * `/admin/market` page is the install surface for signed-in users; this page
 * is the read-only "what's available" preview a potential user can see
 * without signing up.
 *
 * Public (not in the middleware matcher): the gallery is content, not
 * per-user data. Search + category filter run client-side via the
 * `gallery-client.tsx` island.
 */
import { BUILTIN_LIST } from '@/lib/widgets/registry';
import { safeValidateManifest } from '@/lib/widgets/ir';
import { getCurrentUserId } from '@/lib/session';
import GalleryClient from './gallery-client';
import type { GalleryEntry } from '@/lib/widgets/gallery-filter';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function WidgetsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tab: 'builtin' | 'marketplace' = sp.tab === 'marketplace' ? 'marketplace' : 'builtin';

  const userId = await getCurrentUserId();
  const signedIn = !!userId;

  // Built-in entries — we deliberately do NOT set `category` here, so
  // `categoryOf()` derives it from `manifest.source.kind` and the chips
  // surface data-source facets (http / builtin / owned / asset / album).
  const builtins: GalleryEntry[] = BUILTIN_LIST.map((m) => ({ manifest: m }));

  // Marketplace entries — opt-in via env. Validation is server-side; invalid
  // entries are dropped (matches the policy in `/admin/market`).
  let marketplace: GalleryEntry[] = [];
  let marketplaceError: string | null = null;
  const marketplaceEnabled = !!process.env.MARKET_REGISTRY_URL;
  if (marketplaceEnabled) {
    try {
      const r = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/market`, { cache: 'no-store' });
      if (r.ok) {
        const j = (await r.json()) as {
          items: { manifest: unknown; category?: string; author?: string; icon?: string }[];
        };
        for (const e of j.items) {
          const v = safeValidateManifest(e.manifest);
          if (v.success) {
            marketplace.push({
              manifest: v.data,
              category: e.category,
              author: e.author,
              icon: e.icon,
            });
          }
        }
      } else if (r.status >= 400) {
        marketplaceError = `registry returned ${r.status}`;
      }
    } catch (e: any) {
      marketplaceError = e?.message || 'registry unreachable';
    }
  }

  return (
    <div className="admin">
      <h1 style={{ marginTop: 0 }}>Widget gallery</h1>
      <p className="hint">
        浏览 Ink Monitor 自带的 {builtins.length} 个小组件。点 <strong>Preview</strong> 看 1:1
        真实渲染效果；点 <strong>View manifest</strong> 看完整定义。安装请先
        <a href={signedIn ? '/admin/market' : '/signin?callbackUrl=/admin/market'}>登录</a>。
      </p>

      <div className="nav" data-tabs>
        <a href="/widgets" className={tab === 'builtin' ? 'active' : ''} data-tab="builtin">
          Built-in ({builtins.length})
        </a>
        {marketplaceEnabled && (
          <a href="/widgets?tab=marketplace" className={tab === 'marketplace' ? 'active' : ''} data-tab="marketplace">
            Marketplace ({marketplace.length})
          </a>
        )}
      </div>

      {tab === 'marketplace' && !marketplaceEnabled && (
        <div className="hint">Marketplace is not configured (set <code>MARKET_REGISTRY_URL</code>).</div>
      )}
      {tab === 'marketplace' && marketplaceError && (
        <div className="err">Marketplace unavailable: {marketplaceError}</div>
      )}

      <GalleryClient
        entries={tab === 'marketplace' ? marketplace : builtins}
        signedIn={signedIn}
      />
    </div>
  );
}