import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import dnsPromises from 'node:dns/promises';
import { ipIsBlocked, hostAllowed, safeFetch } from '../safe-fetch';

describe('ipIsBlocked', () => {
  it('blocks loopback / private / link-local / metadata', () => {
    expect(ipIsBlocked('127.0.0.1')).toBe(true);
    expect(ipIsBlocked('10.0.0.5')).toBe(true);
    expect(ipIsBlocked('192.168.1.1')).toBe(true);
    expect(ipIsBlocked('172.16.0.1')).toBe(true);
    expect(ipIsBlocked('172.31.255.255')).toBe(true);
    expect(ipIsBlocked('169.254.169.254')).toBe(true); // cloud metadata
    expect(ipIsBlocked('100.64.0.1')).toBe(true); // CGNAT
    expect(ipIsBlocked('0.0.0.0')).toBe(true);
    expect(ipIsBlocked('::1')).toBe(true);
    expect(ipIsBlocked('fe80::1')).toBe(true);
    expect(ipIsBlocked('fd00::1')).toBe(true);
    expect(ipIsBlocked('::ffff:127.0.0.1')).toBe(true); // IPv4-mapped loopback
  });

  it('allows public addresses', () => {
    expect(ipIsBlocked('8.8.8.8')).toBe(false);
    expect(ipIsBlocked('1.1.1.1')).toBe(false);
    expect(ipIsBlocked('172.32.0.1')).toBe(false); // just outside private range
    expect(ipIsBlocked('2606:4700:4700::1111')).toBe(false);
  });

  it('blocks garbage', () => {
    expect(ipIsBlocked('not-an-ip')).toBe(true);
    expect(ipIsBlocked('')).toBe(true);
  });
});

describe('hostAllowed', () => {
  it('allows anything when no allowlist', () => {
    expect(hostAllowed('evil.com')).toBe(true);
    expect(hostAllowed('evil.com', [])).toBe(true);
  });
  it('matches exact host and subdomains only', () => {
    expect(hostAllowed('api.openai.com', ['openai.com'])).toBe(true);
    expect(hostAllowed('openai.com', ['openai.com'])).toBe(true);
    expect(hostAllowed('openai.com.evil.com', ['openai.com'])).toBe(false);
    expect(hostAllowed('notopenai.com', ['openai.com'])).toBe(false);
  });
});

// Build a Response whose `url` getter returns the value we want. Native
// `Response` instances default `url` to the empty string (they don't
// carry a request context). Our safeFetch reads `res.url` after the call
// so we have to override the getter in tests.
function fakeResponse(
  body: string,
  opts: { status?: number; contentType?: string; url?: string; location?: string } = {},
): Response {
  const r = new Response(body, {
    status: opts.status ?? 200,
    headers: {
      ...(opts.contentType ? { 'content-type': opts.contentType } : {}),
      ...(opts.location ? { location: opts.location } : {}),
    },
  });
  if (opts.url) Object.defineProperty(r, 'url', { value: opts.url, configurable: true });
  return r;
}

// F4: DNS rebinding defense.
//
// safeFetch looks up DNS twice — once to gate the IP, once more as a
// pre-fetch re-resolution to catch the classic TOCTOU where the
// authoritative DNS flips between user-space lookup and the resolver
// call inside `fetch`. We simulate the rebind by returning a public IP
// on the first lookup and a private/metadata IP on the second.
describe('safeFetch — DNS rebinding (F4)', () => {
  beforeEach(() => {
    vi.spyOn(dnsPromises, 'lookup');
    vi.spyOn(globalThis, 'fetch');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects when the pre-fetch re-resolve returns a private IP (classic rebind)', async () => {
    // First call: attacker returns a public IP — passes the IP block-list.
    // Second call (pre-fetch): attacker flips to 127.0.0.1 — must be caught.
    vi.mocked(dnsPromises.lookup)
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as any)
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as any);
    vi.mocked(globalThis.fetch).mockResolvedValue(
      fakeResponse('should-never-be-read', { url: 'https://attacker.example/' }),
    );

    const res = await safeFetch('https://attacker.example/');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/rebind|blocked/i);
    // fetch must NOT have been called when we already detected the rebind.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects when the pre-fetch re-resolve returns the cloud-metadata IP', async () => {
    vi.mocked(dnsPromises.lookup)
      .mockResolvedValueOnce([{ address: '1.1.1.1', family: 4 }] as any)
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }] as any);
    vi.mocked(globalThis.fetch).mockResolvedValue(
      fakeResponse('ok', { url: 'https://attacker.example/' }),
    );

    const res = await safeFetch('https://attacker.example/latest/meta-data/');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/rebind|blocked/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects when the answer set changes between the two lookups (rebind with rotating public IPs)', async () => {
    // Both answers are public — but the set changed. That's the classic
    // rebind signature: attacker rotates through a pool of IPs hoping
    // one of them points at internal infrastructure.
    vi.mocked(dnsPromises.lookup)
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as any)
      .mockResolvedValueOnce([
        { address: '8.8.8.8', family: 4 },
        { address: '1.1.1.1', family: 4 },
      ] as any);
    vi.mocked(globalThis.fetch).mockResolvedValue(
      fakeResponse('ok', { url: 'https://attacker.example/' }),
    );

    const res = await safeFetch('https://attacker.example/');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/rebind/i);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects when fetch returns a response whose URL host differs from the request', async () => {
    // Stable DNS, but simulate the post-fetch URL host changing — e.g. a
    // future fetch implementation that follows a redirect despite our
    // `redirect: 'manual'`, or a libuv resolver that pinned us elsewhere.
    vi.mocked(dnsPromises.lookup)
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as any)
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as any);
    vi.mocked(globalThis.fetch).mockResolvedValue(
      fakeResponse('hi', { url: 'https://evil.example/' }),
    );

    const res = await safeFetch('https://attacker.example/');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/rebind/i);
  });

  it('accepts when both lookups agree on the same public answer set', async () => {
    vi.mocked(dnsPromises.lookup)
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as any)
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }] as any);
    vi.mocked(globalThis.fetch).mockResolvedValue(
      fakeResponse('ok', { url: 'https://api.example/', contentType: 'text/plain' }),
    );

    const res = await safeFetch('https://api.example/');
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
  });

  it('treats reordered-but-equivalent answer sets as equivalent (resolver round-trip)', async () => {
    // Many resolvers return the same set in a different order between
    // calls. Same addresses, different order → must NOT trigger rebind.
    vi.mocked(dnsPromises.lookup)
      .mockResolvedValueOnce([
        { address: '8.8.8.8', family: 4 },
        { address: '1.1.1.1', family: 4 },
      ] as any)
      .mockResolvedValueOnce([
        { address: '1.1.1.1', family: 4 },
        { address: '8.8.8.8', family: 4 },
      ] as any);
    vi.mocked(globalThis.fetch).mockResolvedValue(
      fakeResponse('ok', { url: 'https://api.example/', contentType: 'text/plain' }),
    );

    const res = await safeFetch('https://api.example/');
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });
});
