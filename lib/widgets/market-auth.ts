import 'server-only';
/**
 * Server-only auth builder for the market gallery upstream
 * (`MARKET_REGISTRY_URL`). Two optional modes (ARCHITECTURE.md
 * Still-to-do #2 — OAuth-style gallery auth):
 *
 *   (A) Bearer token — `MARKET_REGISTRY_TOKEN` sent as
 *       `Authorization: Bearer <token>` on the upstream request. Simplest path
 *       for "private GitHub raw / S3-with-CloudFront-OAI / etc."
 *
 *   (B) HMAC-signed request — `MARKET_REGISTRY_HMAC_KEY` signs a canonical
 *       `METHOD\nURL\nTS` message; `ts` and `sig` are appended as query params
 *       on the upstream URL so a transparent CDN/proxy in front of the private
 *       gallery sees the same auth surface as a signed URL. The upstream
 *       re-computes the same HMAC under a shared secret and rejects if (a) the
 *       signature doesn't match, or (b) `ts` is more than 5 minutes off — i.e.
 *       the request is replay-resistant (a stolen signature is useless after
 *       the window).
 *
 * Both env vars being unset preserves the pre-existing anonymous behaviour for
 * backward compatibility (the bundled `public/market/registry.json` works
 * either way). Both being set prefers Bearer (deterministic precedence).
 *
 * Extracted from `app/api/market/route.ts` so the auth surface is unit-testable
 * without pulling in Next.js + `server-only` from the route file.
 */
import { signQuery, verifyQuery, isFreshTimestamp } from './sign';

export interface UpstreamAuth {
  /** Outgoing headers to attach to the upstream request. */
  headers: Record<string, string>;
  /** Mode label echoed back to the client for the UI to render a lock icon. */
  mode: 'anonymous' | 'bearer' | 'hmac';
  /** The final URL we fetched (HMAC mode mutates it with `?ts=…&sig=…`). */
  signedUrl?: string;
}

/**
 * Build the headers + (in HMAC mode) the signed URL we use to talk to the
 * private upstream. Pure given the env (`MARKET_REGISTRY_URL` + the two auth
 * envs); `now` is injectable so unit tests are deterministic.
 */
export function buildUpstreamAuth(remoteUrl: string, now = Date.now()): UpstreamAuth {
  const token = process.env.MARKET_REGISTRY_TOKEN;
  const hmacKey = process.env.MARKET_REGISTRY_HMAC_KEY;

  if (token) {
    return { mode: 'bearer', headers: { Authorization: `Bearer ${token}` } };
  }
  if (hmacKey) {
    const ts = now;
    const sig = signQuery({ method: 'GET', url: remoteUrl, ts }, hmacKey);
    // ts + sig are query params (NOT headers) so a transparent CDN/proxy in
    // front of the private gallery sees the same auth surface as a signed URL.
    const u = new URL(remoteUrl);
    u.searchParams.set('ts', String(ts));
    u.searchParams.set('sig', sig);
    return { mode: 'hmac', headers: {}, signedUrl: u.toString() };
  }
  return { mode: 'anonymous', headers: {} };
}

/**
 * Server-side replay check for *caller* requests to `/api/market`. When the
 * HMAC env is set, callers (the admin Market UI, signed refresh scripts, etc.)
 * must include `?ts=…&sig=…`; we accept only if the signature matches under
 * the same key AND the timestamp is fresh. Returns `null` when caller-side
 * signing isn't required (no env / anonymous mode), and a `NextResponse` 401
 * when the caller's signature is missing, expired, or wrong.
 *
 * NOTE: caller-side verification is advisory. The authoritative verification
 * happens when *we* talk to the upstream — this is purely a shortcut to keep
 * replayed client requests from racing the upstream.
 */
export function verifyCallerSignature(req: Request): Response | null {
  const hmacKey = process.env.MARKET_REGISTRY_HMAC_KEY;
  if (!hmacKey) return null;

  const u = new URL(req.url);
  const tsStr = u.searchParams.get('ts');
  const sig = u.searchParams.get('sig');
  const ts = tsStr ? Number(tsStr) : NaN;

  if (!sig || !isFreshTimestamp(ts)) {
    return Response.json(
      { error: 'signed request expired or missing — refresh the market page' },
      { status: 401 },
    );
  }
  // Re-canonicalize without our own ts/sig so the same canonical message we
  // expect the upstream to validate (method + base url) is what we check.
  const base = new URL(req.url);
  base.searchParams.delete('ts');
  base.searchParams.delete('sig');
  if (!verifyQuery({ method: req.method || 'GET', url: base.toString(), ts }, sig, hmacKey)) {
    return Response.json({ error: 'bad signature' }, { status: 401 });
  }
  return null;
}