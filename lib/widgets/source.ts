import 'server-only';
/**
 * Source layer (L1): resolve a manifest's declared source into the flat data
 * object its binds read. Dispatches by trust tier:
 *
 *   demo     -> inline sample data
 *   builtin  -> existing repo fetchers (reuses the aggregator's cached snapshot)
 *   http     -> SSRF-guarded fetch + JSONPath `select` + injected secret
 *   owned    -> platform-stored state (TODO/notes/counters)
 *   asset    -> rewrite image URLs through the dithering proxy
 *
 * This is the single place provider/stock data crosses into the widget pipeline,
 * so the duplicated fetch logic in aggregator.ts can eventually collapse here.
 */
import { getDisplayData } from '../aggregator';
import { decryptForUser } from '../crypto';
import { getOwnedState, getWidgetSecret, listWidgets, type DashboardRow } from '../db';
import { safeJson } from '../safe-json';
import { formatNumber, formatPercent } from '../utils';
import { resolveClockSource, resolveCountdownSource } from './builtin-sources';
import type { DeviceId } from './devices';
import { validateManifest, type Manifest } from './ir';
import { layoutFor, type Dashboard, type Placement } from './placement';
import { safeFetch } from './safe-fetch';
import { applySelect } from './select';
import { signValue } from './sign';
import { getAlbumStore } from './album-store';

/** Prefix for the per-user clock preference store. Single instance per user. */
const CLOCK_STORE = 'settings:clock';
/** Prefix for per-instance countdown stores. Full key = `settings:countdown:<widgetId>`. */
const COUNTDOWN_STORE_PREFIX = 'settings:countdown:';

export interface ResolveCtx {
  userId: string;
}

export async function resolveSource(
  manifest: Manifest,
  config: Record<string, unknown>,
  ctx: ResolveCtx,
): Promise<unknown> {
  const src = manifest.source;
  switch (src.kind) {
    case 'demo':
      return src.data ?? {};
    case 'builtin':
      return resolveBuiltin(src.ref, { ...(src.config ?? {}), ...config }, ctx);
    case 'http':
      return resolveHttp(manifest, src, config, ctx);
    case 'owned':
      return resolveOwnedState(ctx.userId, src.store, config);
    case 'asset':
      return resolveAsset(config);
    case 'album':
      return resolveRotatingAlbum(ctx.userId, src.album, src.refresh_seconds ?? 900);
    default:
      return {};
  }
}

/**
 * Resolve an `owned` store. The Phase 1 built-ins (clock + countdown) store
 * user preferences (tz, target-date, label) in the same `owned_state` table as
 * generic TODO/notes data, so we dispatch by store key here rather than in the
 * manifest itself — keeps the IR fully declarative.
 *
 * The store path supports the same `{{config-key}}` substitution as the `http`
 * source's URL, so a manifest can declare `settings:countdown:{{instanceId}}`
 * and the widget instance provides its id via `config` — giving each placed
 * countdown its own private store without re-validating the manifest per
 * instance.
 */
async function resolveOwnedState(
  userId: string,
  store: string,
  config: Record<string, unknown> = {},
): Promise<unknown> {
  const resolvedStore = store.replace(/\{\{(\w+)\}\}/g, (_, k) => String(config[k] ?? ''));
  if (resolvedStore === CLOCK_STORE) {
    // Settings object: { tz?: string }. Missing => UTC default inside the helper.
    const settings = (await getOwnedState(userId, resolvedStore)) as { tz?: string } | null;
    return resolveClockSource(userId, settings?.tz);
  }
  if (resolvedStore.startsWith(COUNTDOWN_STORE_PREFIX)) {
    // Per-instance settings object: { target: ISO | ms, label?: string }.
    const settings = (await getOwnedState(userId, resolvedStore)) as
      | { target?: number | string; label?: string }
      | null;
    return resolveCountdownSource(userId, settings?.target, settings?.label ?? 'Countdown');
  }
  return (await getOwnedState(userId, resolvedStore)) ?? { items: [] };
}

async function resolveBuiltin(ref: string, config: Record<string, unknown>, ctx: ResolveCtx): Promise<unknown> {
  // `getDisplayData` is wrapped in React's per-render cache inside
  // `lib/aggregator.ts`, so every builtin widget in the same render shares
  // a single aggregator snapshot for `ctx.userId`.
  const data = await getDisplayData(ctx.userId);

  if (ref === 'stocks') {
    return {
      rows: data.stocks.map((s) => ({
        symbol: s.symbol,
        name: s.name,
        price: Number.isFinite(s.price) ? formatNumber(s.price, s.price < 10 ? 3 : 2) : '—',
        change: Number.isFinite(s.change) ? `${s.change > 0 ? '+' : ''}${formatNumber(s.change)}` : '—',
        pct: Number.isFinite(s.changePercent) ? formatPercent(s.changePercent) : '—',
      })),
    };
  }

  if (ref === 'provider') {
    const pid = String(config.providerId ?? '');
    const pv = data.providers.find((p) => p.id === pid) ?? data.providers[0];
    if (!pv) return { name: 'No provider', used: 0, limit: null, used_pct: 0, hourly: [] };
    const m = pv.metrics?.[0];
    const used = m?.used ?? 0;
    const limit = m?.limit ?? null;
    return {
      name: pv.name,
      used,
      limit,
      used_pct: limit ? Math.round((used / limit) * 100) : 0,
      reset_at: m?.resetAt ?? null,
      hourly: pv.history ?? [],
      ok: pv.ok,
      error: pv.error,
    };
  }

  return {};
}

