/**
 * Tests for the Phase 1 `rss` built-in. The manifest is `http`-backed and
 * accepts an arbitrary feedUrl from the user's per-instance config; we
 * verify the contract without a network call by:
 *   1. Validating the manifest against the IR schema.
 *   2. Confirming `applySelect` extracts the title and items array from a
 *      realistic RSS-as-JSON body using the manifest's own select map.
 *   3. Confirming the sample-data fixture (used by /preview when no live
 *      feed is configured) carries the same shape.
 *   4. Asserting the empty-egress allowlist correctly triggers the
 *      `EGRESS_UNRESTRICTED` notice at install time (the install prompt is
 *      the only thing standing between the user and an arbitrary outbound
 *      request, so this is part of the widget's contract, not just a UX
 *      detail).
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../ir';
import rssManifest from '../manifests/rss.json';
import { SAMPLE_DATA, rssSample } from '../manifests/sample-data';
import { applySelect } from '../select';
import { describeCapabilities } from '../capabilities';
import { EGRESS_UNRESTRICTED } from '../registry-meta';

/** Realistic RSS-as-JSON body (subset). The feedUrl is filled in by the
 *  per-instance config before safeFetch runs; the http source itself doesn't
 *  know or care which host this came from. */
const RSS_FIXTURE = {
  rss: {
    channel: {
      title: 'Hacker News — Front Page',
      link: 'https://news.ycombinator.com/',
      item: [
        { title: 'Show HN: I rewrote X in 500 lines of Rust' },
        { title: 'Why the new e-ink displays are finally good enough' },
        { title: 'The cost of premature optimization in 2026' },
        { title: 'A field guide to declarative widget IRs' },
        { title: 'On keeping a personal e-ink dashboard alive for a year' },
      ],
    },
  },
};

describe('rss built-in', () => {
  it('the built-in rss manifest validates against the IR schema', () => {
    const m = validateManifest(rssManifest);
    expect(m.id).toBe('rss');
    expect(m.version).toBe('0.1.0');
    expect(m.source).toMatchObject({ kind: 'http' });
    expect(m.families).toEqual(['1x2', '2x2', '4x4']);
    // The whole point of the empty egress allowlist is to push the safety
    // net onto the install prompt — assert the manifest actually opted in.
    expect(m.capabilities?.egress ?? []).toEqual([]);
  });

  it('applySelect on an RSS-as-JSON body yields title and items', () => {
    const m = validateManifest(rssManifest);
    if (m.source.kind !== 'http') throw new Error('rss source is not http');

    const out = applySelect(RSS_FIXTURE, m.source.select) as Record<string, unknown>;

    expect(out.title).toBe('Hacker News — Front Page');
    expect(Array.isArray(out.items)).toBe(true);
    expect(out.items).toHaveLength(5);
    // The list node consumes items as strings (each one is already the
    // post-`[*].title` projection), so the first row's text is exactly the
    // first RSS item's title.
    expect((out.items as string[])[0]).toMatch(/Rust/);
  });

  it('the sample-data fixture is shape-compatible with the post-select shape', () => {
    const sample = SAMPLE_DATA.rss as Record<string, unknown>;
    expect(sample).toEqual(
      expect.objectContaining({
        title: expect.any(String),
        items: expect.any(Array),
      }),
    );
    expect((sample.items as unknown[]).length).toBeGreaterThan(0);
    // And the exported constant matches the registry entry.
    expect(sample).toEqual(rssSample);
  });

  it('the empty egress allowlist triggers the unrestricted install-time notice', () => {
    // The user has to see "this widget can reach any public host" because
    // the rss manifest's source URL is templated from their own config.
    // If the allowlist were non-empty, this notice would silently disappear.
    const m = validateManifest(rssManifest);
    const notices = describeCapabilities(m);
    const unrestricted = notices.find((n) => n.kind === EGRESS_UNRESTRICTED);
    expect(unrestricted).toBeDefined();
  });
});
