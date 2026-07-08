/**
 * HMAC signing for proxy URLs. `/api/asset/dither` is an image proxy; without a
 * signature it's an open SSRF-adjacent relay. The Source layer mints signed
 * URLs and the route refuses anything it didn't sign, so the proxy only ever
 * fetches URLs the platform itself produced.
 *
 * Also used by `/api/market` to sign requests to a private gallery: the same
 * primitive (HMAC-SHA256 over a canonical message) lets us prove the request
 * came from us within a 5-minute window — i.e. replay-resistant.
 *
 * Keyed by ENCRYPTION_KEY (server env). Pure given the env, so it's unit-tested.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

// Fail-fast in production: signing/verification keys must come from a real
// server secret. The 'dev-insecure-key' fallback exists for local development
// only — silently using it in production would let anyone forge URL sigs.
if (process.env.NODE_ENV === 'production' && !process.env.ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY is required in production');
}

function signingKey(): string {
  return process.env.ENCRYPTION_KEY || 'dev-insecure-key';
}

export function signValue(value: string): string {
  return createHmac('sha256', signingKey()).update(value).digest('hex').slice(0, 32);
}

export function verifyValue(value: string, sig: string | null | undefined): boolean {
  if (!sig) return false;
  const expected = signValue(value);
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

// --- Query/request signing (HMAC over method + url + ts) ---------------------
//
// Used by `/api/market` to authenticate requests to a private `MARKET_REGISTRY_URL`.
// Canonical message is `${method.toUpperCase()}\n${url}\n${ts}` — uppercase method
// so the two sides don't accidentally normalize differently. Caller passes the
// key explicitly (e.g. `process.env.MARKET_REGISTRY_HMAC_KEY`); defaults to the
// shared `signingKey()` so the helper stays unit-testable without env rigging.

export interface QuerySignatureParts {
  method: string;
  url: string;
  ts: number;
}

function canonicalMessage(parts: QuerySignatureParts): string {
  return `${parts.method.toUpperCase()}\n${parts.url}\n${parts.ts}`;
}

/** HMAC-SHA256 hex over the canonical (method, url, ts) message. */
export function signQuery(parts: QuerySignatureParts, key?: string): string {
  const k = key ?? signingKey();
  return createHmac('sha256', k).update(canonicalMessage(parts)).digest('hex');
}

/** Constant-time verification of a query signature under `key`. */
export function verifyQuery(parts: QuerySignatureParts, sig: string | null | undefined, key?: string): boolean {
  if (!sig) return false;
  const expected = signQuery(parts, key);
  if (sig.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** True if `ts` (ms) is within ±`windowMs` of `Date.now()`. Default 5 minutes. */
export function isFreshTimestamp(ts: number | null | undefined, windowMs = 300_000): boolean {
  if (ts == null || !Number.isFinite(ts)) return false;
  const now = Date.now();
  return Math.abs(now - ts) <= windowMs;
}