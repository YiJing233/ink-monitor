/**
 * Album storage adapter. Four backends (selected at module load by env):
 *
 *   - `urls`         : the URL list lives in platform-owned state (works on
 *                      Vercel and self-host). Users point at CDN-hosted photos.
 *                      The default off-Vercel.
 *   - `disk`         : uploaded bytes live on the server's local FS under
 *                      `data/albums/<userId>/<album>/...`. Served by a tiny
 *                      route that streams the file. Self-host only — Vercel's
 *                      FS is ephemeral + read-only.
 *   - `vercel-blob`  : uploads go to Vercel Blob via the optional
 *                      `@vercel/blob` SDK. The hosted equivalent of `disk`;
 *                      opt-in via `ALBUM_STORE=vercel-blob` or auto on Vercel
 *                      when `BLOB_READ_WRITE_TOKEN` is set.
 *   - `s3`           : uploads go to S3 (or any S3-compatible store, including
 *                      Cloudflare R2 / MinIO) via the optional
 *                      `@aws-sdk/client-s3` SDK. `S3_ENDPOINT` switches the
 *                      client to path-style (R2/MinIO).
 *
 * Pick with `ALBUM_STORE=urls|disk|vercel-blob|s3`. On Vercel with no override
 * and a configured `BLOB_READ_WRITE_TOKEN`, we auto-pick `vercel-blob`. The
 * pick path (`list` + `resolveRotatingAlbum`) doesn't care which store backs
 * it; the manifest's `album` source kind is unchanged.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { basename, join, extname, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getOwnedState, setOwnedState } from '../db';
import type { put as VercelPut, del as VercelDel, PutBlobResult } from '@vercel/blob';
import type { PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AlbumItem {
  src: string; // either an http(s) URL (urls/vercel-blob/s3 store) or `/api/album-asset/...` (disk store)
  caption?: string;
  // Internal — disk / vercel-blob / s3 stores only. The pathname or S3 key
  // that lets `removeFile` clean up the remote object.
  _fileId?: string;
}

export interface AlbumStore {
  list(userId: string, album: string): Promise<AlbumItem[]>;
  set(userId: string, album: string, items: AlbumItem[]): Promise<void>;
  /** Disk / vercel-blob / s3 — accept raw bytes and add an entry. */
  addFile?(userId: string, album: string, filename: string, data: Buffer, caption?: string): Promise<AlbumItem>;
  /** Disk / vercel-blob / s3 — remove the entry + delete the underlying bytes. */
  removeFile?(userId: string, album: string, fileId: string): Promise<void>;
}

/** Thrown by the optional backends when the SDK isn't installed or the
 *  environment is misconfigured. The route layer maps this to HTTP 503. */
export class AlbumStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlbumStoreError';
  }
}

/** IO seam — tests inject a Map-backed impl so we don't touch SQLite. */
export interface AlbumStoreIO {
  get(userId: string, store: string): unknown;
  set(userId: string, store: string, value: unknown): void;
}

const defaultIO: AlbumStoreIO = {
  get: (userId, store) => getOwnedState(userId, store),
  set: (userId, store, value) => setOwnedState(userId, store, value),
};

const PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff']);

// -- urls store (works everywhere) --

export const urlsAlbumStore: AlbumStore = {
  async list(userId, album) {
    const raw = (await defaultIO.get(userId, `album:${album}`)) as { items?: AlbumItem[] } | null;
    return raw?.items ?? [];
  },
  async set(userId, album, items) {
    defaultIO.set(userId, `album:${album}`, { items });
  },
};

// -- disk store (self-host) --

function albumDir(userId: string, album: string): string {
  return join(process.cwd(), 'data', 'albums', userId, album);
}

/** Reject path-traversal in `name` so that we can never escape the user's
 *  album directory (`data/albums/<userId>/`). Throws when the resolved path
 *  would leave the user's root, or when the segment contains characters
 *  that would let traversal sneak past the path resolver. */
