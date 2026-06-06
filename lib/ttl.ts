/**
 * Pre-flight TTL guidance. For each data source, the minimum recommended
 * `refresh_seconds` is the source's known response time, plus a small
 * safety margin, plus (for paid APIs) a budget guard.
 *
 * A row whose `refresh_seconds` is below the recommended minimum wastes
 * upstream calls and may trip rate limits.
 */

export interface TtlGuidance {
  /** Provider type or stock market */
  source: string;
  /** Human label */
  label: string;
  /** Minimum sensible refresh interval in seconds */
  recommended: number;
  /** Hard floor — below this the source is virtually guaranteed to rate-limit or charge per call */
  hardMin: number;
  /** Why */
  rationale: string;
}

export const PROVIDER_TTL: Record<string, TtlGuidance> = {
  openai: {
    source: 'openai',
    label: 'OpenAI /v1/usage',
    recommended: 60,
    hardMin: 30,
    rationale: 'Aggregated hourly buckets; faster than 60s gives duplicate data.',
  },
  anthropic: {
    source: 'anthropic',
    label: 'Anthropic /v1/messages',
    recommended: 300,
    hardMin: 60,
    rationale:
      'Probe issues a real /v1/messages call costing 1 input token. Slower avoids burning your quota.',
  },
  custom: {
    source: 'custom',
    label: 'Custom API',
    recommended: 60,
    hardMin: 30,
    rationale: 'Unknown upstream — 60s is a safe default for most public APIs.',
  },
  demo: {
    source: 'demo',
    label: 'Demo',
    recommended: 15,
    hardMin: 15,
    rationale: 'Local in-process — no cost, can refresh as fast as you like.',
  },
};

export const STOCK_TTL: Record<string, TtlGuidance> = {
  us: {
    source: 'us',
    label: 'US stocks (Tencent / Yahoo)',
    recommended: 60,
    hardMin: 30,
    rationale: 'US market quotes tick at most every few seconds; 60s captures all meaningful moves.',
  },
  cn: {
    source: 'cn',
    label: 'CN / A-share (Sina / Tencent)',
    recommended: 30,
    hardMin: 15,
    rationale: 'A-shares trade in 5-minute windows; 30s is a reasonable sampling rate.',
  },
  hk: {
    source: 'hk',
    label: 'HK stocks (Tencent)',
    recommended: 60,
    hardMin: 30,
    rationale: 'HK trading hours overlap with US morning — 60s is sufficient.',
  },
};

export interface TtlCheck {
  ok: boolean;
  hardFloorHit: boolean;
  recommended: number;
  hardMin: number;
  message: string;
  severity: 'ok' | 'warn' | 'danger';
}

export function checkProviderTtl(type: string, refreshSeconds: number | null | undefined, fallback: number): TtlCheck {
  const g = PROVIDER_TTL[type] || PROVIDER_TTL.custom;
  const v = refreshSeconds ?? fallback;
  if (v < g.hardMin) {
    return {
      ok: false,
      hardFloorHit: true,
      recommended: g.recommended,
      hardMin: g.hardMin,
      message: `Too aggressive — ${g.label} will rate-limit below ${g.hardMin}s`,
      severity: 'danger',
    };
  }
  if (v < g.recommended) {
    return {
      ok: true,
      hardFloorHit: false,
      recommended: g.recommended,
      hardMin: g.hardMin,
      message: `Below recommended ${g.recommended}s for ${g.label}`,
      severity: 'warn',
    };
  }
  return {
    ok: true,
    hardFloorHit: false,
    recommended: g.recommended,
    hardMin: g.hardMin,
    message: '',
    severity: 'ok',
  };
}

export function checkStockTtl(market: string, refreshSeconds: number | null | undefined, fallback: number): TtlCheck {
  const g = STOCK_TTL[market] || STOCK_TTL.us;
  const v = refreshSeconds ?? fallback;
  if (v < g.hardMin) {
    return {
      ok: false,
      hardFloorHit: true,
      recommended: g.recommended,
      hardMin: g.hardMin,
      message: `Too aggressive — ${g.label} will rate-limit below ${g.hardMin}s`,
      severity: 'danger',
    };
  }
  if (v < g.recommended) {
    return {
      ok: true,
      hardFloorHit: false,
      recommended: g.recommended,
      hardMin: g.hardMin,
      message: `Below recommended ${g.recommended}s for ${g.label}`,
      severity: 'warn',
    };
  }
  return {
    ok: true,
    hardFloorHit: false,
    recommended: g.recommended,
    hardMin: g.hardMin,
    message: '',
    severity: 'ok',
  };
}
