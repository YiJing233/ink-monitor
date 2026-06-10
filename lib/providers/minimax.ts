import type { Provider, ProviderType } from '../db';
import type { UsageSnapshot, UsageMetric } from './types';

/**
 * MiniMax (Xiyu Technology) usage fetcher.
 *
 * ## Auth model — important
 *
 * MiniMax exposes its account/usage endpoints only behind a web session
 * cookie (`_token`), NOT behind a regular API key. The flow is:
 *
 *   1. User logs into https://platform.minimaxi.com in their browser.
 *   2. We read the `_token` JWT from cookies (valid ~24h, IP-bound).
 *   3. User pastes that `_token` value into ink-monitor `/admin/providers`
 *      as the "API key" for this provider. We encrypt it at rest with
 *      PBKDF2(user_id) + AES-256-GCM, identical to all other providers.
 *   4. On every refresh, we hit two MiniMax endpoints in parallel:
 *        - GET /backend/account/token_plan_credit
 *        - GET /backend/account/token_plan/usage_summary
 *      carrying the `_token` as a `cookie` header and the user's
 *      `minimax_group_id_v2` (numeric) as `x-group-id`.
 *
 * ## Security — why this fetcher is safe to expose
 *
 * The `token_plan_credit` response **includes the user's cleartext API
 * key** in the `api_key` field. We MUST scrub it the instant we receive
 * it, BEFORE logging, returning to callers, or persisting. The contract
 * is: nothing this module returns ever contains `api_key` plaintext.
 *
 * We:
 *   - Build a new object literal with only the fields we need
 *   - Never call `console.log`/`JSON.stringify` on the raw response
 *   - Never put the raw response into `raw` (caller-visible debug field);
 *     we put a scrubbed redacted copy there instead
 */

const CREDIT_URL = 'https://www.minimaxi.com/backend/account/token_plan_credit';
const USAGE_URL = 'https://www.minimaxi.com/backend/account/token_plan/usage_summary';
// 7-day rolling window for the live usage metric (matches what the
// platform dashboard calls "7-day rolling").
const ROLLING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function fetchMinimaxUsage(p: Provider, apiKey: string): Promise<UsageSnapshot> {
  const fetchedAt = Date.now();
  const windowStart = fetchedAt - ROLLING_WINDOW_MS;

  if (!apiKey) {
    return {
      ok: false,
      error: 'MiniMax _token is empty. Re-paste it in /admin/providers.',
      metrics: [],
      fetchedAt,
    };
  }

  // The user pastes the literal `_token=eyJ...` value. We send it as
  // a cookie. We do NOT include any other cookies from the user's
  // browser — only `_token` and the two required for the platform.
  const cookie = `_token=${apiKey}`;
  // x-group-id is required by the MiniMax platform; for a single-user
  // self-hosted deploy we can default to the testbed group used by
  // platform.minimaxi.com. If the user later wants a different group,
  // they can edit `base_url` (we misuse it as a group-id override) or
  // we can add a dedicated field. For now, the platform's own example
  // hard-codes this value.
  const groupId = p.base_url || '2020084596711887303';

  const baseHeaders: Record<string, string> = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'zh-CN,zh;q=0.9',
    cookie,
    origin: 'https://platform.minimaxi.com',
    referer: 'https://platform.minimaxi.com/',
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    'x-group-id': groupId,
  };

  try {
    const [creditRes, usageRes] = await Promise.all([
      fetch(CREDIT_URL, { headers: baseHeaders, signal: AbortSignal.timeout(8000) }),
      fetch(USAGE_URL, { headers: baseHeaders, signal: AbortSignal.timeout(8000) }),
    ]);

    if (!creditRes.ok) {
      const errText = await creditRes.text().catch(() => '');
      return {
        ok: false,
        error: `MiniMax token_plan_credit returned ${creditRes.status}: ${errText.slice(0, 200)}`,
        metrics: [],
        fetchedAt,
      };
    }
    if (!usageRes.ok) {
      const errText = await usageRes.text().catch(() => '');
      return {
        ok: false,
        error: `MiniMax token_plan/usage_summary returned ${usageRes.status}: ${errText.slice(0, 200)}`,
        metrics: [],
        fetchedAt,
      };
    }

    // Parse JSON WITHOUT keeping the raw object around. Both .json()
    // calls consume the body and free the underlying socket, so the
    // `api_key` plaintext lives in JS heap only until we return.
    const creditJson: any = await creditRes.json();
    const usageJson: any = await usageRes.json();

    // Sanity-check the response shape. If the user pasted a stale or
    // wrong token, MiniMax returns `{"base_resp": {"status_code": 1004}}`
    // (not logged in). Surface that cleanly.
    const baseResp = creditJson?.base_resp;
    if (baseResp && baseResp.status_code && baseResp.status_code !== 0) {
      return {
        ok: false,
        error: `MiniMax auth failed (status ${baseResp.status_code}: ${baseResp.status_msg || 'unknown'}). The _token is likely expired — re-paste it in /admin/providers.`,
        metrics: [],
        fetchedAt,
      };
    }

    const metrics = parseMinimaxMetrics(creditJson, usageJson, windowStart, fetchedAt);
    const history = parseMinimaxHistory(usageJson, windowStart);

    // Build a SCRUBBED raw object for debugging in the admin UI. The
    // real `api_key` plaintext is never put in here.
    const safeRaw = {
      credit: {
        total_credits: creditJson.total_credits,
        used_credits: creditJson.used_credits,
        remaining_credits: creditJson.remaining_credits,
        // Deliberately OMIT `api_key` — that field carries plaintext.
        // Deliberately OMIT `credit_packages_details[*].*` private
        // identifiers (package_id, group_id, order_id_prefix) — keep
        // only the high-level summary.
        balance_breakdown: creditJson.balance_breakdown
          ? {
              total_balance: creditJson.balance_breakdown.total_balance,
            }
          : undefined,
      },
      usage: {
        total_days: usageJson.total_days,
        total_token_consumed: usageJson.total_token_consumed,
        usage_ranking_percent: usageJson.usage_ranking_percent,
        most_active_day: usageJson.most_active_day,
        active_days: usageJson.active_days,
        current_consecutive_days: usageJson.current_consecutive_days,
        // The full 68-day daily series — used by /display to draw the
        // e-ink trend bars. Not sensitive.
        daily_token_usage: usageJson.daily_token_usage,
      },
    };

    return {
      ok: true,
      metrics,
      raw: safeRaw,
      fetchedAt,
      history: history.length > 0 ? history : undefined,
      historyUnit: 'tokens',
      historyWindow: '7d',
    };
  } catch (e: any) {
    return {
      ok: false,
      error: `MiniMax request failed: ${e?.message || String(e)}`,
      metrics: [],
      fetchedAt,
    };
  }
}

