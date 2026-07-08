/**
 * Pure-function tests for the Phase 2 `calendar` built-in.
 *
 * Contracts (per task spec):
 *   - A well-formed VCALENDAR with a single VEVENT resolves to the
 *     `{ title, next_at, days_until }` shape the manifest binds to.
 *   - A calendar with multiple VEVENTs returns the earliest *future* event
 *     (a past event must NOT be picked when a future one exists).
 *   - An empty calendar (no VEVENT) returns `null` so the renderer can fall
 *     back to a blank tile instead of throwing.
 *
 * The iCal parser is intentionally tiny (RFC 5545-lite) — these tests cover
 * the date forms the major providers (Google / iCloud / Outlook) actually
 * emit. They do NOT cover RRULE, EXDATE, multi-line DESCRIPTION, or time
 * zones other than UTC; see `parseICalEvents` for the documented scope.
 *
 * The manifest validation block catches drift the moment the manifest or
 * the IR schema changes.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../ir';
import calendarManifest from '../manifests/calendar.json';
import {
  parseICalEvents,
  pickNextEvent,
  resolveCalendarSource,
} from '../builtin-sources';

// `now` is fixed so the `days_until` math is reproducible across runs.
const NOW = Date.UTC(2026, 6, 8, 12, 0, 0); // 2026-07-08T12:00:00Z
const ONE_DAY = 86_400_000;

const SINGLE_EVENT_ICAL = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//ink-monitor//test//EN',
  'BEGIN:VEVENT',
  'UID:test-1@ink-monitor',
  'DTSTART:20260715T180000Z',
  'SUMMARY:Project demo',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const MULTI_EVENT_ICAL = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//ink-monitor//test//EN',
  'BEGIN:VEVENT',
  'UID:future-late@ink-monitor',
  'DTSTART:20260801T100000Z',
  'SUMMARY:Late future event',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:future-early@ink-monitor',
  'DTSTART:20260712T090000Z',
  'SUMMARY:Early future event',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:past@ink-monitor',
  'DTSTART:20260601T080000Z',
  'SUMMARY:Already happened',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const EMPTY_ICAL = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//ink-monitor//test//EN',
  'END:VCALENDAR',
].join('\r\n');

describe('parseICalEvents', () => {
  it('extracts a single VEVENT with summary + dtstart', () => {
    const events = parseICalEvents(SINGLE_EVENT_ICAL);
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('Project demo');
    expect(events[0].dtstart).toBe(Date.UTC(2026, 6, 15, 18, 0, 0));
  });

  it('picks the earliest future event when multiple VEVENTs are present', () => {
    const events = parseICalEvents(MULTI_EVENT_ICAL);
    expect(events).toHaveLength(3);
    const next = pickNextEvent(events, NOW);
    // "Early future event" is on 2026-07-12T09:00Z; the others are 07-01 (past)
    // and 08-01 (later). pickNextEvent must return the earliest *future* one.
    expect(next?.summary).toBe('Early future event');
    expect(next?.dtstart).toBe(Date.UTC(2026, 6, 12, 9, 0, 0));
  });

  it('returns an empty array for a calendar with no VEVENTs', () => {
    expect(parseICalEvents(EMPTY_ICAL)).toEqual([]);
  });

  it('unfolds RFC 5545 continuation lines before parsing', () => {
    // A long SUMMARY that the producer folded onto the next line. RFC 5545
    // §3.1 says "any sequence of CRLF followed by a single linear white-space
    // character is ignored" — i.e. the CRLF + the one leading SPACE/TAB on
    // the next line are stripped, then the rest is concatenated. Producers
    // typically put the boundary *after* the inter-word space (so the
    // unfold keeps the space in the first half) — that's what this fixture
    // models.
    const folded = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Long event title that ',
      ' spans two lines',
      'DTSTART:20260715T180000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [ev] = parseICalEvents(folded);
    expect(ev.summary).toBe('Long event title that spans two lines');
  });
});

describe('resolveCalendarSource', () => {
  it('returns the documented { title, next_at, days_until } shape', () => {
    const data = resolveCalendarSource('user-test', SINGLE_EVENT_ICAL, NOW);
    expect(data).not.toBeNull();
    expect(data!.title).toBe('Project demo');
    expect(data!.next_at).toMatch(/^2026-07-15 \d{2}:\d{2}Z$/);
    // 2026-07-15T18:00Z − 2026-07-08T12:00Z = 7d 6h, floor → 7
    expect(data!.days_until).toBe(7);
  });

  it('picks the earliest future event across multiple VEVENTs', () => {
    // The MULTI_EVENT_ICAL has a past event (06-01), an early future (07-12),
    // and a later future (08-01). We want the 07-12 one.
    const data = resolveCalendarSource('user-test', MULTI_EVENT_ICAL, NOW);
    expect(data?.title).toBe('Early future event');
    // 2026-07-12T09:00Z − 2026-07-08T12:00Z = 3d 21h, floor → 3
    expect(data?.days_until).toBe(3);
  });

  it('returns null for an empty calendar (no VEVENTs to pick)', () => {
    expect(resolveCalendarSource('user-test', EMPTY_ICAL, NOW)).toBeNull();
  });

  it('returns null when the icalText is missing', () => {
    // Tolerates both null and undefined — the Source layer passes through
    // what `getOwnedState` returns, which is null for an unconfigured store.
    expect(resolveCalendarSource('user-test', null, NOW)).toBeNull();
    expect(resolveCalendarSource('user-test', undefined, NOW)).toBeNull();
    expect(resolveCalendarSource('user-test', '', NOW)).toBeNull();
  });

  it('falls back to the most recent past event with days_until=0 when no future events exist', () => {
    // All events in the past → next = the most recent one, days clamped to 0
    // so the bignum doesn't show a confusing negative.
    const allPast = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'DTSTART:20260101T000000Z',
      'SUMMARY:Last chance',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const data = resolveCalendarSource('user-test', allPast, NOW);
    expect(data?.title).toBe('Last chance');
    expect(data?.days_until).toBe(0);
  });
});

describe('calendar manifest', () => {
  it('validates against the IR schema with the expected source + families', () => {
    const m = validateManifest(calendarManifest);
    expect(m.id).toBe('calendar');
    expect(m.version).toBe('0.1.0');
    expect(m.source).toEqual({ kind: 'owned', store: 'settings:calendar:icalUrl' });
    expect(m.families).toEqual(['1x1', '2x2']);
    // Calendar doesn't write to owned state — the user only configures the
    // iCal URL once and the source layer fetches/reads on their behalf.
    expect(m.capabilities?.writes).toBe(false);
  });
});
