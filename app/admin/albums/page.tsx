import { getCurrentUserId } from '@/lib/session';
import { getAlbumStore, isUploadSupported } from '@/lib/widgets/album-store';
import AlbumClient from './album-client';

export const dynamic = 'force-dynamic';

export default async function AlbumsPage({ searchParams }: { searchParams: Promise<{ a?: string }> }) {
  const sp = await searchParams;
  const userId = await getCurrentUserId();
  const albumName = sp.a || 'default';
  const items = userId ? await getAlbumStore().list(userId, albumName) : [];

  return (
    <div>
      <h2 style={{ marginTop: 0 }}>Albums</h2>
      <p className="hint">
        旋转相册的数据源（manifest 选 <code>album</code> source kind 时读这里）。
        URL 列表适合挂 CDN 相册；上传适合自托管。两种存储后端可切换；切换时
        你看到的相册就是当前 <code>getAlbumStore()</code> 的实现。
      </p>
      <AlbumClient album={albumName} initialItems={items} uploadSupported={isUploadSupported()} />
    </div>
  );
}
