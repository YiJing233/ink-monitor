import { cookies, headers } from 'next/headers';
import { getCurrentUserId } from '@/lib/session';
import { getAlbumStore, isUploadSupported } from '@/lib/widgets/album-store';
import { resolveLocale, t } from '@/lib/i18n';
import AlbumClient from './album-client';

export const dynamic = 'force-dynamic';

export default async function AlbumsPage({ searchParams }: { searchParams: Promise<{ a?: string }> }) {
  const sp = await searchParams;
  const userId = await getCurrentUserId();
  const c = await cookies();
  const h = await headers();
  const locale = resolveLocale(c.get('NEXT_LOCALE')?.value || null, h.get('accept-language'));
  const albumName = sp.a || 'default';
  const items = userId ? await getAlbumStore().list(userId, albumName) : [];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>{t(locale, 'admin.albums.h')}</h2>
      <p className="hint" dangerouslySetInnerHTML={{ __html: t(locale, 'admin.albums.body') }} />
      <AlbumClient album={albumName} initialItems={items} uploadSupported={isUploadSupported()} locale={locale} />
    </div>
  );
}
