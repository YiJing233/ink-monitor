import { NextRequest, NextResponse } from 'next/server';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { z } from 'zod';
import { getRequiredUserId } from '@/lib/session';
import { getAlbumStore } from '@/lib/widgets/album-store';

export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

/** URL-segment allowlist — blocks path traversal (`..`, `/`) and anything
 *  that wouldn't survive `path.resolve`. Route entrypoint contract; the disk
 *  store also re-validates as defense in depth. */
const SegmentSchema = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9._-]{1,64}$/)
  .refine((s) => s !== '.' && s !== '..' && !s.startsWith('.') && !s.includes('..'), {
    message: 'invalid segment',
  });

function badSegment() {
  return NextResponse.json({ error: 'invalid segment' }, { status: 400 });
}

/** Stream a stored album photo to the browser. Owner-only. The dither proxy
 *  downstream still applies the signed-URL contract. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string; fileId: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { name, fileId } = await params;
  if (!SegmentSchema.safeParse(name).success) return badSegment();
  if (!SegmentSchema.safeParse(fileId.split('.')[0]).success) return badSegment();
  // fileId may include its extension (e.g. "abc.jpg"). Match against what disk has.
  const dir = join(process.cwd(), 'data', 'albums', userId, name);
  if (!existsSync(dir)) return new NextResponse('not found', { status: 404 });
  const fs = await import('node:fs/promises');
  const files = await fs.readdir(dir).catch(() => []);
  // Accept either bare id or id.ext.
  const target = files.find((f) => f === fileId || f.split('.')[0] === fileId);
  if (!target) return new NextResponse('not found', { status: 404 });
  const buf = await readFile(join(dir, target));
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'private, max-age=600',
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ name: string; fileId: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { name, fileId } = await params;
  if (!SegmentSchema.safeParse(name).success) return badSegment();
  if (!SegmentSchema.safeParse(fileId.split('.')[0]).success) return badSegment();
  const store = getAlbumStore();
  if (!store.removeFile) return NextResponse.json({ error: 'upload not supported in this environment' }, { status: 400 });
  await store.removeFile(userId, name, fileId.split('.')[0]);
  return NextResponse.json({ ok: true });
}
