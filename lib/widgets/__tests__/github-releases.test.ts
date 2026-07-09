/**
 * Tests for the Phase 2 `github-releases` built-in. The manifest is `http`-backed
 * and needs a live `GITHUB_TOKEN` to actually fetch; these tests verify the
 * *contract* the renderer depends on by:
 *   1. Validating the manifest against the IR schema (families, source kind,
 *      egress allowlist, declared secrets).
 *   2. Feeding a hand-built GitHub `GET /repos/{owner}/{repo}/releases` response
 *      through `applySelect` and asserting the three binds the layout reads.
 *   3. Confirming the sample-data fixture (used by `/preview` when no token is
 *      configured) carries the same shape.
 *
 * Token / rate-limit considerations are out of scope here — that's a Phase 2
 * TODO list item: surface a friendly "rate-limited" placeholder when GitHub
 * returns 403 instead of letting the bignum render `items: []`.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../ir';
import githubReleasesManifest from '../manifests/github-releases.json';
import { SAMPLE_DATA, githubReleasesSample } from '../manifests/sample-data';
import { applySelect } from '../select';

/** Realistic subset of the GitHub releases payload. Only the fields the
 *  manifest's `select` map references are populated; downstream
 *  `applySelect` ignores the rest. */
const GITHUB_FIXTURE = [
  {
    url: 'https://api.github.com/repos/yi-jing-233/ink-monitor/releases/12345',
    tag_name: 'v0.3.1',
    name: 'v0.3.1 — markdown rendering fixes + new gallery tile',
    draft: false,
    prerelease: false,
    created_at: '2026-07-04T18:12:33Z',
    published_at: '2026-07-04T18:12:34Z',
  },
  {
    tag_name: 'v0.3.0',
    name: 'v0.3.0',
    published_at: '2026-06-20T10:00:00Z',
  },
];

describe('github-releases built-in', () => {
  it('validates against the IR schema with the expected source + families', () => {
    const m = validateManifest(githubReleasesManifest);
    expect(m.id).toBe('github-releases');
    expect(m.version).toBe('0.1.0');
    expect(m.source).toMatchObject({ kind: 'http' });
    expect(m.families).toEqual(['1x2', '2x2', '4x2']);
    // Egress is pinned to GitHub's API host — protects against a future
    // maintainer widening the URL template without updating the allowlist.
    expect(m.capabilities?.egress).toEqual(['api.github.com']);
    // The install prompt uses `capabilities.secrets` to know which secret
    // inputs to render. Assert the bearer wiring explicitly so the manifest
    // can't silently down-grade to an unauthenticated call.
    expect(m.capabilities?.secrets).toEqual(['GITHUB_TOKEN']);
    if (m.source.kind !== 'http') throw new Error('expected http source');
    expect(m.source.auth).toEqual({ type: 'bearer', secret: 'GITHUB_TOKEN' });
  });

  it('applySelect on a GitHub releases payload yields tag / name / published_at', () => {
    const m = validateManifest(githubReleasesManifest);
    if (m.source.kind !== 'http') throw new Error('expected http source');

    const out = applySelect(GITHUB_FIXTURE, m.source.select) as Record<string, unknown>;

    // The first entry's three fields. The 2x2/4x2 layouts bind these three
    // strings directly; the 1x2 layout binds `tag` only.
    expect(out.tag).toBe('v0.3.1');
    expect(out.name).toBe('v0.3.1 — markdown rendering fixes + new gallery tile');
    expect(out.published_at).toBe('2026-07-04T18:12:34Z');
  });

  it('the sample-data fixture is shape-compatible with the post-select shape', () => {
    // The /preview route substitutes SAMPLE_DATA[id] when the user has not
    // configured a live GITHUB_TOKEN, so it must contain every key the
    // layout binds to (tag, name, published_at).
    const sample = SAMPLE_DATA['github-releases'] as Record<string, unknown>;
    expect(sample).toEqual(
      expect.objectContaining({
        tag: expect.any(String),
        name: expect.any(String),
        published_at: expect.any(String),
      }),
    );
    // And the registry entry matches the exported constant — guards against
    // the two drifting if a future refactor moves one but not the other.
    expect(sample).toEqual(githubReleasesSample);
  });
});