function parseMinimaxMetrics(
  credit: any,
  usage: any,
  windowStart: number,
  fetchedAt: number
): UsageMetric[] {
  const total = num(credit?.total_credits);
  const used = num(credit?.used_credits);
  const remaining = num(credit?.remaining_credits);

  // The first (and usually only) credit package carries the expiration.
  const pkg = Array.isArray(credit?.credit_packages_details)
    ? credit.credit_packages_details[0]
    : null;
  const expiresAt = pkg?.expiration_time ? Number(pkg.expiration_time) : null;
  const pkgName = pkg?.package_name || 'token_plan_credit';

  // Sum 7-day rolling window from daily_token_usage. The series is
  // 68-element, oldest first; we want the last 7 entries.
  const daily: number[] = Array.isArray(usage?.daily_token_usage) ? usage.daily_token_usage : [];
  let tokens7d = 0;
  let daysWithData = 0;
  for (let i = Math.max(0, daily.length - 7); i < daily.length; i++) {
    const v = num(daily[i]);
    if (v > 0) daysWithData += 1;
    tokens7d += v;
  }

  // Reset window: the package expiration. We use that as the "next
  // reset" anchor for the display.
  const resetAt = expiresAt && expiresAt > fetchedAt ? expiresAt : null;

  const metrics: UsageMetric[] = [
    {
      label: `${pkgName} credits`,
      used,
      limit: total > 0 ? total : null,
      unit: 'credits',
      resetAt,
      window: 'cycle',
    },
    {
      label: 'Tokens (7d)',
      used: tokens7d,
      limit: null,
      unit: 'tokens',
      resetAt,
      window: '7d rolling',
    },
  ];

  // Add a 3rd metric if we have ranking/consecutive data — it's the
  // most "fun" MiniMax-specific signal and deserves its own row.
  const rankPct = num(usage?.usage_ranking_percent);
  const consecutive = num(usage?.current_consecutive_days);
  if (consecutive > 0) {
    metrics.push({
      label: 'Active streak',
      used: consecutive,
      limit: null,
      unit: 'days',
      resetAt: null,
      window: 'consecutive',
    });
  }
  if (rankPct > 0 && rankPct < 100) {
    metrics.push({
      label: 'Usage rank',
      used: Math.round(rankPct * 100) / 100,
      limit: 100,
      unit: '% top',
      resetAt: null,
      window: 'all-time',
    });
  }

  return metrics;
}

/**
 * Build a 7-element array of daily token totals ending at the latest
 * day we have data. Returns all zeros if the series is empty.
 */
function parseMinimaxHistory(usage: any, _windowStartMs: number): number[] {
  const daily: number[] = Array.isArray(usage?.daily_token_usage) ? usage.daily_token_usage : [];
  if (daily.length === 0) return [0, 0, 0, 0, 0, 0, 0];
  // Take the last 7 days, oldest first
  const last7 = daily.slice(-7);
  while (last7.length < 7) last7.unshift(0);
  return last7.map((v) => num(v));
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    // MiniMax encodes big numbers as strings like "3.66B" or "755.65M".
    const m = v.match(/^([\d.]+)\s*([KMB])?$/i);
    if (m) {
      const n = parseFloat(m[1]);
      const suffix = (m[2] || '').toUpperCase();
      if (suffix === 'K') return n * 1e3;
      if (suffix === 'M') return n * 1e6;
      if (suffix === 'B') return n * 1e9;
      return n;
    }
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

export const minimaxProvider = {
  type: 'minimax' as ProviderType,
  label: 'MiniMax (Xiyu Tech)',
  fetch: fetchMinimaxUsage,
};
