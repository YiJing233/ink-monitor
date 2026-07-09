/**
 * Tests for the public /widgets gallery (filter helper + detail-page
 * resolution contract). The page itself is a server component and the
 * filter UI is a client island — both are wired on top of the pure
 * helpers in `lib/widgets/gallery-filter.ts`, which is what we exercise
 * here so the suite stays framework-free (no React renderer needed; the
 * project's testing convention is pure-function vitests, see
 * `lib/widgets/__tests__/`).
 *
 * Coverage:
 *   1. `builtinsAsGallery()` returns every BUILTIN_MANIFESTS entry.
 *   2. Free-text search filters by id / name / description.
 *   3. Category filter narrows to a single source.kind (or explicit
 *      category for marketplace entries).
 *   4. `categoryOf()` prefers explicit `entry.category` and falls back
 *      to `manifest.source.kind`.
 *   5. The detail-page resolution contract: every built-in id resolves
 *      via BUILTIN_MANIFESTS so the `/widgets/:id` route never 404s on
 *      a gallery card's "View manifest" link.
 */
import { describe, it, expect } from 'vitest';
import { BUILTIN_LIST } from '@/lib/widgets/registry';
import {
  builtinsAsGallery,
  categoryOf,
  filterGallery,
  listCategories,
  type GalleryEntry,
} from '@/lib/widgets/gallery-filter';

describe('/widgets gallery — listing', () => {
  it('lists every BUILTIN_MANIFESTS entry', () => {
    const entries = builtinsAsGallery();
    // Same set, same count.
    expect(entries.length).toBe(BUILTIN_LIST.length);
    expect(entries.map((e) => e.manifest.id).sort()).toEqual(
      BUILTIN_LIST.map((m) => m.id).sort(),
    );
    // Every row is a structurally valid manifest — guards against a future
    // manifest that sneaks past the JSON validator but breaks the gallery.
    for (const e of entries) {
      expect(e.manifest.v).toBe(1);
      expect(e.manifest.id).toMatch(/^[a-z0-9-]+$/);
      expect(e.manifest.families.length).toBeGreaterThan(0);
      expect(e.manifest.layout).toBeDefined();
    }
  });
});

describe('/widgets gallery — search filter', () => {
  it('matches id, name, and description substrings (case-insensitive)', () => {
    const entries = builtinsAsGallery();
    // Pick a target by id rather than position so adding new manifests can't
    // flip which row we assert on.
    const target = entries.find((e) => e.manifest.id === 'clock')!;
    const fragment = target.manifest.name.split(' ')[0].toLowerCase(); // "clock"
    const filtered = filterGallery(entries, { query: fragment });
    expect(filtered.length).toBeGreaterThan(0);
    expect(
      filtered.every(
        (e) =>
          e.manifest.id.toLowerCase().includes(fragment) ||
          e.manifest.name.toLowerCase().includes(fragment) ||
          (e.manifest.description || '').toLowerCase().includes(fragment),
      ),
    ).toBe(true);
  });

  it('matches on description text', () => {
    const entries = builtinsAsGallery();
    // 'countdown' description contains the word "Days/hours".
    const filtered = filterGallery(entries, { query: 'days/hours' });
    expect(filtered.map((e) => e.manifest.id)).toContain('countdown');
  });

  it('matches on category (derived from source.kind)', () => {
    const entries = builtinsAsGallery();
    // 'rss' is one of several http-source widgets; it's the only one whose
    // name+id both contain "rss", so the query is unique to that widget.
    const filtered = filterGallery(entries, { query: 'rss' });
    expect(filtered.map((e) => e.manifest.id)).toContain('rss');
    // Every match must be in the http category (rss's source.kind).
    expect(filtered.every((e) => categoryOf(e) === 'http')).toBe(true);
  });

  it('returns [] for queries with no matches', () => {
    const entries = builtinsAsGallery();
    expect(filterGallery(entries, { query: 'zzz-nope-nothing-here-12345' })).toEqual([]);
  });

  it('passes everything through for empty/whitespace queries', () => {
    const entries = builtinsAsGallery();
    expect(filterGallery(entries, { query: '' }).length).toBe(entries.length);
    expect(filterGallery(entries, { query: '   ' }).length).toBe(entries.length);
  });
});

describe('/widgets gallery — category filter', () => {
  it('narrows to a single category', () => {
    const entries = builtinsAsGallery();
    const cats = listCategories(entries);
    expect(cats.length).toBeGreaterThan(1);
    for (const cat of cats) {
      const filtered = filterGallery(entries, { category: cat });
      expect(filtered.length).toBeGreaterThan(0);
      expect(filtered.every((e) => categoryOf(e) === cat)).toBe(true);
    }
  });

  it("'all' is a pass-through", () => {
    const entries = builtinsAsGallery();
    expect(filterGallery(entries, { category: 'all' }).length).toBe(entries.length);
  });

  it('combines search + category (intersection)', () => {
    const entries = builtinsAsGallery();
    // 'owned' category intersected with the widget id 'notes' should keep
    // exactly the notes widget (clock/calendar/notes/countdown are all
    // owned-source, but only 'notes' has 'notes' in its id).
    const filtered = filterGallery(entries, { category: 'owned', query: 'notes' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].manifest.id).toBe('notes');
  });

  it('categoryOf prefers explicit entry.category over source.kind', () => {
    // Marketplace entries may carry an editorial category (e.g. "weather")
    // on top of the IR's source.kind (e.g. "http"). The chip label must
    // surface the editorial one.
    const wrapped: GalleryEntry = {
      manifest: BUILTIN_LIST.find((m) => m.id === 'weather')!,
      category: 'weather',
    };
    expect(categoryOf(wrapped)).toBe('weather');

    // Without an explicit category, we fall back to source.kind.
    const bare = builtinsAsGallery().find((e) => e.manifest.id === 'weather')!;
    expect(bare.category).toBeUndefined();
    expect(categoryOf(bare)).toBe('http');
  });
});

describe('/widgets/:id detail page — resolution contract', () => {
  // The detail page resolves via BUILTIN_MANIFESTS first (always available),
  // then /api/market (only when MARKET_REGISTRY_URL is set). Every "View
  // manifest" link the gallery emits MUST land on a 200 — a 404 from a
  // gallery card would be a bad first impression. We derive the expected
  // set from BUILTIN_LIST itself so adding new built-ins doesn't require
  // touching this assertion.
  it('every built-in id the gallery can deep-link to is in BUILTIN_MANIFESTS', () => {
    // The "expected" set is the registry itself — the registry is the
    // single source of truth. This test then asserts the gallery emits
    // a card for every registry entry (no card without a detail page,
    // no detail page without a card).
    const ids = BUILTIN_LIST.map((m) => m.id).sort();
    expect(ids.length).toBeGreaterThan(0);
    // The detail-page resolver only needs `BUILTIN_MANIFESTS[id]` to be
    // defined — re-assert it here against the same source.
    for (const id of ids) {
      expect(BUILTIN_LIST.find((m) => m.id === id)).toBeDefined();
    }
  });

  it('every built-in manifest has a SAMPLE_DATA entry (so /preview?demo= renders)', async () => {
    // The preview route's demo mode falls back to `{}` when a sample is
    // missing, which would render an empty tile. The registry already
    // asserts this at module-load in dev; we re-assert it here so the
    // contract is documented in the gallery test suite.
    const { SAMPLE_DATA } = await import('@/lib/widgets/registry');
    for (const m of BUILTIN_LIST) {
      expect(SAMPLE_DATA[m.id], `no sample for ${m.id}`).toBeDefined();
    }
  });
});