export function assertSafeAlbumPath(userId: string, name: string): void {
  if (typeof name !== 'string' || name.length === 0) throw new Error('invalid album name');
  if (name === '.' || name === '..') throw new Error('invalid album name');
  if (name.includes('/') || name.includes('\\')) throw new Error('invalid album name');
  if (name.includes('..')) throw new Error('invalid album name');
  const root = resolve(process.cwd(), 'data', 'albums', userId);
  const target = resolve(root, name);
  // Must remain under <root>/ — use a trailing separator so `/foo2` is not
  // considered a child of `/foo`.
  if (!target.startsWith(root + sep)) throw new Error('invalid album name');
}

function publicUrlFor(userId: string, album: string, fileId: string, ext: string): string {
  return `/api/album-asset/${encodeURIComponent(userId)}/${encodeURIComponent(album)}/${fileId}${ext}`;
}

export const diskAlbumStore: AlbumStore = {
  async list(userId, album) {
    assertSafeAlbumPath(userId, album);
    // Read the captions + ordering from owned_state; pull the file list from disk.
    const dir = albumDir(userId, album);
    let files: string[] = [];
    if (existsSync(dir)) {
      files = (await readdir(dir)).filter((f) => PHOTO_EXT.has(extname(f).toLowerCase())).sort();
    }
    const meta = ((await defaultIO.get(userId, `album:${album}`)) as { order?: Record<string, number>; captions?: Record<string, string> } | null) ?? {};
    return files.map((file) => {
      const [fileId, ext] = file.split('.');
      return { src: publicUrlFor(userId, album, fileId, '.' + ext), caption: meta.captions?.[fileId], _fileId: fileId };
    });
  },
  async set(userId, album, items) {
    // Validate even though `set` only writes metadata — defense in depth so a
    // future maintainer who adds disk I/O to this method can't reintroduce the
    // path-traversal bug.
    assertSafeAlbumPath(userId, album);
    // Persist just the caption metadata + ordering; bytes are on disk.
    const captions: Record<string, string> = {};
    const order: Record<string, number> = {};
    items.forEach((it, i) => {
      if (it._fileId && it.caption) captions[it._fileId] = it.caption;
      if (it._fileId) order[it._fileId] = i;
    });
    defaultIO.set(userId, `album:${album}`, { captions, order });
  },
  async addFile(userId, album, filename, data, caption) {
    assertSafeAlbumPath(userId, album);
    const ext = (extname(filename) || '.jpg').toLowerCase();
    if (!PHOTO_EXT.has(ext)) throw new AlbumStoreError('unsupported image type');
    const dir = albumDir(userId, album);
    await mkdir(dir, { recursive: true });
    const fileId = randomBytes(8).toString('hex');
    const target = join(dir, `${fileId}${ext}`);
    await writeFile(target, data);
    const item: AlbumItem = { src: publicUrlFor(userId, album, fileId, ext), caption, _fileId: fileId };
    const items = await diskAlbumStore.list(userId, album);
    items.push(item);
    await diskAlbumStore.set(userId, album, items);
    return item;
  },
  async removeFile(userId, album, fileId) {
    assertSafeAlbumPath(userId, album);
    if (typeof fileId !== 'string' || fileId.length === 0 || fileId === '.' || fileId === '..' || fileId.includes('/') || fileId.includes('\\') || fileId.includes('..')) {
      throw new Error('invalid file id');
    }
    // First, refuse to touch anything we don't already know about. `list` is
    // the source of truth for which fileIds belong to this album — a request
    // for a non-existent id is a no-op, never an unlink.
    const items = await diskAlbumStore.list(userId, album);
    if (!items.some((i) => i._fileId === fileId)) return;
    const dir = albumDir(userId, album);
    if (!existsSync(dir)) return;
    // Only delete files whose name starts with `<fileId>.` — i.e. known
    // suffix variants belonging to this id. Never unlink `target` directly
    // (it has no extension and would not exist).
    for (const f of await readdir(dir)) {
      if (f.startsWith(fileId + '.')) await unlink(join(dir, f)).catch(() => {});
    }
    const remaining = items.filter((i) => i._fileId !== fileId);
    await diskAlbumStore.set(userId, album, remaining);
  },
};

