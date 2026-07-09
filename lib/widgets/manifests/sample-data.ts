/**
 * Sample source-data for each built-in manifest. Used by the preview route and
 * the gallery thumbnails so the renderer can be exercised end-to-end without a
 * backend. In production these objects come from the Source layer (a builtin
 * fetcher, a declarative HTTP call, owned state, or the asset pipeline).
 *
 * Clock/countdown samples are computed at module-load time by the same pure
 * helpers the Source layer uses, so previews stay current without any I/O.
 *
 * Client-safe.
 */

import { resolveClockSource, resolveCountdownSource, resolveCalendarSource, resolveNotesSource } from '../builtin-sources';

// A tiny B&W SVG stands in for a server-dithered photo so the album always
// renders (no network, no asset pipeline needed for the skeleton).
const SAMPLE_PHOTO =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
      <rect width="400" height="400" fill="#fff"/>
      <circle cx="300" cy="90" r="46" fill="none" stroke="#000" stroke-width="4"/>
      <path d="M0 320 L120 200 L210 290 L300 200 L400 300 L400 400 L0 400 Z" fill="#000"/>
      <path d="M0 360 L90 300 L170 350 L260 290 L400 360 L400 400 L0 400 Z" fill="none" stroke="#000" stroke-width="3"/>
    </svg>`,
  );

const HOURLY_24 = [
  120, 180, 90, 60, 40, 30, 55, 210, 480, 720, 910, 1040, 980, 1100, 1230, 880, 760, 540, 610, 720, 430, 280, 190, 140,
];

/** Phase 1 non-usage built-in: live local time. Computed at module load so the
 *  preview always shows "now". Force UTC at sample time so the gallery card
 *  is reproducible regardless of where the preview was opened. */
export const clockSample = resolveClockSource('preview', 'UTC');

/** Phase 1 non-usage built-in: days/hours until a target. Defaults to 30 days
 *  out so the preview is positive and visually meaningful; per-instance
 *  countdowns override via `settings:countdown:<id>` in the user's owned_state. */
export const countdownSample = resolveCountdownSource(
  'preview',
  Date.now() + 30 * 86_400_000,
  'Launch Day',
);

/** Phase 1 non-usage built-in: a static shape mirroring what OpenWeatherMap's
 *  `/data/2.5/weather` returns when `select` is applied. The http source is
 *  not exercised at preview time (we don't want to call OWM in tests), so the
 *  renderer + selectPath both run against this hand-built response. */
export const weatherSample = {
  temp: 18.4,
  cond: 'Clouds',
  icon: '03d',
  humidity: 62,
  wind: 3.6,
};

/** Phase 1 non-usage built-in: a minimal JSON Feed / RSS-as-JSON shape so the
 *  `list` node can render the items array without a real network call. The
 *  channel.title is what the `text` node in 2x2/4x4 headers binds to. */
export const rssSample = {
  title: 'Hacker News — Front Page',
  items: [
    'Show HN: I rewrote X in 500 lines of Rust',
    'Why the new e-ink displays are finally good enough',
    'The cost of premature optimization in 2026',
    'A field guide to declarative widget IRs',
    'On keeping a personal e-ink dashboard alive for a year',
    'Notes on building a multi-tenant static-render SaaS',
  ],
};

/** Phase 2 non-usage built-in: a fixed iCal text with two future events so
 *  the gallery /preview card always shows a meaningful "days_until" bignum
 *  regardless of when the preview is opened. Computed via the same pure
 *  parser the Source layer uses, anchored at a fixed `now` so the rendered
 *  number is stable across renders. */
const CALENDAR_NOW = Date.UTC(2026, 6, 8, 12, 0, 0); // 2026-07-08T12:00:00Z
const CALENDAR_SAMPLE_ICAL = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//ink-monitor//sample//EN',
  'BEGIN:VEVENT',
  'UID:sample-1@ink-monitor',
  'DTSTART:20260715T180000Z',
  'SUMMARY:Project demo',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:sample-2@ink-monitor',
  'DTSTART:20260722T070000Z',
  'SUMMARY:Morning standup',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

export const calendarSample = resolveCalendarSource('preview', CALENDAR_SAMPLE_ICAL, CALENDAR_NOW);

/** Phase 2 non-usage built-in: a short checklist for the gallery /preview
 *  card. Six lines is enough to exercise the `max: 4` and `max: 8` cap in
 *  the 1x2 / 2x2 layouts without overflowing the e-ink canvas. */
export const notesSample = resolveNotesSource('preview', {
  lines: [
    'Buy milk on the way home',
    'Ship the calendar + notes widgets',
    'Read the iCal RFC (just the bits we use)',
    'Wire the QR write-back editor (Phase 2 TODO)',
    'Replace the SSR dither with a faster path',
    'Make a coffee — you earned it',
  ],
});

/** Phase 2 non-usage built-in: the post-`select` shape for the GitHub
 *  `/repos/{owner}/{repo}/releases` endpoint. Mirrors what the manifest's
 *  JSONPath `[0].tag_name` / `[0].name` / `[0].published_at` projection
 *  produces for the first (most-recent) release. The http source itself is
 *  not exercised at preview time — we don't want to hit the GitHub API in
 *  tests or galleries. */
export const githubReleasesSample = {
  tag: 'v0.3.1',
  name: 'v0.3.1 — markdown rendering fixes + new gallery tile',
  published_at: '2026-07-04T18:12:34Z',
};

/** Phase 2 non-usage built-in: the post-`select` shape for the CoinGecko
 *  `/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true`
 *  endpoint. The raw response is `{ bitcoin: { usd, usd_24h_change }, ethereum: { … } }`;
 *  the manifest's `select` flattens it to `{ btc_*, eth_* }` so the layout
 *  binds the same way a fixed-shape widget would. */
export const tickerTapeSample = {
  btc_price: 67842.11,
  btc_change: -1.42,
  eth_price: 3184.5,
  eth_change: 0.83,
};

/** Phase 2 non-usage built-in: the post-`select` shape for the Strava
 *  `/athlete/activities?per_page=1` endpoint. `distance` is in meters (Strava's
 *  default unit); we let the layout's `unit: "m"` carry it. */
export const stravaSample = {
  name: 'Morning Run',
  distance: 5210,
  type: 'Run',
};

/** Phase 2 non-usage built-in: the post-`select` shape for the Spotify
 *  `/v1/me/player/currently-playing` endpoint. Mirrors what the manifest's
 *  JSONPath `item.name` / `item.artists[0].name` / `item.album.name` /
 *  `is_playing` projection produces against a now-playing payload. The
 *  http source itself is not exercised at preview time — we don't want to
 *  hit Spotify's API in tests or galleries. */
export const spotifySample = {
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  album: 'A Night at the Opera',
  is_playing: true,
};

/** Phase 2 non-usage built-in: the post-`select` shape for the Algolia HN
 *  `/api/v1/search?tags=front_page` endpoint. The manifest projects
 *  `hits[0].title` / `hits[0].points` for the headline tile and
 *  `hits[*].title` for the 4x4 list layout. `url` is included for parity
 *  with the manifest's `select` map, even though the layout doesn't bind
 *  it directly today (Phase 2 TODO: hyperlink the headline). */
export const newsHeadlinesSample = {
  title: 'Show HN: I rewrote X in 500 lines of Rust',
  url: 'https://example.com/rewrote-x-in-rust',
  points: 412,
  headlines: [
    'Show HN: I rewrote X in 500 lines of Rust',
    'Why the new e-ink displays are finally good enough',
    'The cost of premature optimization in 2026',
    'A field guide to declarative widget IRs',
    'On keeping a personal e-ink dashboard alive for a year',
  ],
};

/** Phase 2 non-usage built-in: the post-`select` shape for the Mastodon
 *  `/api/v1/accounts/{userId}/statuses?limit=5` endpoint. Mirrors what
 *  the manifest's JSONPath `[0].content` / `[0].account.display_name` /
 *  `[0].created_at` / `[*].content` projection produces. `content` is
 *  the raw HTML the Mastodon API returns (the renderer is expected to
 *  strip tags before drawing — Phase 2 TODO). */
export const mastodonSample = {
  content: '<p>Shipping a new widget today!</p>',
  account: 'Ada Lovelace',
  created: '2026-07-09T08:42:18.000Z',
  statuses: [
    '<p>Shipping a new widget today!</p>',
    '<p>E-ink dashboards are an exercise in restraint.</p>',
    '<p>Reading the Mastodon API docs. Surprisingly pleasant.</p>',
    '<p>Filed a bug against the IR schema. PR incoming.</p>',
    '<p>Coffee + JSONPath = a good morning.</p>',
  ],
};

export const SAMPLE_DATA: Record<string, unknown> = {
  'api-usage': {
    name: 'OpenAI',
    used: 812345,
    limit: 1000000,
    used_pct: 81,
    reset_at: Date.now() + 3 * 3600 * 1000,
    hourly: HOURLY_24,
  },
  'stocks-table': {
    rows: [
      { symbol: 'AAPL', name: 'Apple', price: '231.40', change: '+1.20', pct: '+0.52%' },
      { symbol: 'NVDA', name: 'NVIDIA', price: '1208.88', change: '-14.30', pct: '-1.17%' },
      { symbol: '00700', name: '腾讯控股', price: '498.20', change: '+6.00', pct: '+1.22%' },
      { symbol: '600519', name: '贵州茅台', price: '1623.00', change: '-8.10', pct: '-0.50%' },
    ],
  },
  'todo-lark': {
    add_url: 'https://applink.feishu.cn/client/todo/create',
    items: [
      { summary: 'Ship widget IR schema', completed: true, due: 'Mon' },
      { summary: 'Wire the canvas editor', completed: false, due: 'Tue' },
      { summary: 'Server-side dithering pipeline', completed: false, due: 'Wed' },
      { summary: 'Gallery permission prompt', completed: false, due: 'Thu' },
      { summary: 'Write ARCHITECTURE.md', completed: true, due: 'Mon' },
    ],
  },
  gallery: {
    current: SAMPLE_PHOTO,
    caption: '富士山 · 2025 春',
  },
  clock: clockSample,
  countdown: countdownSample,
  weather: weatherSample,
  rss: rssSample,
  calendar: calendarSample,
  notes: notesSample,
  'github-releases': githubReleasesSample,
  'ticker-tape': tickerTapeSample,
  strava: stravaSample,
  'spotify-now-playing': spotifySample,
  'news-headlines': newsHeadlinesSample,
  'mastodon-feed': mastodonSample,
};
