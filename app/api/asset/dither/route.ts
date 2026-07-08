import { NextRequest } from 'next/server';
import { safeFetch } from '@/lib/widgets/safe-fetch';
import { dither, encodeGrayPng } from '@/lib/widgets/dither';
import { verifyValue } from '@/lib/widgets/sign';

/**
 * Image dithering proxy for the e-ink display. Fetches a photo (SSRF-guarded),
 * decodes + grayscales + resizes it, error-diffusion dithers to 1-bit, and
 * returns a PNG. Decode needs `sharp`; if it isn't installed the route degrades
 * gracefully by redirecting to the original image.
 *
 * Public (the e-ink display has no session). Guards: https-only via safeFetch,
 * size + dimension caps, image content-type only. NOTE: this is an image proxy —
 * before production, add an egress allowlist / signed src to prevent abuse.
 */
export const dynamic = 'force-dynamic';

async function loadSharp(): Promise<any | null> {
  try {
    // Non-literal specifier so the bundler treats sharp as an optional runtime
    // dependency (no build failure when it isn't installed).
    const name = 'sharp';
    const mod: any = await import(name);
    return mod.default ?? mod;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const src = req.nextUrl.searchParams.get('src') || '';
  const style = req.nextUrl.searchParams.get('style') === 'floyd' ? 'floyd' : 'atkinson';
  const maxW = Math.min(1200, Math.max(64, Number(req.nextUrl.searchParams.get('w')) || 480));

  if (!/^https?:\/\//.test(src)) return new Response('bad src', { status: 400 });
  // Only serve URLs the Source layer signed — prevents use as an open proxy.
  if (!verifyValue(src, req.nextUrl.searchParams.get('sig'))) return new Response('bad signature', { status: 403 });

  // Self-host disk cache. Keyed on (src, style, w). Vercel's FS is ephemeral
  // and read-only outside /tmp, so this is a no-op there; on a self-host box
  // it cuts CPU/IO when the same photo is served to many refreshes.
  const cacheKey = `${Buffer.from(src).toString('base64url')}.${style}.${maxW}.png`;
  const cacheDir = 'data/asset-cache';
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const cachePath = path.join(process.cwd(), cacheDir, cacheKey);
  try {
    const hit = await fs.readFile(cachePath);
    return new Response(new Uint8Array(hit), { headers: { 'Content-Type': 'image/png', 'X-Asset-Cache': 'HIT' } });
  } catch {
    /* miss */
  }

  const sharp = await loadSharp();
  if (!sharp) return Response.redirect(src, 302);

  const r = await safeFetch(src, { maxBytes: 8_000_000, timeoutMs: 8000 });
  if (!r.ok || !r.contentType.startsWith('image/')) return Response.redirect(src, 302);

  try {
    const { data, info } = await sharp(r.bytes)
      .rotate()
      .grayscale()
      .resize(maxW, maxW, { fit: 'inside', withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const out = dither(style, new Uint8Array(data), info.width, info.height);
    const png = encodeGrayPng(out, info.width, info.height);
    // Best-effort write — never fails the response.
    fs.mkdir(path.join(process.cwd(), cacheDir), { recursive: true })
      .then(() => fs.writeFile(cachePath, png))
      .catch(() => {});
    return new Response(new Uint8Array(png), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, immutable' },
    });
  } catch {
    return Response.redirect(src, 302);
  }
}
