import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildUpstreamAuth, verifyCallerSignature } from '../market-auth';
import { signQuery, verifyQuery, isFreshTimestamp } from '../sign';

// `buildUpstreamAuth` is the pure auth builder used by `/api/market`. We test
// it directly here (rather than spinning up a fetch mock) because it captures
// the entire decision surface: which mode is active, what headers go out, and
// whether the URL was mutated with `ts`/`sig`. The actual HTTP fetch is the
// SSRF-guarded `safeFetch`, which has its own test suite.
describe('market auth — buildUpstreamAuth', () => {
  const UPSTREAM_URL = 'https://gallery.example.com/registry.json';
  const TOKEN = 'bearer-token-xyz';
  const HMAC = 'hmac-shared-secret-abc';
  const FIXED_NOW = 1_700_000_000_000;

  beforeEach(() => {
    delete process.env.MARKET_REGISTRY_TOKEN;
    delete process.env.MARKET_REGISTRY_HMAC_KEY;
  });
  afterEach(() => {
    delete process.env.MARKET_REGISTRY_TOKEN;
    delete process.env.MARKET_REGISTRY_HMAC_KEY;
  });

  // 1. No env → anonymous (backward-compat with pre-auth behaviour).
  it('returns anonymous when neither env var is set', () => {
    const a = buildUpstreamAuth(UPSTREAM_URL, FIXED_NOW);
    expect(a.mode).toBe('anonymous');
    expect(a.headers).toEqual({});
    expect(a.signedUrl).toBeUndefined();
  });

  // 2. Bearer token adds the Authorization header, mutates no URL.
  it('attaches a Bearer Authorization header when MARKET_REGISTRY_TOKEN is set', () => {
    process.env.MARKET_REGISTRY_TOKEN = TOKEN;
    const a = buildUpstreamAuth(UPSTREAM_URL, FIXED_NOW);
    expect(a.mode).toBe('bearer');
    expect(a.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(a.signedUrl).toBeUndefined();
  });

  // 3. HMAC mode round-trips: signed URL is verifiable + freshness is enforced.
  it('produces a verifiable HMAC-signed URL when MARKET_REGISTRY_HMAC_KEY is set', () => {
    process.env.MARKET_REGISTRY_HMAC_KEY = HMAC;
    const a = buildUpstreamAuth(UPSTREAM_URL, FIXED_NOW);
    expect(a.mode).toBe('hmac');
    expect(a.headers).toEqual({});
    expect(a.signedUrl).toBeDefined();

    const signed = new URL(a.signedUrl!);
    const ts = Number(signed.searchParams.get('ts'));
    const sig = signed.searchParams.get('sig');
    expect(ts).toBe(FIXED_NOW);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);

    // The exact same canonical message must verify under the same key.
    expect(verifyQuery({ method: 'GET', url: UPSTREAM_URL, ts: FIXED_NOW }, sig, HMAC)).toBe(true);
    // And tampering with the URL invalidates the signature.
    expect(verifyQuery({ method: 'GET', url: UPSTREAM_URL + '?evil=1', ts: FIXED_NOW }, sig, HMAC)).toBe(false);
  });

  // 4. Expired timestamps get rejected by the freshness window.
  it('rejects expired timestamps in the freshness window check', () => {
    // We can't easily simulate a stale client request here (that's caller-side),
    // but we can assert the building + verifying halves: an old ts signed now
    // should verify (sig is still valid), but the freshness check must reject it.
    process.env.MARKET_REGISTRY_HMAC_KEY = HMAC;
    const oldTs = Date.now() - 10 * 60 * 1000; // 10 min ago, past 5-min window
    const sig = signQuery({ method: 'GET', url: UPSTREAM_URL, ts: oldTs }, HMAC);
    expect(verifyQuery({ method: 'GET', url: UPSTREAM_URL, ts: oldTs }, sig, HMAC)).toBe(true);
    expect(isFreshTimestamp(oldTs)).toBe(false);
    // …but a fresh one passes both checks.
    const freshTs = Date.now();
    const freshSig = signQuery({ method: 'GET', url: UPSTREAM_URL, ts: freshTs }, HMAC);
    expect(isFreshTimestamp(freshTs)).toBe(true);
    expect(verifyQuery({ method: 'GET', url: UPSTREAM_URL, ts: freshTs }, freshSig, HMAC)).toBe(true);
  });

  // 5. Both env vars set → bearer wins (deterministic precedence).
  it('prefers Bearer over HMAC when both env vars are set', () => {
    process.env.MARKET_REGISTRY_TOKEN = TOKEN;
    process.env.MARKET_REGISTRY_HMAC_KEY = HMAC;
    const a = buildUpstreamAuth(UPSTREAM_URL, FIXED_NOW);
    expect(a.mode).toBe('bearer');
    expect(a.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(a.signedUrl).toBeUndefined();
  });
});

describe('market auth — verifyCallerSignature', () => {
  const UPSTREAM_URL = 'https://gallery.example.com/registry.json';
  const HMAC = 'hmac-shared-secret-abc';
  const FIXED_TS = 1_700_000_000_000;

  beforeEach(() => {
    delete process.env.MARKET_REGISTRY_TOKEN;
    delete process.env.MARKET_REGISTRY_HMAC_KEY;
  });
  afterEach(() => {
    delete process.env.MARKET_REGISTRY_TOKEN;
    delete process.env.MARKET_REGISTRY_HMAC_KEY;
  });

  function req(url: string): Request {
    // Minimal Request stub — only `url` + `method` are read by verifyCallerSignature.
    return new Request(url, { method: 'GET' });
  }

  it('returns null (no-op) when HMAC env is not set', () => {
    expect(verifyCallerSignature(req(`${UPSTREAM_URL}?anything=1`))).toBeNull();
  });

  it('accepts a fresh + valid caller signature', () => {
    process.env.MARKET_REGISTRY_HMAC_KEY = HMAC;
    // Fresh ts (now).
    const ts = Date.now();
    const sig = signQuery({ method: 'GET', url: UPSTREAM_URL, ts }, HMAC);
    const u = `${UPSTREAM_URL}?ts=${ts}&sig=${sig}`;
    expect(verifyCallerSignature(req(u))).toBeNull();
  });

  it('rejects an expired caller signature (ts older than 5 min)', () => {
    process.env.MARKET_REGISTRY_HMAC_KEY = HMAC;
    const oldTs = Date.now() - 10 * 60 * 1000; // 10 min ago
    // Signature is technically still cryptographically valid, but the freshness
    // check must reject it to prevent replay.
    const sig = signQuery({ method: 'GET', url: UPSTREAM_URL, ts: oldTs }, HMAC);
    const u = `${UPSTREAM_URL}?ts=${oldTs}&sig=${sig}`;
    const res = verifyCallerSignature(req(u));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('rejects a missing signature', () => {
    process.env.MARKET_REGISTRY_HMAC_KEY = HMAC;
    const res = verifyCallerSignature(req(`${UPSTREAM_URL}?ts=${Date.now()}`));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('rejects a wrong signature (HMAC mismatch)', () => {
    process.env.MARKET_REGISTRY_HMAC_KEY = HMAC;
    const ts = Date.now();
    // Sign with a *different* key — verifier must say no.
    const sig = signQuery({ method: 'GET', url: UPSTREAM_URL, ts }, 'wrong-key');
    const res = verifyCallerSignature(req(`${UPSTREAM_URL}?ts=${ts}&sig=${sig}`));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it('rejects when ts is missing entirely', () => {
    process.env.MARKET_REGISTRY_HMAC_KEY = HMAC;
    const sig = signQuery({ method: 'GET', url: UPSTREAM_URL, ts: FIXED_TS }, HMAC);
    const res = verifyCallerSignature(req(`${UPSTREAM_URL}?sig=${sig}`));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });
});