// ---------------------------------------------------------------------------
// vercel-blob store (hosted, opt-in or auto on Vercel)
// ---------------------------------------------------------------------------

export interface VercelBlobSdk {
  put: typeof VercelPut;
  del: typeof VercelDel;
}

/** Minimal subset of {@link PutBlobResult} — keeps test types narrow. */
export type VercelBlobPutResult = Pick<PutBlobResult, 'url' | 'pathname'>;

export interface VercelBlobStoreDeps {
  /** Pre-resolved SDK (tests). Skips the dynamic import. */
  sdk?: VercelBlobSdk;
  /** Custom loader; default imports `@vercel/blob` and may throw. */
  loadSdk?: () => Promise<VercelBlobSdk>;
  /** Persistence seam. */
  io?: AlbumStoreIO;
}

/** Default dynamic loader for `@vercel/blob`. Throws an
 *  {@link AlbumStoreError} when the SDK isn't installed or the runtime is
 *  misconfigured. */
export async function defaultLoadVercelBlobSdk(): Promise<VercelBlobSdk> {
  let mod: any;
  try {
    mod = await import('@vercel/blob');
  } catch {
    throw new AlbumStoreError('@vercel/blob SDK not installed; add it via `pnpm add -O @vercel/blob` to enable uploads');
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new AlbumStoreError('vercel-blob not configured: BLOB_READ_WRITE_TOKEN is not set');
  }
  return { put: mod.put, del: mod.del };
}

export function makeVercelBlobStore(deps: VercelBlobStoreDeps = {}): AlbumStore {
  const io = deps.io ?? defaultIO;

  async function getSdk(): Promise<VercelBlobSdk> {
    if (deps.sdk) {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        throw new AlbumStoreError('vercel-blob not configured: BLOB_READ_WRITE_TOKEN is not set');
      }
      return deps.sdk;
    }
    return (deps.loadSdk ?? defaultLoadVercelBlobSdk)();
  }

  return {
    async list(userId, album) {
      const raw = (await Promise.resolve(io.get(userId, `album:${album}`))) as { items?: AlbumItem[] } | null;
      return raw?.items ?? [];
    },
    async set(userId, album, items) {
      io.set(userId, `album:${album}`, { items });
    },
    async addFile(userId, album, filename, data, caption) {
      const sdk = await getSdk();
      const token = process.env.BLOB_READ_WRITE_TOKEN!;
      const ext = (extname(filename) || '.jpg').toLowerCase();
      if (!PHOTO_EXT.has(ext)) throw new AlbumStoreError('unsupported image type');
      const name = basename(filename, ext).replace(/[^a-zA-Z0-9_-]/g, '_') || 'photo';
      const objectName = `albums/${userId}/${album}/${Date.now()}-${randomBytes(6).toString('hex')}-${name}${ext}`;
      const result = await sdk.put(objectName, data, { access: 'public', addRandomSuffix: true, token });
      const item: AlbumItem = { src: result.url, caption, _fileId: result.pathname };
      const items = await this.list(userId, album);
      items.push(item);
      await this.set(userId, album, items);
      return item;
    },
    async removeFile(userId, album, fileId) {
      const items = await this.list(userId, album);
      const found = items.find((i) => i._fileId === fileId);
      if (!found) return;
      // Best-effort remote delete — if the SDK is missing or the network is
      // down we still clear the local pointer so the album stays consistent.
      try {
        const sdk = await getSdk();
        await sdk.del(found.src);
      } catch {
        /* swallow */
      }
      const remaining = items.filter((i) => i._fileId !== fileId);
      await this.set(userId, album, remaining);
    },
  };
}

