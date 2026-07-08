import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertSafeAlbumPath,
  diskAlbumStore,
  setAlbumStore,
} from '../album-store';

/**
 * Path-traversal regression suite for the album store (F1 + F10).
 *
 * The disk store uses `path.join(process.cwd(), 'data', 'albums', userId, name)`
 * directly, and Next.js decodes URL segments before they reach us, so
 * `name='../../etc'` would resolve outside the user's album directory. We
 * reject that at two layers: a zod allowlist in the route handlers and
 * `assertSafeAlbumPath` at every disk-store entrypoint.
 */

// `diskAlbumStore` writes captions/ordering through the global
// getOwnedState/setOwnedState helpers. Stub them so the tests don't need
// SQLite — we only care about the disk I/O path here.
vi.mock('../../db', () => ({
  getOwnedState: () => null,
  setOwnedState: () => undefined,
}));

describe('assertSafeAlbumPath', () => {
  it('rejects parent-traversal segments', () => {
    expect(() => assertSafeAlbumPath('u', '../etc')).toThrow(/invalid album name/);
    expect(() => assertSafeAlbumPath('u', '..')).toThrow(/invalid album name/);
    expect(() => assertSafeAlbumPath('u', 'a/../../etc')).toThrow(/invalid album name/);
    expect(() => assertSafeAlbumPath('u', '..\\windows')).toThrow(/invalid album name/);
  });

  it('rejects embedded separators', () => {
    expect(() => assertSafeAlbumPath('u', 'foo/bar')).toThrow(/invalid album name/);
    expect(() => assertSafeAlbumPath('u', 'foo\\bar')).toThrow(/invalid album name/);
  });

  it('rejects literal "." and ".." segments', () => {
    expect(() => assertSafeAlbumPath('u', '.')).toThrow(/invalid album name/);
    expect(() => assertSafeAlbumPath('u', '..')).toThrow(/invalid album name/);
  });

  it('accepts normal album names', () => {
    expect(() => assertSafeAlbumPath('u', 'normal')).not.toThrow();
    expect(() => assertSafeAlbumPath('u', 'holiday-2024')).not.toThrow();
    expect(() => assertSafeAlbumPath('u', 'photos_v1.2')).not.toThrow();
    expect(() => assertSafeAlbumPath('u', 'a')).not.toThrow();
  });

  it('rejects empty / non-string input', () => {
    expect(() => assertSafeAlbumPath('u', '')).toThrow(/invalid album name/);
    // @ts-expect-error — runtime guard, not type-level
    expect(() => assertSafeAlbumPath('u', undefined)).toThrow(/invalid album name/);
  });
});

describe('diskAlbumStore.removeFile (F10 — scope-limited)', () => {
  let tmpRoot: string;
  let originalCwd: () => string;

  beforeEach(() => {
    // Sandbox the working directory so `process.cwd()` inside album-store.ts
    // resolves to a temp tree we own. We use a real fs tree so list/readdir
    // behaves the same way as in production — no fs mocking needed.
    tmpRoot = mkdtempSync(join(tmpdir(), 'album-sec-'));
    originalCwd = process.cwd;
    process.cwd = () => tmpRoot;

    // Seed an album with one known file so list() returns a real item.
    const albumDir = join(tmpRoot, 'data', 'albums', 'u', 'a');
    mkdirSync(albumDir, { recursive: true });
    writeFileSync(join(albumDir, 'cafef00d.jpg'), 'jpeg-bytes');

    // Wire diskAlbumStore as the active store (matches the route layer).
    setAlbumStore(diskAlbumStore);
  });

  afterEach(() => {
    process.cwd = originalCwd;
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('rejects traversal fileId without touching the filesystem', async () => {
    await expect(diskAlbumStore.removeFile!('u', 'a', '../../passwd')).rejects.toThrow(/invalid file id/);
    // Critical: nothing was unlinked. The real `cafef00d.jpg` is still there,
    // and no `/tmp/.../passwd` file appeared.
    expect(existsSync(join(tmpRoot, 'data', 'albums', 'u', 'a', 'cafef00d.jpg'))).toBe(true);
    expect(existsSync(join(tmpRoot, 'passwd'))).toBe(false);
  });

  it('rejects empty / dot-segment fileIds', async () => {
    await expect(diskAlbumStore.removeFile!('u', 'a', '')).rejects.toThrow(/invalid file id/);
    await expect(diskAlbumStore.removeFile!('u', 'a', '.')).rejects.toThrow(/invalid file id/);
    await expect(diskAlbumStore.removeFile!('u', 'a', '..')).rejects.toThrow(/invalid file id/);
    await expect(diskAlbumStore.removeFile!('u', 'a', 'a/b')).rejects.toThrow(/invalid file id/);
    expect(existsSync(join(tmpRoot, 'data', 'albums', 'u', 'a', 'cafef00d.jpg'))).toBe(true);
  });

  it('rejects traversal album names without touching the filesystem', async () => {
    await expect(diskAlbumStore.removeFile!('u', '../etc', 'whatever')).rejects.toThrow(/invalid album name/);
    expect(existsSync(join(tmpRoot, 'data', 'albums', 'u', 'a', 'cafef00d.jpg'))).toBe(true);
  });

  it('early-returns when the fileId is not present in the album', async () => {
    // fileId is well-formed but unknown to this album — should be a no-op.
    await expect(diskAlbumStore.removeFile!('u', 'a', 'deadbeef')).resolves.toBeUndefined();
    expect(existsSync(join(tmpRoot, 'data', 'albums', 'u', 'a', 'cafef00d.jpg'))).toBe(true);
  });

  it('removes only files matching `<fileId>.<ext>` (F10 scope)', async () => {
    // Add a sibling file to make sure we don't unlink unrelated files.
    writeFileSync(join(tmpRoot, 'data', 'albums', 'u', 'a', 'babe1234.jpg'), 'other-bytes');

    await diskAlbumStore.removeFile!('u', 'a', 'cafef00d');

    expect(existsSync(join(tmpRoot, 'data', 'albums', 'u', 'a', 'cafef00d.jpg'))).toBe(false);
    expect(existsSync(join(tmpRoot, 'data', 'albums', 'u', 'a', 'babe1234.jpg'))).toBe(true);
  });
});