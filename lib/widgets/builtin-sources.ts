/**
 * Pure helpers for the built-in widgets whose source is `owned` against a
 * `settings:*` store the user edits on the authoring plane:
 *
 *   - `clock`     — per-user time zone (`settings:clock`)
 *   - `countdown` — per-instance target date + label (`settings:countdown:<id>`)
 *   - `calendar`  — per-user iCal URL (`settings:calendar:icalUrl`)
 *   - `notes`     — per-user freeform lines (`settings:notes`)
 *
 * The Source layer routes those specific stores through the helpers here so
 * the manifests stay declarative (no fetcher). For `calendar` and `notes` the
 * helpers take the already-fetched payload (iCal text / owned-state value) so
 * they stay client-safe — the server-only fetch + `getOwnedState` lives in
 * `source.ts`, not here.
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
  /** Localized weekday name (e.g. "Wednesday") — depends on the JS runtime's locale data. */
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
 * Pure: no DB. The optional `userId` is reserved as an in-band cache key — when
 * a future per-user prefs cache lives, this layer can flip it on without
 * touching call sites. Today it just lets the test pass userId + tz together.
 *
 * @param userId Reserved for future per-user overrides; ignored today.
 * @param tz      Optional IANA time-zone name. Falls back to UTC when omitted
 *                or unrecognized — Intl throws on bad zones, which we want
 *                to keep the renderer alive instead of crashing the dashboard.
 */
export function resolveClockSource(userId: string, tz?: string): ClockData {
  void userId; // reserved
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

/**
 * Compute the days/hours remaining until `target`. Accepts anything Date
 * understands (epoch number, ISO string, or Date instance); misses clamp to
 * an expired state (`days: 0, hours: 0`) so the bignum stays readable.
 *
 * Pure: no DB. `userId` reserved like in `resolveClockSource`.
 */
export function resolveCountdownSource(
  userId: string,
  target: number | string | Date | undefined | null,
  label = 'Countdown',
): CountdownData {
  void userId; // reserved
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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
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

// =============================================================================
// Phase 2 non-usage built-ins: `calendar` + `notes`
// =============================================================================

/** Shape returned by `resolveCalendarSource` — what the `calendar` manifest's
 *  layout binds to (`title` for the SUMMARY, `next_at` for the wall-clock
 *  date string of the next event, `days_until` for the bignum). */
export interface CalendarData {
  /** SUMMARY of the next upcoming VEVENT. */
  title: string;
  /** Pre-formatted "YYYY-MM-DD HH:mm" string in UTC for the next event. Kept
   *  as a string (not epoch ms) so the `text` node can render it without a
   *  date-format helper — the e-ink renderer has no Intl context. */
  next_at: string;
  /** Whole days from `now` to the next event (negative if the next event is
   *  in the past — i.e. the calendar has no future events and we fell back to
   *  the most recent one). Floored, not rounded: "3 days 23h" → 3. */
  days_until: number;
}

/** A single parsed VEVENT — internal to the iCal parser, exported for the
 *  `pickNextEvent` helper so tests can drive it directly. */
export interface ICalEvent {
  summary: string;
  /** Epoch ms — UTC when the value carried a trailing `Z`, local time
   *  interpretation otherwise. */
  dtstart: number;
}

/** Shape returned by `resolveNotesSource` — what the `notes` manifest's `list`
 *  node binds to. The Source layer writes to `settings:notes` through a
 *  QR-backed editor (UI is on the roadmap). */
export interface NotesData {
  lines: string[];
}

/**
 * Tiny RFC 5545-lite parser. Handles the only fields the `calendar` widget
 * needs (`SUMMARY`, `DTSTART`) plus RFC line folding (continuation lines
 * starting with SPACE / HTAB) and the date forms the major calendar
 * providers emit:
 *
 *   `20260101`              — all-day, DATE value
 *   `20260101T120000`       — floating local time, DATE-TIME without `Z`
 *   `20260101T120000Z`      — UTC, DATE-TIME with `Z`
 *
 * Not handled (and we don't need to): RRULE expansion, EXDATE, multi-line
 * DESCRIPTION, quoted parameters, time zones other than UTC, recurrence
 * overrides. Calendars with these features still parse; events we can't
 * decode are silently skipped.
 */
export function parseICalEvents(ical: string): ICalEvent[] {
  const events: ICalEvent[] = [];
  if (!ical) return events;
  // CRLF → LF, then un-fold (RFC 5545 §3.1: a CRLF followed by a single
  // linear white-space character is a continuation).
  const unfolded = ical
    .replace(/\r\n/g, '\n')
    .split('\n')
    .reduce<string[]>((acc, line) => {
      if ((line.startsWith(' ') || line.startsWith('\t')) && acc.length > 0) {
        acc[acc.length - 1] += line.slice(1);
      } else if (line.length > 0) {
        acc.push(line);
      }
      return acc;
    }, []);

  let inEvent = false;
  let summary: string | null = null;
  let dtstart: string | null = null;
  const flush = () => {
    if (summary != null && dtstart != null) {
      const ms = parseICalDate(dtstart);
      if (ms != null && Number.isFinite(ms)) {
        events.push({ summary: unescapeICalText(summary), dtstart: ms });
      }
    }
    summary = null;
    dtstart = null;
  };
  for (const line of unfolded) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      summary = null;
      dtstart = null;
      continue;
    }
    if (line === 'END:VEVENT') {
      if (inEvent) flush();
      inEvent = false;
      continue;
    }
    if (!inEvent) continue;
    // Property lines: `NAME[;params]:value`. We only care about the property
    // name, not the params (e.g. `DTSTART;TZID=Asia/Shanghai:20260101T120000`
    // — we ignore TZID and treat the value as floating local time).
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const namePart = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const name = namePart.split(';', 1)[0].toUpperCase();
    if (name === 'SUMMARY') summary = value;
    else if (name === 'DTSTART') dtstart = value;
  }
  return events;
}