export const vercelBlobAlbumStore: AlbumStore = makeVercelBlobStore();

// ---------------------------------------------------------------------------
// S3 store (hosted, opt-in or auto on Vercel)
// ---------------------------------------------------------------------------

export interface S3LikeClient { send(command: unknown): Promise<unknown>; }

export interface S3StoreDeps {
  /** Pre-constructed client (tests). Skips the dynamic import + SDK boot. */
  client?: S3LikeClient;
  /** Bucket name; defaults to `S3_BUCKET` env at module load. */
  bucket?: string;
  /** Region; defaults to `S3_REGION` env or 'us-east-1'. */
  region?: string;
  /** Endpoint override (R2, MinIO). */
  endpoint?: string;
  /** URL template; supports `${key}`. Default: `${S3_ENDPOINT}/${S3_BUCKET}/${key}`. */
  publicUrlTemplate?: string;
  /** Persistence seam. */
  io?: AlbumStoreIO;
}

/** Resolve a public URL for an object key from a template. Supports an
 *  explicit `${key}` placeholder; otherwise treats the template as a
 *  path prefix. */
export function buildS3PublicUrl(template: string, key: string): string {
  if (template.includes('${key}')) return template.split('${key}').join(key);
  const sep = template.endsWith('/') ? '' : '/';
  return `${template}${sep}${key}`;
}

async function defaultLoadS3Client(deps: S3StoreDeps): Promise<S3LikeClient> {
  let mod: any;
  try {
    mod = await import('@aws-sdk/client-s3');
  } catch {
    throw new AlbumStoreError('@aws-sdk/client-s3 SDK not installed; add it via `pnpm add -O @aws-sdk/client-s3` to enable uploads');
  }
  const region = deps.region ?? process.env.S3_REGION ?? 'us-east-1';
  const endpoint = deps.endpoint ?? process.env.S3_ENDPOINT;
  return new mod.S3Client({
    region,
    endpoint,
    forcePathStyle: !!endpoint,
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! }
        : undefined,
  });
}

export function makeS3Store(deps: S3StoreDeps = {}): AlbumStore {
  const io = deps.io ?? defaultIO;
  let _client: S3LikeClient | null = null;
  let _bucket: string | null = null;
  let _publicUrlTemplate: string | null = null;

  async function boot(): Promise<{ client: S3LikeClient; bucket: string; publicUrlTemplate: string }> {
    if (_client) {
      return { client: _client, bucket: _bucket!, publicUrlTemplate: _publicUrlTemplate! };
    }
    const bucket = deps.bucket ?? process.env.S3_BUCKET;
    if (!bucket) throw new AlbumStoreError('s3 not configured: S3_BUCKET is not set');
    const region = deps.region ?? process.env.S3_REGION ?? 'us-east-1';
    const endpoint = deps.endpoint ?? process.env.S3_ENDPOINT;
    const publicUrlTemplate =
      deps.publicUrlTemplate
      ?? process.env.S3_PUBLIC_URL
      ?? (endpoint ? `${endpoint.replace(/\/$/, '')}/${bucket}/\${key}` : null)
      ?? `https://${bucket}.s3.${region}.amazonaws.com/\${key}`;
    const client = deps.client ?? (await defaultLoadS3Client(deps));
    _client = client;
    _bucket = bucket;
    _publicUrlTemplate = publicUrlTemplate;
    return { client, bucket, publicUrlTemplate };
  }

  return {
    async list(userId, album) {
      const raw = (await Promise.resolve(io.get(userId, `album:${album}`))) as { items?: AlbumItem[] } | null;
      return raw?.items ?? [];
    },
    async set(userId, album, items) {
      io.set(userId, `album:${album}`, { items });
    },
    async addFile(userId, album, filename, data, caption) {
      const ext = (extname(filename) || '.jpg').toLowerCase();
      if (!PHOTO_EXT.has(ext)) throw new AlbumStoreError('unsupported image type');
      const { client, bucket, publicUrlTemplate } = await boot();
      const name = basename(filename, ext).replace(/[^a-zA-Z0-9_-]/g, '_') || 'photo';
      const key = `albums/${userId}/${album}/${Date.now()}-${randomBytes(6).toString('hex')}-${name}${ext}`;
      let mod: any;
      try {
        mod = await import('@aws-sdk/client-s3');
      } catch {
        throw new AlbumStoreError('@aws-sdk/client-s3 SDK not installed; add it via `pnpm add -O @aws-sdk/client-s3` to enable uploads');
      }
      await client.send(new mod.PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: mimeFor(ext) }));
      const src = buildS3PublicUrl(publicUrlTemplate, key);
      const item: AlbumItem = { src, caption, _fileId: key };
      const items = await this.list(userId, album);
      items.push(item);
      await this.set(userId, album, items);
      return item;
    },
    async removeFile(userId, album, fileId) {
      const items = await this.list(userId, album);
      const found = items.find((i) => i._fileId === fileId);
      if (!found) return;
      // Best-effort remote delete — same reasoning as vercel-blob.
      try {
        const { client, bucket } = await boot();
        let mod: any;
        try {
          mod = await import('@aws-sdk/client-s3');
        } catch { return; }
        await client.send(new mod.DeleteObjectCommand({ Bucket: bucket, Key: fileId }));
      } catch {
        /* swallow */
      }
      const remaining = items.filter((i) => i._fileId !== fileId);
      await this.set(userId, album, remaining);
    },
  };
}