async function resolveHttp(
  manifest: Manifest,
  src: Extract<Manifest['source'], { kind: 'http' }>,
  config: Record<string, unknown>,
  ctx: ResolveCtx,
): Promise<unknown> {
  // Resolve the declared secret (value never leaves the server).
  const secretName = src.auth?.secret;
  let secretVal = '';
  if (secretName) {
    const enc = getWidgetSecret(ctx.userId, secretName);
    if (enc) {
      try {
        secretVal = decryptForUser(ctx.userId, enc);
      } catch {
        /* leave empty */
      }
    }
  }

  // Template {{VAR}} from config (+ the secret, e.g. for query-string keys).
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) vars[k] = String(v);
  if (secretName) vars[secretName] = secretVal;
  const url = src.url.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
  // Same template rules apply to the request body so a POST can carry a
  // secret the same way the URL does. Undefined when absent — safeFetch will
  // default to GET behavior.
  const body = src.body ? src.body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '') : undefined;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (src.auth?.type === 'bearer' && secretVal) headers['Authorization'] = `Bearer ${secretVal}`;
  if (src.auth?.type === 'header' && src.auth.header && secretVal) headers[src.auth.header] = secretVal;

  const res = await safeFetch(url, {
    method: src.method || 'GET',
    headers,
    body,
    allowlist: manifest.capabilities?.egress, // confine egress to declared hosts
  });
  if (!res.ok) return { error: res.error || `HTTP ${res.status}`, items: [] };

  let json: unknown;
  try {
    json = JSON.parse(res.bytes.toString('utf8'));
  } catch {
    return { error: 'invalid JSON response', items: [] };
  }
  return applySelect(json, src.select);
}

function resolveAsset(config: Record<string, unknown>): unknown {
  const current = String(config.current ?? '');
  const caption = config.caption != null ? String(config.caption) : '';
  // Rewrite real photos through the dithering proxy; pass data: URIs through.
  // The src is HMAC-signed so the proxy only serves URLs we minted.
  if (/^https?:\/\//.test(current)) {
    const sig = signValue(current);
    return { current: `/api/asset/dither?style=atkinson&src=${encodeURIComponent(current)}&sig=${sig}`, caption };
  }
  return { current, caption };
}

/** Pick which album photo to show. Rotation is read-only — derived from the
 *  wall clock so it advances each refresh without a write. The bucket size
 *  (~15 min by default) can be widened per-album. */
export async function resolveRotatingAlbum(userId: string, album: string, refreshSeconds = 900): Promise<unknown> {
  const items = await getAlbumStore().list(userId, album);
  if (!items.length) return { current: '', caption: 'no photos' };
  const bucket = Math.floor(Date.now() / (refreshSeconds * 1000));
  const it = items[bucket % items.length];
  return resolveAsset({ current: it.src, caption: it.caption });
}

export interface ResolvedItem {
  placement: Placement;
  manifest: Manifest;
  data: unknown;
}

export interface ResolvedDashboard {
  deviceId: DeviceId;
  items: ResolvedItem[];
  /** Per-device refresh override in seconds (if set by the user). */
  refreshOverrideSec: number | null;
}

/**
 * Load a dashboard row, resolve its layout for the target device, and fetch each
 * placed widget's data through the Source layer. Returns what DashboardCanvas
 * needs. Used by /display (and /preview for a real dashboard).
 */
export async function resolveDashboard(
  userId: string,
  row: DashboardRow,
  deviceOverride?: DeviceId,
): Promise<ResolvedDashboard> {
  const layouts = safeJson(row.layouts_json, 'dashboards.layouts_json') as Partial<Record<DeviceId, Placement[]>>;
  const overrides = safeJson(row.refresh_overrides_json, 'dashboards.refresh_overrides_json') as Partial<Record<DeviceId, number>>;
  const deviceId = (deviceOverride || row.base_device) as DeviceId;
  const dash: Dashboard = { id: row.id, name: row.name, baseDevice: row.base_device as DeviceId, widgets: [], layouts };
  const placements = layoutFor(dash, deviceId);
  const byId = new Map(listWidgets(userId).map((w) => [w.id, w]));

  const items: ResolvedItem[] = [];
  for (const p of placements) {
    const wrow = byId.get(p.widgetId);
    if (!wrow) continue;
    let manifest: Manifest;
    try {
      manifest = validateManifest(JSON.parse(wrow.manifest_json));
    } catch {
      continue; // skip a corrupt/out-of-spec manifest rather than breaking the page
    }
    const config = (safeJson(wrow.config_json, 'widgets.config_json') as Record<string, unknown>) || {};
    const data = await resolveSource(manifest, config, { userId });
    items.push({ placement: p, manifest, data });
  }
  const override = overrides[deviceId];
  return { deviceId, items, refreshOverrideSec: typeof override === 'number' && override >= 15 ? override : null };
}
