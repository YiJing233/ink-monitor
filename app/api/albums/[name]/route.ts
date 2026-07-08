import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getRequiredUserId } from '@/lib/session';
import { getAlbumStore, isUploadSupported, AlbumStoreError, type AlbumItem } from '@/lib/widgets/album-store';

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
  return NextResponse.json({ ok: true, count: items.length });
}
