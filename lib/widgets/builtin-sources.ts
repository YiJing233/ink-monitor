/**
 * Pure helpers for the Phase 1 non-usage built-ins: `clock` and `countdown`.
 *
 * Both ship with `source.kind: "owned"` against a `settings:*` store the user
 * edits on the authoring plane (time-zone for clock, target-date + label per
 * countdown instance). The Source layer routes those specific stores through
 * the helpers here so the manifests stay declarative (no fetcher).
 *
 * Client-safe — consumed by the sample-data fixtures, the `/admin` settings UI,
 * and the server-only `resolveSource` dispatch. Pure functions, no I/O.
 */
export interface ClockData {
  /** 0-23 in the requested time zone (no leading zero). */
  hour: number;
  /** 0-59 in the requested time zone (no leading zero). */
  minute: number;
  /** Pre-formatted "HH:MM" in the requested time zone (zero-padded). The
   *  `bignum` node can't template-suffix a `Bind`, so we ship the full string
   *  as a convenience field for layouts that want "14:30" in one number. */
  time: string;
  /** Localized weekday name (e.g. "Wednesday", "星期三") — depends on the JS runtime's locale data. */
  weekday: string;
  /** Human-readable date string (e.g. "July 8, 2026") — already localized. */
  date: string;
  /** Time-zone abbreviation (e.g. "CST") when available, else the requested IANA name. */
  tz: string;
}

export interface CountdownData {
  /** Whole days until `target` (negative if already past). */
  days: number;
  /** Whole hours inside the remaining day (0 when expired). */
  hours: number;
  /** Display label stored alongside the target (e.g. "Launch Day"). */
  label: string;
  /** Target epoch milliseconds — echoed back so callers can re-render or diff. */
  target: number;
}

/** Defaults: every clock without a configured preference runs in UTC, which is
 *  always available on a JS runtime and unambiguous in the manifest. */
const DEFAULT_TZ = 'UTC';

/**
 * Compute the local time in `tz` (IANA, e.g. "Asia/Shanghai") for "now".
 *
 * @param tz Optional IANA time-zone name. Falls back to UTC when omitted or
 *           unrecognized — Intl throws on bad zones, which we want to keep the
 *           renderer alive instead of crashing the dashboard.
 */
export function resolveClockSource(tz?: string): ClockData {
  const requested = (tz && tz.trim()) || DEFAULT_TZ;
  const safeTz = isValidTimeZone(requested) ? requested : DEFAULT_TZ;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeTz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZoneName: 'short',
  }).formatToParts(new Date());

  const lookup = Object.fromEntries(parts.map((p) => [p.type, p.value])) as Record<string, string>;
  const hour = clampInt(lookup.hour, 0, 23);
  const minute = clampInt(lookup.minute, 0, 59);

  return {
    hour,
    minute,
    time: `${pad2(hour)}:${pad2(minute)}`,
    weekday: lookup.weekday ?? '',
    date: formatDateString(lookup),
    tz: lookup.timeZoneName || safeTz,
  };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Compute the days/hours remaining until `target`. Accepts anything Date
 * understands (epoch number, ISO string, or Date instance); misses clamp to
 * an expired state (`days: 0, hours: 0`) so the bignum stays readable.
 */
export function resolveCountdownSource(
  target: number | string | Date | undefined | null,
  label = 'Countdown',
): CountdownData {
  const ms = normalizeTarget(target);
  if (ms == null) {
    return { days: 0, hours: 0, label, target: 0 };
  }

  const diff = ms - Date.now();
  if (diff <= 0) {
    // Past / moment-of: keep `days` negative so callers can render "−3d" if
    // they want; clamp `hours` because the bignum already shows the sign.
    return { days: Math.floor(diff / 86_400_000), hours: 0, label, target: ms };
  }
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  return { days, hours, label, target: ms };
}

function clampInt(raw: string | undefined, min: number, max: number): number {
  // Intl can emit "24" for hour in some locales — clamp into the standard 0–23.
  const n = parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function formatDateString(lookup: Record<string, string>): string {
  const month = lookup.month ?? '';
  const day = lookup.day ?? '';
  const year = lookup.year ?? '';
  if (!month && !day && !year) return '';
  // Strip the ordinal suffix "1st, 2nd, ..." → "1, 2, ..." so the e-ink glyphs
  // stay predictable (no small caps font dependency).
  return `${month} ${day.replace(/(st|nd|rd|th)$/i, '')}, ${year}`.trim();
}

function normalizeTarget(target: number | string | Date | undefined | null): number | null {
  if (target == null) return null;
  if (target instanceof Date) return Number.isFinite(target.getTime()) ? target.getTime() : null;
  if (typeof target === 'number') return Number.isFinite(target) ? target : null;
  if (typeof target === 'string') {
    const t = target.trim();
    if (!t) return null;
    const ms = Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Intl throws RangeError on bad zones; probe the formatted output instead so
 *  we can fall back to UTC without leaking exceptions to the renderer. */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
