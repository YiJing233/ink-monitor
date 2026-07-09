/**
 * Tests for the Phase 2 `mastodon-feed` built-in. The manifest is
 * `http`-backed and templated — the URL is built from `{{instance}}` /
 * `{{userId}}` per-instance config and requires a live `MASTODON_TOKEN`
 * to actually fetch. We verify the *contract* the renderer depends on
 * without a network call:
 *   1. Validate the manifest against the IR schema.
 *   2. Feed a hand-built `GET /api/v1/accounts/{id}/statuses?limit=5`
 *      response through `applySelect` and assert the binds the layouts
 *      read (account / created / content for the headline tile, plus
 *      the wildcard status list for the list layouts).
 *   3. Confirm the empty egress allowlist triggers the
 *      `EGRESS_UNRESTRICTED` notice at install time — the install
 *      prompt is the only thing standing between the user and an
 *      arbitrary outbound request to the user-supplied instance host,
 *      so this is part of the widget's contract, not just a UX detail.
 *   4. Confirm the sample-data fixture matches the post-`applySelect`
 *      shape.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../ir';
import mastodonManifest from '../manifests/mastodon-feed.json';
import { SAMPLE_DATA, mastodonSample } from '../manifests/sample-data';
import { applySelect } from '../select';
import { describeCapabilities } from '../capabilities';
import { EGRESS_UNRESTRICTED } from '../registry-meta';

/** Realistic subset of the Mastodon `/api/v1/accounts/{id}/statuses`
 *  payload. `content` is the raw HTML the API returns. Only the fields
 *  the manifest's `select` map references are populated. */
const MASTODON_FIXTURE = [
  {
    id: '111111111111111111',
    created_at: '2026-07-09T08:42:18.000Z',
    content: '<p>Shipping a new widget today!</p>',
    visibility: 'public',
    account: {
      id: '42',
      username: 'ada',
      display_name: 'Ada Lovelace',
    },
  },
  {
    id: '111111111111111110',
    created_at: '2026-07-09T07:11:02.000Z',
    content: '<p>E-ink dashboards are an exercise in restraint.</p>',
    visibility: 'public',
    account: {
      id: '42',
      username: 'ada',
      display_name: 'Ada Lovelace',
    },
  },
  {
    id: '111111111111111109',
    created_at: '2026-07-08T22:03:50.000Z',
    content: '<p>Reading the Mastodon API docs. Surprisingly pleasant.</p>',
    visibility: 'public',
    account: {
      id: '42',
      username: 'ada',
      display_name: 'Ada Lovelace',
    },
  },
];

describe('mastodon-feed built-in', () => {
  it('validates against the IR schema with the expected source + families', () => {
    const m = validateManifest(mastodonManifest);
    expect(m.id).toBe('mastodon-feed');
    expect(m.version).toBe('0.1.0');
    expect(m.source).toMatchObject({ kind: 'http' });
    expect(m.families).toEqual(['1x2', '2x2']);
    // The instance host is templated from user config, so egress is empty
    // by design — the install prompt must surface the unrestricted notice.
    expect(m.capabilities?.egress ?? []).toEqual([]);
    // Bearer wiring on the source so the manifest can't silently down-grade
    // to an unauthenticated call (Mastodon's /statuses endpoint requires it
    // for any non-public timeline in v4).
    expect(m.capabilities?.secrets).toEqual(['MASTODON_TOKEN']);
    if (m.source.kind !== 'http') throw new Error('expected http source');
    expect(m.source.auth).toEqual({ type: 'bearer', secret: 'MASTODON_TOKEN' });
  });

  it('applySelect on a Mastodon statuses payload yields account / created / content + the status list', () => {
    const m = validateManifest(mastodonManifest);
    if (m.source.kind !== 'http') throw new Error('expected http source');

    const out = applySelect(MASTODON_FIXTURE, m.source.select) as Record<string, unknown>;

    // First-status projections — the 1x2 header binds `account`, the 2x2
    // adds `created` as a caption line under it.
    expect(out.account).toBe('Ada Lovelace');
    expect(out.created).toBe('2026-07-09T08:42:18.000Z');
    expect(out.content).toBe('<p>Shipping a new widget today!</p>');
    // Wildcard projection — the list layouts bind `statuses` directly.
    expect(Array.isArray(out.statuses)).toBe(true);
    expect((out.statuses as unknown[]).length).toBe(3);
  });

  it('the empty egress allowlist triggers the unrestricted install-time notice', () => {
    // Same rationale as the `rss` widget: the URL is templated from user
    // config, so we cannot pin a static host. The install prompt must
    // surface this so the user understands the widget can reach any
    // public Mastodon instance.
    const m = validateManifest(mastodonManifest);
    const notices = describeCapabilities(m);
    const unrestricted = notices.find((n) => n.kind === EGRESS_UNRESTRICTED);
    expect(unrestricted).toBeDefined();
  });

  it('the sample-data fixture is shape-compatible with the post-select shape', () => {
    const sample = SAMPLE_DATA['mastodon-feed'] as Record<string, unknown>;
    expect(sample).toEqual(
      expect.objectContaining({
        account: expect.any(String),
        created: expect.any(String),
        content: expect.any(String),
        statuses: expect.any(Array),
      }),
    );
    expect((sample.statuses as unknown[]).length).toBeGreaterThan(0);
    // And the registry entry matches the exported constant.
    expect(sample).toEqual(mastodonSample);
  });
});