/** Unescape RFC 5545 §3.3.11 TEXT values: `\,` `\;` `\n` `\\` are the only
 *  escapes the calendar providers we care about emit. Anything else (e.g.
 *  `\:` in a URL) we leave as a literal backslash so the rendered title
 *  doesn't lose information. */
function unescapeICalText(s: string): string {
  return s
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** Parse the date forms iCal providers actually emit. Returns epoch ms (UTC
 *  for the `Z` form, local-time interpretation otherwise) or `null` if the
 *  string is not one of the three supported forms. */
function parseICalDate(s: string): number | null {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/;
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;
  let m = s.match(dateOnly);
  if (m) {
    const [, y, mo, d] = m;
    return Date.UTC(+y, +mo - 1, +d);
  }
  m = s.match(dateTime);
  if (m) {
    const [, y, mo, d, h, mi, se, z] = m;
    if (z === 'Z') return Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
    return new Date(+y, +mo - 1, +d, +h, +mi, +se).getTime();
  }
  return null;
}

/** Choose the next event for the bignum. Prefers the earliest event at or
 *  after `now`; if none exist, returns the most recent past event so the
 *  widget never goes blank for a calendar that has run out of future items.
 *  Returns `null` for an empty event list. */
export function pickNextEvent(events: ICalEvent[], now: number): ICalEvent | null {
  if (events.length === 0) return null;
  const future = events.filter((e) => e.dtstart >= now);
  if (future.length > 0) {
    future.sort((a, b) => a.dtstart - b.dtstart);
    return future[0];
  }
  const sorted = events.slice().sort((a, b) => b.dtstart - a.dtstart);
  return sorted[0];
}

/**
 * Compute the `calendar` widget's data shape from a raw iCal text body.
 *
 * The Source layer (server-only) is responsible for fetching the iCal URL
 * with `safeFetch`; this helper only parses + picks. Returns `null` for an
 * empty / unparseable calendar so the renderer can fall back to a blank
 * tile without throwing.
 *
 * @param userId   Reserved for future per-user overrides; ignored today.
 * @param icalText The body of the iCal response — already decoded UTF-8.
 * @param now      Optional `Date.now()`-style anchor. Tests pass an explicit
 *                 value; the dispatcher uses `Date.now()`.
 */
export function resolveCalendarSource(
  userId: string,
  icalText: string | null | undefined,
  now: number = Date.now(),
): CalendarData | null {
  void userId;
  if (!icalText) return null;
  const events = parseICalEvents(icalText);
  const next = pickNextEvent(events, now);
  if (!next) return null;
  // `days_until` is whole-day floor, not ceil — at 23h59m before an event the
  // user has had a "0 days" day already in their pocket, so we report the
  // number of *complete* days remaining.
  const days = Math.floor((next.dtstart - now) / 86_400_000);
  return {
    title: next.summary || 'Untitled event',
    next_at: formatICalDate(next.dtstart),
    // Past-event fallback (pickNextEvent returned the most recent): report
    // 0 so the bignum doesn't show a confusing negative.
    days_until: days < 0 ? 0 : days,
  };
}

/** `YYYY-MM-DD HH:mm` in UTC. The e-ink renderer has no Intl context, so we
 *  format in UTC deterministically — the e-ink glyphs also don't carry a
 *  timezone hint anyway. */
function formatICalDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

/**
 * Compute the `notes` widget's data shape from a stored `owned_state` value.
 *
 * The Source layer (server-only) reads the value at `settings:notes`; this
 * helper just normalizes it into `{ lines: string[] }`. Tolerates a missing
 * row, a `null` value, and a value with a non-array `lines` field — all
 * collapse to an empty list, which the `list` node renders as a blank tile.
 *
 * @param userId     Reserved for future per-user overrides; ignored today.
 * @param ownedState The value previously stored at `settings:notes`. Shape:
 *                   `{ lines: string[] }`. Pass `null` / `undefined` for the
 *                   "never configured" case.
 */
export function resolveNotesSource(userId: string, ownedState: unknown): NotesData {
  void userId;
  const lines = (ownedState as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(lines)) return { lines: [] };
  // Coerce to string + drop empties; the editor saves whatever the user typed
  // and we don't want a stray `null` to crash the `list` renderer.
  return { lines: lines.filter((l): l is string => typeof l === 'string' && l.length > 0) };
}
