/**
 * SSRF-hardened server-side fetch for declarative `http` widget sources.
 *
 * The existing `custom` provider does an unguarded fetch to a user-supplied URL.
 * Before exposing that to every user as a widget, we must stop requests to
 * internal/cloud-metadata addresses and (optionally) confine egress to the hosts
 * a manifest declared in `capabilities.egress`.
 *
 * `ipIsBlocked` / `hostAllowed` are pure and unit-tested; `safeFetch` adds DNS
 * resolution, manual redirect re-validation, a timeout, and a byte cap.
 *
 * DNS-rebinding defense (F4):
 * `dns.lookup` runs in user space and returns a snapshot. The actual `fetch`
 * triggers a second, independent resolver call in undici / libuv — and an
 * attacker controlling the authoritative DNS for a host can return a public
 * IP on the first lookup (passing our IP block-list) and a private/metadata
 * IP on the second (e.g. 127.0.0.1, 169.254.169.254) to bypass SSRF.
 *
 * The bullet-proof fix is to pin the TCP connection to the IP we validated
 * (undici Agent with `connect.hostname = resolvedIp, connect.servername =
 * hostname`, or `https.request({ lookup })`). Without a custom dispatcher
 * dependency we can't pin, so we layer two best-effort defenses instead:
 *
 *   1. Re-resolve the hostname immediately before `fetch` and reject if the
 *      new answer set contains a blocked address. This narrows the TOCTOU
 *      window — the attacker has to flip DNS between two synchronous calls
 *      in the same tick — and is cheap. It does NOT eliminate the race; the
 *      final fix is to deploy with a dispatcher that pins the connection.
 *
 *   2. After `fetch`, compare `response.url` to the request URL host. We
 *      pass `redirect: 'manual'` so the response URL should always equal
 *      the request URL; a mismatch would mean the request was silently
 *      redirected to a different host (or that something inside `fetch`
 *      resolved to a different host than we validated), and we reject it
 *      as a likely rebind.
 *
 * Manual-redirect handling already re-runs the IP block-list on every hop.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

/** True if an IP is private/reserved/loopback/link-local (incl. 169.254.169.254). */
export function ipIsBlocked(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const o = ip.split('.').map(Number);
    if (o.length !== 4 || o.some((n) => Number.isNaN(n))) return true;
    if (o[0] === 0) return true; // "this" network
    if (o[0] === 10) return true; // private
    if (o[0] === 127) return true; // loopback
    if (o[0] === 169 && o[1] === 254) return true; // link-local + cloud metadata
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // private
    if (o[0] === 192 && o[1] === 168) return true; // private
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT
    if (o[0] >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const x = ip.toLowerCase();
    if (x === '::1' || x === '::') return true; // loopback / unspecified
    if (x.startsWith('fe80')) return true; // link-local
    if (x.startsWith('fc') || x.startsWith('fd')) return true; // unique local
    const mapped = x.match(/::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) return ipIsBlocked(mapped[1]); // IPv4-mapped
    return false;
  }
  return true; // not a valid literal IP → block
}

/** Empty/absent allowlist = allow any (public) host. Otherwise host must match. */
export function hostAllowed(host: string, allowlist?: string[]): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  const h = host.toLowerCase();
  return allowlist.some((a) => {
    const dom = a.toLowerCase();
    return h === dom || h.endsWith('.' + dom);
  });
}

export interface SafeFetchOptions {
  allowlist?: string[];
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  bytes: Buffer;
  contentType: string;
  error?: string;
}

function fail(error: string): SafeFetchResult {
  return { ok: false, status: 0, bytes: Buffer.alloc(0), contentType: '', error };
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  const maxBytes = opts.maxBytes ?? 5_000_000;
  const maxRedirects = opts.maxRedirects ?? 3;
  let url = rawUrl;
  let redirects = 0;

  for (;;) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return fail('invalid url');
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fail('scheme not allowed');
    if (!hostAllowed(u.hostname, opts.allowlist)) return fail(`host ${u.hostname} not in egress allowlist`);

    // Resolve and reject if *any* resolved address is internal (DNS-rebind safe).
    let addrs: { address: string }[];
    try {
      addrs = await dns.lookup(u.hostname, { all: true });
    } catch {
      return fail('dns resolution failed');
    }
    if (addrs.length === 0 || addrs.some((a) => ipIsBlocked(a.address))) return fail('blocked address');

    // (F4) Re-resolve right before fetch. The previous lookup ran in user
    // space; the actual TCP connect inside `fetch` triggers another,
    // independent resolver call. If the authoritative DNS flipped between
    // the two (the classic DNS-rebind TOCTOU), reject. This narrows but
    // does NOT close the window — see the file header for the pinned-
    // dispatcher upgrade path.
    let preFetchAddrs: { address: string }[];
    try {
      preFetchAddrs = await dns.lookup(u.hostname, { all: true });
    } catch {
      return fail('dns resolution failed');
    }
    if (
      preFetchAddrs.length === 0 ||
      preFetchAddrs.some((a) => ipIsBlocked(a.address)) ||
      !sameAddressSet(addrs, preFetchAddrs)
    ) {
      return fail('dns rebind detected');
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        method: opts.method || 'GET',
        headers: opts.headers,
        body: opts.body,
        redirect: 'manual',
        signal: ctrl.signal,
      });
    } catch (e: any) {
      clearTimeout(timer);
      return fail('fetch failed: ' + (e?.message || String(e)));
    }
    clearTimeout(timer);

    // (F4) Sanity check the post-fetch URL. With `redirect: 'manual'`,
    // `response.url` should equal the request URL — if the host changed
    // it means something inside `fetch` followed a redirect we didn't
    // authorize or resolved to a different host than we validated. Treat
    // that as a rebind attempt and refuse to read the body.
    try {
      const respHost = new URL(res.url).hostname;
      if (respHost !== u.hostname) return fail('dns rebind detected');
    } catch {
      return fail('invalid response url');
    }

    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      if (redirects++ >= maxRedirects) return fail('too many redirects');
      url = new URL(loc, url).toString();
      continue; // re-validate the redirect target from the top
    }

    const bytes = await readCapped(res, maxBytes);
    if (bytes === null) return fail('response exceeded size cap');
    return { ok: res.ok, status: res.status, bytes, contentType: res.headers.get('content-type') || '' };
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<Buffer | null> {
  const body = res.body;
  if (!body) {
    const ab = await res.arrayBuffer();
    return ab.byteLength > maxBytes ? null : Buffer.from(ab);
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/**
 * (F4) True if two DNS answer lists describe the same set of addresses.
 * Round-trip safe: many resolvers return the same set in a different
 * order between calls. We compare canonicalised IPv6 lower-case + the
 * raw IPv4 string.
 */
function sameAddressSet(a: { address: string }[], b: { address: string }[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (s: string) => (net.isIPv6(s) ? s.toLowerCase() : s);
  const set = new Set(a.map((x) => norm(x.address)));
  for (const y of b) if (!set.has(norm(y.address))) return false;
  return true;
}
