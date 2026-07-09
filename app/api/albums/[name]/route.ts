import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRequiredUserId } from '@/lib/session';
import { getAlbumStore, isUploadSupported, AlbumStoreError, type AlbumItem } from '@/lib/widgets/album-store';
import { recordAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';

const SetSchema = z.object({ items: z.array(z.object({ src: z.string().min(1), caption: z.string().optional() })) });

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

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { name } = await params;
  if (!SegmentSchema.safeParse(name).success) return badSegment();
  const items = await getAlbumStore().list(userId, name);
  return NextResponse.json({ items, uploadSupported: isUploadSupported() });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { name } = await params;
  if (!SegmentSchema.safeParse(name).success) return badSegment();

  // Multipart = photo upload (disk store only).
  const ct = req.headers.get('content-type') || '';
  if (ct.startsWith('multipart/form-data')) {
    const store = getAlbumStore();
    if (!store.addFile) return NextResponse.json({ error: 'upload not supported in this environment' }, { status: 400 });
    const form = await req.formData();
    const file = form.get('file');
    const caption = (form.get('caption') as string | null) || undefined;
    if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 });
    if (file.size > 12 * 1024 * 1024) return NextResponse.json({ error: 'file too large (max 12MB)' }, { status: 413 });
    const buf = Buffer.from(await file.arrayBuffer());
    let item: AlbumItem;
    try {
      item = await store.addFile(userId, name, file.name || 'photo.jpg', buf, caption);
    } catch (err) {
      if (err instanceof AlbumStoreError) {
        return NextResponse.json({ error: 'upload backend not configured' }, { status: 503 });
      }
      throw err;
    }
    recordAudit({
      userId,
      action: 'album.upload',
      targetType: 'album',
      targetId: name,
      after: { filename: file.name || 'photo.jpg', size: file.size },
    });
    return NextResponse.json({ ok: true, item });
  }

  // JSON = replace the album.
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = SetSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const items: AlbumItem[] = parsed.data.items.map((it) => ({ src: it.src, caption: it.caption }));
  await getAlbumStore().set(userId, name, items);
  recordAudit({
    userId,
    action: 'album.save',
    targetType: 'album',
    targetId: name,
    after: { count: items.length },
  });
  return NextResponse.json({ ok: true, count: items.length });
}

/** Wipe an entire album. Replaces the photo list with `[]` so the disk /
 *  vercel-blob / s3 stores can release any underlying objects via the
 *  store-specific teardown (currently the URLs store keeps the list empty and
 *  leaves previously-uploaded bytes as orphans — narrowing this is future
 *  work; this handler mirrors what the editor exposes as "Clear album"). */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  let userId: string;
  try {
    userId = await getRequiredUserId();
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { name } = await params;
  if (!SegmentSchema.safeParse(name).success) return badSegment();
  const existing = await getAlbumStore().list(userId, name);
  await getAlbumStore().set(userId, name, []);
  recordAudit({
    userId,
    action: 'album.delete',
    targetType: 'album',
    targetId: name,
    before: { item_count: existing.length },
  });
  return NextResponse.json({ ok: true, cleared: existing.length });
}
