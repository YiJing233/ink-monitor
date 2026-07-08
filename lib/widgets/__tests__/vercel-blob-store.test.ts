import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AlbumStoreError,
  makeVercelBlobStore,
  type AlbumStoreIO,
  type VercelBlobSdk,
} from '../album-store';

/**
 * In-memory IO seam so the suite doesn't need SQLite.
 * Captures writes; serves back what `set` has stored.
 */
function makeIO(): AlbumStoreIO & { _data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    _data: data,
    get(_userId, store) {
      return data.get(store) ?? null;
    },
    set(_userId, store, value) {
      data.set(store, value);
    },
  };
}

describe('makeVercelBlobStore', () => {
  const putMock = vi.fn();
  const delMock = vi.fn();
  const sdk: VercelBlobSdk = {
    put: putMock as unknown as VercelBlobSdk['put'],
    del: delMock as unknown as VercelBlobSdk['del'],
  };

  let io: ReturnType<typeof makeIO>;
  let store: ReturnType<typeof makeVercelBlobStore>;

  beforeEach(() => {
    putMock.mockReset();
    delMock.mockReset();
    io = makeIO();
    process.env.BLOB_READ_WRITE_TOKEN = 'test-token';
    store = makeVercelBlobStore({ sdk, io });
  });

  it('addFile uploads via the SDK and persists the returned URL + caption', async () => {
    putMock.mockResolvedValue({
      url: 'https://blob.vercel-storage.com/albums/u/v/abc-photo.jpg',
      pathname: 'albums/u/v/abc-photo.jpg',
    });

    const item = await store.addFile!('u', 'v', 'sunset.jpg', Buffer.from('jpeg-bytes'), 'Golden hour');

    expect(putMock).toHaveBeenCalledTimes(1);
    const [objectName, body, opts] = putMock.mock.calls[0];
    expect(objectName).toMatch(/^albums\/u\/v\/\d+-[a-f0-9]+-sunset\.jpg$/);
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(opts).toEqual({ access: 'public', addRandomSuffix: true, token: 'test-token' });

    expect(item.src).toBe('https://blob.vercel-storage.com/albums/u/v/abc-photo.jpg');
    expect(item._fileId).toBe('albums/u/v/abc-photo.jpg');
    expect(item.caption).toBe('Golden hour');

    const items = await store.list('u', 'v');
    expect(items).toHaveLength(1);
    expect(items[0].src).toContain('https://blob.vercel-storage.com/');
    expect(items[0].caption).toBe('Golden hour');
  });

  it('list returns an empty array when no items have been stored', async () => {
    const items = await store.list('u', 'empty');
    expect(items).toEqual([]);
  });

  it('removeFile deletes via the SDK and removes the entry from state', async () => {
    putMock.mockResolvedValue({
      url: 'https://blob.vercel-storage.com/albums/u/v/x.jpg',
      pathname: 'albums/u/v/x.jpg',
    });
    await store.addFile!('u', 'v', 'x.jpg', Buffer.from('a'));
    await store.removeFile!('u', 'v', 'albums/u/v/x.jpg');

    expect(delMock).toHaveBeenCalledTimes(1);
    expect(delMock).toHaveBeenCalledWith('https://blob.vercel-storage.com/albums/u/v/x.jpg');
    expect(await store.list('u', 'v')).toEqual([]);
  });

  it('removeFile swallows remote del errors and still clears local state', async () => {
    putMock.mockResolvedValue({
      url: 'https://blob.vercel-storage.com/albums/u/v/y.jpg',
      pathname: 'albums/u/v/y.jpg',
    });
    await store.addFile!('u', 'v', 'y.jpg', Buffer.from('b'));
    delMock.mockRejectedValueOnce(new Error('network down'));

    await expect(store.removeFile!('u', 'v', 'albums/u/v/y.jpg')).resolves.toBeUndefined();
    expect(await store.list('u', 'v')).toEqual([]);
  });

  it('addFile throws AlbumStoreError when BLOB_READ_WRITE_TOKEN is missing', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const noTokenStore = makeVercelBlobStore({ sdk, io });
    await expect(
      noTokenStore.addFile!('u', 'v', 'z.jpg', Buffer.from('c')),
    ).rejects.toBeInstanceOf(AlbumStoreError);
    await expect(
      noTokenStore.addFile!('u', 'v', 'z.jpg', Buffer.from('c')),
    ).rejects.toThrow(/BLOB_READ_WRITE_TOKEN/);
  });

  it('addFile throws AlbumStoreError when the SDK loader reports a missing install', async () => {
    const brokenStore = makeVercelBlobStore({
      loadSdk: () => Promise.reject(new AlbumStoreError('@vercel/blob SDK not installed')),
      io,
    });
    await expect(
      brokenStore.addFile!('u', 'v', 'q.jpg', Buffer.from('d')),
    ).rejects.toBeInstanceOf(AlbumStoreError);
    // Successful entry isn't persisted when the SDK fails.
    expect(await brokenStore.list('u', 'v')).toEqual([]);
    // The injected put should not have been called.
    expect(putMock).not.toHaveBeenCalled();
  });

  it('addFile rejects unsupported file types', async () => {
    await expect(
      store.addFile!('u', 'v', 'evil.txt', Buffer.from('not an image')),
    ).rejects.toBeInstanceOf(AlbumStoreError);
    expect(putMock).not.toHaveBeenCalled();
  });
});
