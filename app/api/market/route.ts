import 'server-only';
import { NextResponse } from 'next/server';
import { safeValidateManifest } from '@/lib/widgets/ir';
import { safeFetch } from '@/lib/widgets/safe-fetch';
import { buildUpstreamAuth, verifyCallerSignature } from '@/lib/widgets/market-auth';

/**
 * Curated remote gallery. Reads from `public/market/registry.json` by default;
 * can be overridden with `MARKET_REGISTRY_URL` (a single remote JSON the same
 * shape). The remote URL is fetched via the SSRF-guarded `safeFetch` and parsed
 * items are validated against the IR schema — invalid entries are dropped.
 *
 * Optional auth for a *private* upstream registry (ARCHITECTURE.md Still-to-do
 * #2 — OAuth-style gallery auth). Either env var being set flips the route
 * from anonymous to authenticated; both being unset preserves the pre-existing
 * anonymous behaviour for backward compatibility.
 *
 *   (A) `MARKET_REGISTRY_TOKEN` — Bearer token, sent as
 *         `Authorization: Bearer <token>` on the upstream request. Simplest
 *         path for "private GitHub raw / S3-with-CloudFront-OAI / etc."
 *
 *   (B) `MARKET_REGISTRY_HMAC_KEY` — request signing. The canonical message
 *       `METHOD\nURL\nTS` is HMAC-SHA256-signed with this key; `ts` and `sig`
 *       are appended as `ts` / `sig` query params on the upstream URL so the
 *       server side can replay-validate within a 5-minute window (a stolen
 *       signature is useless after that). The signed URL is also returned to
 *       the admin Market UI as `signedUrl` for audit / debugging.
 *
 * Upstream auth failures (401/403) are surfaced to the caller as-is, with a
 * short, non-leaky message; a `WWW-Authenticate`-style hint is omitted on
 * purpose so we don't echo upstream headers verbatim.
 *
 * Public (not in the middleware matcher): the gallery is content, not per-user.
 */
export const dynamic = 'force-dynamic';

interface Registry {
  items: { manifest: unknown; category?: string; author?: string; icon?: string }[];
}

async function loadRegistry(remote: string): Promise<Registry> {
  const auth = buildUpstreamAuth(remote);
  const target = auth.signedUrl ?? remote;
  const r = await safeFetch(target, {
    headers: auth.headers,
    timeoutMs: 4000,
    maxBytes: 1_000_000,
  });
  if (r.ok) {
    try {
      return JSON.parse(r.bytes.toString('utf8'));
    } catch {
      /* fall through to bundled fallback below */
    }
  } else if (r.status === 401 || r.status === 403) {
    // Bubble the upstream auth failure up so the caller sees a useful code.
    // Don't leak the body — could include realm / Www-Authenticate hints we
    // don't want reflected.
    const e = new Error(`upstream rejected credentials (${r.status})`) as Error & { status?: number };
    e.status = r.status;
    throw e;
  }

  // Bundled curated registry. Use a direct fs read so we don't pay the cost of
  // sending a self-request through Next.
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const file = path.join(process.cwd(), 'public', 'market', 'registry.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { items: [] };
  }
}

export async function GET(req: Request) {
  // (Optional) verify caller signature before going to the upstream. No-op
  // when auth env is not set so this stays backwards-compatible.
  const callerErr = verifyCallerSignature(req);
  if (callerErr) return callerErr;

  const remote = process.env.MARKET_REGISTRY_URL;
  const auth = remote ? buildUpstreamAuth(remote) : { mode: 'anonymous' as const, headers: {} as Record<string, string> };

  let reg: Registry;
  try {
    reg = remote ? await loadRegistry(remote) : await loadRegistryBundled();
  } catch (e: any) {
    const status = (e && typeof e.status === 'number') ? e.status : 502;
    return NextResponse.json(
      { error: e?.message || 'failed to load registry', auth: auth.mode },
      { status },
    );
  }

  const items: { manifest: unknown; version?: string; category?: string; author?: string; icon?: string }[] = [];
  for (const e of reg.items ?? []) {
    const r = safeValidateManifest(e.manifest);
    if (r.success) {
      const { version, ...rest } = r.data;
      items.push({
        manifest: { ...rest, ...(version ? { version } : {}) },
        version,
        category: e.category,
        author: e.author,
        icon: e.icon,
      });
    }
  }
  return NextResponse.json({
    items,
    source: remote ? 'remote' : 'bundled',
    auth: auth.mode,
    // Echo the signed URL (if any) so the admin Market UI can show it as a
    // "copy signed URL" affordance for audit / debugging. Server-only field.
    ...(auth.signedUrl ? { signedUrl: auth.signedUrl } : {}),
  });
}

async function loadRegistryBundled(): Promise<Registry> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const file = path.join(process.cwd(), 'public', 'market', 'registry.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { items: [] };
  }
}