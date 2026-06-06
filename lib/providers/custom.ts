import type { Provider, ProviderType } from '../db';
import type { UsageSnapshot, UsageMetric } from './types';
import { resolvePath } from '../utils';

/**
 * Custom provider — user configures everything.
 *
 *   base_url  e.g. https://api.minimaxi.com
 *   endpoint  e.g. /v1/usage  (or /v1/account/usage)
 *   json_path e.g. data.used_tokens   -> used
 *             we accept up to 3 paths joined by `|`
 *             field 1 = used, 2 = limit, 3 = reset (epoch seconds or ms)
 *
 * Auth: the API key is sent as `Authorization: Bearer <key>` by default.
 * If the user wants a different header, they can put `<header>:placeholder` in
 * `endpoint` — but the common case is fine with bearer.
 */
export async function fetchCustomUsage(p: Provider, apiKey: string): Promise<UsageSnapshot> {
  const base = (p.base_url || '').replace(/\/$/, '');
  const ep = p.endpoint || '';
  if (!base) {
    return {
      ok: false,
      error: 'Custom provider missing base_url',
      metrics: [],
      fetchedAt: Date.now(),
    };
  }

  const url = ep.startsWith('http') ? ep : `${base}${ep.startsWith('/') ? '' : '/'}${ep}`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return {
        ok: false,
        error: `${res.status}: ${errText.slice(0, 200)}`,
        metrics: [],
        fetchedAt: Date.now(),
      };
    }

    const json: any = await res.json();
    const paths = (p.json_path || '').split('|').map((s) => s.trim());
    const usedPath = paths[0];
    const limitPath = paths[1];
    const resetPath = paths[2];

    const used = numOrUndef(resolvePath(json, usedPath));
    const limit = numOrUndef(resolvePath(json, limitPath));
    const rawReset = resetPath ? resolvePath(json, resetPath) : null;
    const resetAt = toEpoch(rawReset);

    const metrics: UsageMetric[] = [
      {
        label: p.name,
        used: used ?? 0,
        limit: limit ?? null,
        unit: 'units',
        resetAt,
        window: 'window',
      },
    ];

    return { ok: true, metrics, raw: json, fetchedAt: Date.now() };
  } catch (e: any) {
    return {
      ok: false,
      error: `Custom request failed: ${e?.message || String(e)}`,
      metrics: [],
      fetchedAt: Date.now(),
    };
  }
}

function numOrUndef(v: any): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function toEpoch(v: any): number | null {
  if (v == null) return null;
  if (typeof v === 'number') {
    return v < 1e11 ? v * 1000 : v;
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
    const n = Number(v);
    if (Number.isFinite(n)) return n < 1e11 ? n * 1000 : n;
  }
  return null;
}

export const customProvider = {
  type: 'custom' as ProviderType,
  label: 'Custom (any API)',
  fetch: fetchCustomUsage,
};
