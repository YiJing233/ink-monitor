/**
 * Tests for the Phase 2 `strava` built-in. The manifest is `http`-backed and
 * requires a `STRAVA_TOKEN` Bearer; these tests verify the renderer /select
 * contract without a network call:
 *   1. Validate the manifest against the IR schema.
 *   2. Feed a hand-built `GET /athlete/activities?per_page=1` payload through
 *      `applySelect` and check the three binds the layouts read.
 *   3. Confirm the sample-data fixture matches the post-`applySelect` shape.
 *
 * Strava's `distance` field is always meters — the `unit: "m"` in the
 * manifest is the renderer hint, not a converter. A future enhancement could
 * pre-format via `formatNumber` (Phase 2 TODO), but a meters bignum is what
 * a regular Strava user expects.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../ir';
import stravaManifest from '../manifests/strava.json';
import { SAMPLE_DATA, stravaSample } from '../manifests/sample-data';
import { applySelect } from '../select';

/** Realistic subset of the Strava `/athlete/activities?per_page=1` payload.
 *  Most fields are irrelevant to the manifest's `select`, so they're omitted
 *  to keep the fixture readable. */
const STRAVA_FIXTURE = [
  {
    id: 9876543210,
    name: 'Morning Run',
    distance: 5210, // meters
    type: 'Run',
    start_date: '2026-07-09T05:30:00Z',
  },
];

describe('strava built-in', () => {
  it('validates against the IR schema with the expected source + families', () => {
    const m = validateManifest(stravaManifest);
    expect(m.id).toBe('strava');
    expect(m.version).toBe('0.1.0');
    expect(m.source).toMatchObject({ kind: 'http' });
    expect(m.families).toEqual(['1x1', '2x2']);
    // Egress is pinned to Strava — a future maintainer cannot widen the URL
    // template to an arbitrary mirror without tripping this assertion.
    expect(m.capabilities?.egress).toEqual(['www.strava.com']);
    // Bearer wiring on the source so the manifest can't silently down-grade
    // to an unauthenticated call (which Strava blocks entirely).
    expect(m.capabilities?.secrets).toEqual(['STRAVA_TOKEN']);
    if (m.source.kind !== 'http') throw new Error('expected http source');
    expect(m.source.auth).toEqual({ type: 'bearer', secret: 'STRAVA_TOKEN' });
  });

  it('applySelect on a Strava activities payload yields name / distance / type', () => {
    const m = validateManifest(stravaManifest);
    if (m.source.kind !== 'http') throw new Error('expected http source');

    const out = applySelect(STRAVA_FIXTURE, m.source.select) as Record<string, unknown>;

    // The 1x1 bignum binds `distance` (with `type` as the sub), the 2x2
    // adds `name` as a `text` node under the bignum.
    expect(out.distance).toBe(5210);
    expect(out.name).toBe('Morning Run');
    expect(out.type).toBe('Run');
  });

  it('the sample-data fixture is shape-compatible with the post-select shape', () => {
    // /preview substitutes SAMPLE_DATA[id] when the user has not configured a
    // STRAVA_TOKEN, so the fixture must carry every key the layout binds to.
    const sample = SAMPLE_DATA.strava as Record<string, unknown>;
    expect(sample).toEqual(
      expect.objectContaining({
        name: expect.any(String),
        distance: expect.any(Number),
        type: expect.any(String),
      }),
    );
    // And the registry's SAMPLE_DATA entry matches the exported constant —
    // guards against the two drifting if a future refactor moves one but
    // not the other.
    expect(sample).toEqual(stravaSample);
  });
});
