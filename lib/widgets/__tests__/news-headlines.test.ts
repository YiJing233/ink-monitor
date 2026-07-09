/**
 * Tests for the Phase 2 `news-headlines` built-in. The manifest is
 * `http`-backed and reads from the public Algolia HN search API; we don't
 * want a real network call in tests, so we:
 *   1. Validate the manifest against the IR schema.
 *   2. Feed a hand-built `GET /api/v1/search?tags=front_page` payload
 *      through `applySelect` and assert the binds the layouts read —
 *      including the wildcard `hits[*].title` projection used by the
 *      4x4 list layout.
 *   3. Confirm the sample-data fixture matches the post-`applySelect`
 *      shape.
 *
 * The HN API is unauthenticated and rate-limited per IP; that's plenty
 * for a 15-minute refresh cadence on a single e-ink tile.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../ir';
import newsManifest from '../manifests/news-headlines.json';
import { SAMPLE_DATA, newsHeadlinesSample } from '../manifests/sample-data';
import { applySelect } from '../select';

/** Realistic subset of the Algolia HN `/api/v1/search?tags=front_page`
 *  payload. Only the fields the manifest's `select` map references are
 *  populated; downstream `applySelect` ignores the rest. */
const HN_FIXTURE = {
  hits: [
    {
      title: 'Show HN: I rewrote X in 500 lines of Rust',
      url: 'https://example.com/rewrote-x',
      points: 412,
      author: 'rkraft',
      objectID: '12345',
    },
    {
      title: 'Why the new e-ink displays are finally good enough',
      url: 'https://example.com/eink-2026',
      points: 287,
      objectID: '12346',
    },
    {
      title: 'The cost of premature optimization in 2026',
      url: 'https://example.com/premature-opt',
      points: 198,
      objectID: '12347',
    },
  ],
};

describe('news-headlines built-in', () => {
  it('validates against the IR schema with the expected source + families', () => {
    const m = validateManifest(newsManifest);
    expect(m.id).toBe('news-headlines');
    expect(m.version).toBe('0.1.0');
    expect(m.source).toMatchObject({ kind: 'http' });
    expect(m.families).toEqual(['1x2', '2x2', '4x4']);
    // Egress is pinned to the Algolia HN search host. A future maintainer
    // cannot widen the URL template to a different host without tripping
    // this assertion (and the install prompt's egress allowlist).
    expect(m.capabilities?.egress).toEqual(['hn.algolia.com']);
    // No secret — the public tier is sufficient for an e-ink tile.
    expect(m.capabilities?.secrets ?? []).toEqual([]);
    if (m.source.kind !== 'http') throw new Error('expected http source');
    // The http source must be unauthenticated since there is no secret.
    expect(m.source.auth).toBeUndefined();
  });

  it('applySelect on an HN search payload yields the headline fields + the wildcard list', () => {
    const m = validateManifest(newsManifest);
    if (m.source.kind !== 'http') throw new Error('expected http source');

    const out = applySelect(HN_FIXTURE, m.source.select) as Record<string, unknown>;

    // 1x2 / 2x2 bind title + points directly from the first hit.
    expect(out.title).toBe('Show HN: I rewrote X in 500 lines of Rust');
    expect(out.url).toBe('https://example.com/rewrote-x');
    expect(out.points).toBe(412);
    // 4x4 binds the full wildcard projection — every hit's title.
    expect(Array.isArray(out.headlines)).toBe(true);
    expect((out.headlines as unknown[]).length).toBe(3);
    expect((out.headlines as string[])[1]).toMatch(/e-ink/);
  });

  it('the sample-data fixture is shape-compatible with the post-select shape', () => {
    // The /preview route substitutes SAMPLE_DATA[id] for the source payload
    // when the user has not configured a per-instance hookup, so it must
    // carry every key the layout binds to (title, points, headlines).
    const sample = SAMPLE_DATA['news-headlines'] as Record<string, unknown>;
    expect(sample).toEqual(
      expect.objectContaining({
        title: expect.any(String),
        points: expect.any(Number),
        headlines: expect.any(Array),
      }),
    );
    expect((sample.headlines as unknown[]).length).toBeGreaterThan(0);
    // And the registry's SAMPLE_DATA entry matches the exported constant.
    expect(sample).toEqual(newsHeadlinesSample);
  });
});