export const s3AlbumStore: AlbumStore = makeS3Store();

function mimeFor(ext: string): string {
  const m: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
  };
  return m[ext.toLowerCase()] || 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function pickStoreSync(): AlbumStore {
  const mode = (process.env.ALBUM_STORE || '').toLowerCase();
  if (mode === 'urls') return urlsAlbumStore;
  if (mode === 'disk') return diskAlbumStore;
  if (mode === 'vercel-blob' || mode === 'vercelblob') return vercelBlobAlbumStore;
  if (mode === 's3') return s3AlbumStore;
  // No explicit override — Vercel defaults to urls unless the user wired up a
  // hosted upload backend, in which case we auto-pick it.
  if (process.env.VERCEL) {
    if (process.env.BLOB_READ_WRITE_TOKEN) return vercelBlobAlbumStore;
    if (process.env.S3_BUCKET && process.env.S3_REGION) return s3AlbumStore;
  }
  // Default fallback everywhere — works in any environment.
  return urlsAlbumStore;
}

let _active: AlbumStore = pickStoreSync();

/** Lazy async probe for the VERCEL auto-detect path: if VERCEL=1 is set and
 *  no ALBUM_STORE override is in play, but the user has the host SDK +
 *  env wired up, prefer the hosted backend over `urls`. Probing happens
 *  after first module load so we don't slow down boot; we only swap if it
 *  actually resolves cleanly. */
void (async () => {
  if (!process.env.VERCEL) return;
  if (process.env.ALBUM_STORE) return; // explicit user override — don't touch
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      await import('@vercel/blob');
      _active = vercelBlobAlbumStore;
      return;
    } catch {
      /* SDK not installed — keep current pick. */
    }
  }
  if (process.env.S3_BUCKET && process.env.S3_REGION) {
    try {
      await import('@aws-sdk/client-s3');
      _active = s3AlbumStore;
    } catch {
      /* SDK not installed — keep current pick. */
    }
  }
})();

export function setAlbumStore(s: AlbumStore) {
  _active = s;
}
export function getAlbumStore(): AlbumStore {
  return _active;
}

/** What the active store can do — set automatically by env (so the API can
 *  advertise the right upload affordance). */
export function isUploadSupported(): boolean {
  return typeof getAlbumStore().addFile === 'function';
}
