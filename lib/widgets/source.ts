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
import { getOwnedState, getWidgetSecret, listWidgets, logWidgetResolve, type DashboardRow } from '../db';
import { safeJson } from '../safe-json';
import { formatNumber, formatPercent } from '../utils';
import { resolveClockSource, resolveCountdownSource, resolveCalendarSource, resolveNotesSource } from './builtin-sources';
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
/** Per-user iCal URL for the `calendar` built-in. The Source layer fetches
 *  this URL with `safeFetch` and hands the body to the iCal parser. */
const CALENDAR_STORE = 'settings:calendar:icalUrl';
/** Per-user freeform lines for the `notes` built-in. Read by the Source layer
 *  (writes are a Phase 2 TODO — see notes.json manifest description). */
const NOTES_STORE = 'settings:notes';

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
      return resolveOwnedState(ctx.userId, src.store, config, manifest.capabilities?.egress);
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
  egress?: string[],
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
  if (resolvedStore === CALENDAR_STORE) {
    // String value = iCal URL the user pasted. No URL → null (blank tile);
    // an http error → null. Egress allowlist comes from the manifest's
    // declared `capabilities.egress`; an empty list means "any public host"
    // (the user typed the URL, they accept the fetch — see calendar.json
    // description).
    const url = (await getOwnedState(userId, resolvedStore)) as string | null;
    if (!url) return null;
    const res = await safeFetch(url, { allowlist: egress });
    if (!res.ok) return null;
    return resolveCalendarSource(userId, res.bytes.toString('utf8'));
  }
  if (resolvedStore === NOTES_STORE) {
    // Per-instance config wins (the modern write-back path: the admin QR
    // editor POSTs to /api/widgets/[id]/config which writes `config_json`).
    // `settings:notes` is the legacy single-store fallback for installs that
    // predate the per-widget write path; see lib/widgets/manifests/notes.json
    // for the storage rationale and lib/widgets/builtin-sources.ts#resolveNotesSource
    // for the priority rules.
    const configLines = (config as { lines?: unknown } | undefined)?.lines;
    return resolveNotesSource(userId, await getOwnedState(userId, resolvedStore), configLines);
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
  // Resolve every secret this manifest declares. We use `capabilities.secrets`
  // (not `auth.secret`) as the source of truth so a manifest whose auth is
  // carried in templated `headers` (Plex's `X-Plex-Token`, Home Assistant's
  // `Authorization: Bearer <token>`) can still inject its secret into the
  // variable scope without claiming an `auth.type` it doesn't actually use.
  // The auth-secret path still works — when `auth.secret` is set we
  // additionally resolve it (a redundant resolution is cheap).
  const declared = new Set<string>([
    ...(src.auth?.secret ? [src.auth.secret] : []),
    ...(manifest.capabilities?.secrets ?? []),
  ]);
  const secretVals: Record<string, string> = {};
  for (const name of declared) {
    const enc = getWidgetSecret(ctx.userId, name);
    if (!enc) continue;
    try {
      secretVals[name] = decryptForUser(ctx.userId, enc);
    } catch {
      /* leave empty */
    }
  }

  // Template {{VAR}} from config (+ secrets, e.g. for headers / query strings).
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(config)) vars[k] = String(v);
  for (const [k, v] of Object.entries(secretVals)) vars[k] = v;
  const url = src.url.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
  // Same template rules apply to the request body so a POST can carry a
  // secret the same way the URL does. Undefined when absent — safeFetch will
  // default to GET behavior.
  const body = src.body ? src.body.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '') : undefined;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (src.auth?.type === 'bearer' && src.auth.secret && secretVals[src.auth.secret]) {
    headers['Authorization'] = `Bearer ${secretVals[src.auth.secret]}`;
  }
  if (src.auth?.type === 'header' && src.auth.header && src.auth.secret && secretVals[src.auth.secret]) {
    headers[src.auth.header] = secretVals[src.auth.secret];
  }
  // Manifest-declared templated headers. Both name and value pass through the
  // same {{VAR}} substitution as the URL so a manifest can carry auth headers
  // the fixed `auth` enum cannot express (Plex's `X-Plex-Token` header,
  // Home Assistant's `Authorization: Bearer <token>` header, etc.). Headers
  // declared here layer on top of the auth-derived headers — if both name a
  // key the manifest wins, so the explicit declaration always has the last
  // word (matters for the Plex case where the user wires the token through
  // `auth: { type: 'none' }` to avoid the `Bearer ` prefix).
  if (src.headers) {
    for (const [name, value] of Object.entries(src.headers)) {
      const resolvedName = name.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
      const resolvedValue = value.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
      headers[resolvedName] = resolvedValue;
    }
  }

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
  /** Widget row id (= `widgets.id`). Surfaced to `DashboardCanvas` so widgets
   *  that stamp a scan-to-edit QR (currently `notes`) can deep-link to the
   *  per-instance admin editor at `/admin/widgets/<id>/edit-notes`. */
  widgetInstanceId: string;
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
      // Manifest parse/validate failure: log it so the diagnostics route can
      // surface it as the widget's `lastError`, then skip — a corrupt row
      // shouldn't break the entire canvas.
      logWidgetResolve(userId, wrow.id, 0, 'invalid manifest_json');
      continue;
    }
    const config = (safeJson(wrow.config_json, 'widgets.config_json') as Record<string, unknown>) || {};
    // Per-widget timing + error capture. `performance.now()` is monotonic
    // and immune to wall-clock jumps, which matters on e-ink devices where
    // the renderer frequently reschedules itself mid-resolve.
    const startedAt = performance.now();
    let data: unknown;
    let errMsg: string | null = null;
    try {
      data = await resolveSource(manifest, config, { userId });
    } catch (err) {
      errMsg = err instanceof Error ? err.message : String(err);
      // The canvas continues to render — a single widget failing must not
      // blank out the page. `data` stays undefined on purpose so the
      // downstream render layer can fall back to its "error" layout.
      data = undefined;
    }
    const ms = Math.round(performance.now() - startedAt);
    logWidgetResolve(userId, wrow.id, ms, errMsg);
    if (errMsg) continue;
    items.push({ placement: p, manifest, data, widgetInstanceId: wrow.id });
  }
  const override = overrides[deviceId];
  return { deviceId, items, refreshOverrideSec: typeof override === 'number' && override >= 15 ? override : null };
}
