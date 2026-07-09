import { cookies, headers } from 'next/headers';
import { getCurrentUserId } from '@/lib/session';
import { listUserManifests } from '@/lib/db';
import { BUILTIN_LIST } from '@/lib/widgets/registry';
import { safeValidateManifest, type Manifest } from '@/lib/widgets/ir';
import { resolveLocale, t } from '@/lib/i18n';
import MarketClient, { type MarketEntry } from './market-client';

export const dynamic = 'force-dynamic';

export default async function MarketPage() {
  const userId = await getCurrentUserId();
  const c = await cookies();
  const h = await headers();
  const locale = resolveLocale(c.get('NEXT_LOCALE')?.value || null, h.get('accept-language'));
  const installedIds = userId ? listUserManifests(userId).map((r) => r.manifest_id) : [];

  // Curated remote gallery (validated server-side; invalid entries dropped).
  const remote: MarketEntry[] = [];
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || ''}/api/market`, { cache: 'no-store' });
    if (r.ok) {
      const j = (await r.json()) as { items: { manifest: unknown; category?: string; author?: string; icon?: string }[] };
      for (const e of j.items) {
        const v = safeValidateManifest(e.manifest);
        if (v.success) remote.push({ manifest: v.data, category: e.category, author: e.author, icon: e.icon });
      }
    }
  } catch {
    /* remote unavailable; carry on with built-ins */
  }

  // Gallery = built-ins (always available) + validated remote entries. Built-ins
  // default to category="builtin"/author="ink-monitor" so they surface in the
  // category filter alongside curated content.
  const gallery: MarketEntry[] = BUILTIN_LIST.map((m) => ({ manifest: m, category: 'builtin', author: 'ink-monitor' }));
  for (const e of remote) if (!gallery.some((g) => g.manifest.id === e.manifest.id)) gallery.push(e);

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{t(locale, 'admin.market.h')}</h2>
      <p className="hint" dangerouslySetInnerHTML={{ __html: t(locale, 'admin.market.body') }} />
      <MarketClient gallery={gallery} installedIds={installedIds} locale={locale} />
    </div>
  );
}
