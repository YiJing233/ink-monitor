import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AlbumStoreError,
  buildS3PublicUrl,
  makeS3Store,
  type AlbumStoreIO,
  type S3LikeClient,
} from '../album-store';

/** In-memory IO seam so the suite doesn't need SQLite. */
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

describe('buildS3PublicUrl', () => {
  it('substitutes ${key} placeholders', () => {
    expect(buildS3PublicUrl('https://cdn.example.com/albums/${key}', 'a/b/c.jpg'))
      .toBe('https://cdn.example.com/albums/a/b/c.jpg');
  });
  it('treats the template as a path prefix when ${key} is absent', () => {
    expect(buildS3PublicUrl('https://cdn.example.com/albums/', 'a/b/c.jpg'))
      .toBe('https://cdn.example.com/albums/a/b/c.jpg');
    expect(buildS3PublicUrl('https://cdn.example.com/albums', 'a/b/c.jpg'))
      .toBe('https://cdn.example.com/albums/a/b/c.jpg');
  });
});

describe('makeS3Store', () => {
  const sendMock = vi.fn();
  const client: S3LikeClient = { send: sendMock as unknown as S3LikeClient['send'] };
  let io: ReturnType<typeof makeIO>;
  let store: ReturnType<typeof makeS3Store>;

  beforeEach(() => {
    sendMock.mockReset();
    io = makeIO();
    store = makeS3Store({
      client,
      bucket: 'my-bucket',
      publicUrlTemplate: 'https://cdn.example.com/${key}',
      io,
    });
  });

  it('addFile sends PutObject with bucket/key/body and stores a public URL', async () => {
    sendMock.mockResolvedValue({});
    const body = Buffer.from('jpeg-bytes');

    const item = await store.addFile!('u', 'v', 'sunset.jpg', body, 'Golden hour');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd: any = sendMock.mock.calls[0][0];
    // The actual command class is irrelevant (it could be a real `PutObjectCommand`
    // or a stub); we assert on the shape stored by AWS SDK v3.
    expect(cmd.input).toMatchObject({
      Bucket: 'my-bucket',
      Body: body,
    });
    expect(cmd.input.Key).toMatch(/^albums\/u\/v\/\d+-[a-f0-9]+-sunset\.jpg$/);

    expect(item.src).toMatch(/^https:\/\/cdn\.example\.com\/albums\/u\/v\/\d+-[a-f0-9]+-sunset\.jpg$/);
    expect(item._fileId).toBe(cmd.input.Key);
    expect(item.caption).toBe('Golden hour');

    const items = await store.list('u', 'v');
    expect(items).toHaveLength(1);
    expect(items[0].src).toContain('cdn.example.com');
  });

  it('list returns an empty array when nothing has been stored', async () => {
    const items = await store.list('u', 'empty');
    expect(items).toEqual([]);
  });

  it('removeFile sends DeleteObject and removes the entry from state', async () => {
    sendMock.mockResolvedValue({});
    await store.addFile!('u', 'v', 'x.jpg', Buffer.from('a'));

    const sendCallsBeforeDel = sendMock.mock.calls.length;
    const key = (await store.list('u', 'v'))[0]._fileId!;
    await store.removeFile!('u', 'v', key);

    expect(sendMock.mock.calls.length).toBe(sendCallsBeforeDel + 1);
    const delCmd: any = sendMock.mock.calls[sendCallsBeforeDel][0];
    expect(delCmd.input).toEqual({ Bucket: 'my-bucket', Key: key });

    expect(await store.list('u', 'v')).toEqual([]);
  });

  it('removeFile swallows remote DeleteObject errors and still clears local state', async () => {
    sendMock.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('S3 unreachable'));

    await store.addFile!('u', 'v', 'y.jpg', Buffer.from('b'));
    const key = (await store.list('u', 'v'))[0]._fileId!;

    await expect(store.removeFile!('u', 'v', key)).resolves.toBeUndefined();
    expect(await store.list('u', 'v')).toEqual([]);
  });

  it('throws AlbumStoreError when S3_BUCKET is not configured', async () => {
    const noBucketStore = makeS3Store({ client, io });
    await expect(
      noBucketStore.addFile!('u', 'v', 'z.jpg', Buffer.from('c')),
    ).rejects.toBeInstanceOf(AlbumStoreError);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects unsupported file types', async () => {
    await expect(
      store.addFile!('u', 'v', 'evil.txt', Buffer.from('not an image')),
    ).rejects.toBeInstanceOf(AlbumStoreError);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
