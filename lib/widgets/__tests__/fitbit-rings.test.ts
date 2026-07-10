/**
 * Tests for the Phase 2 `fitbit-rings` built-in. The manifest is `http`-backed
 * and needs a live `FITBIT_TOKEN` Bearer; these tests verify the contract the
 * renderer depends on without a network call:
 *   1. Validate the manifest against the IR schema (families, source kind,
 *      egress allowlist, declared secrets, Bearer wiring).
 *   2. Feed a hand-built Fitbit `GET /1/user/-/activities/date/{date}.json`
 *      payload through `applySelect` and assert the three binds the layout
 *      reads.
 *   3. Confirm the sample-data fixture (used by `/preview` when no token is
 *      configured) carries the same shape as the post-`applySelect` output.
 *   4. Confirm the bignum `unit` is the static string `steps` for both the
 *      1x1 and 2x2 layouts (Fitbit doesn't expose a dynamic unit — the
 *      renderer can resolve a static literal the same way it resolves a Bind).
 */
import { describe, it, expect } from 'vitest';
import { validateManifest, type Node } from '../ir';
import fitbitManifest from '../manifests/fitbit-rings.json';
import { SAMPLE_DATA, fitbitSample } from '../manifests/sample-data';
import { applySelect } from '../select';

/** Realistic subset of the Fitbit daily-activity payload. Only the fields
 *  the manifest's `select` map references are populated. */
const FITBIT_FIXTURE = {
  summary: {
    steps: 8421,
    caloriesOut: 2310,
    veryActiveMinutes: 47,
  },
  activities: [],
};

describe('fitbit-rings built-in', () => {
  it('validates against the IR schema with the expected source + families', () => {
    const m = validateManifest(fitbitManifest);
    expect(m.id).toBe('fitbit-rings');
    expect(m.version).toBe('0.1.0');
    expect(m.source).toMatchObject({ kind: 'http' });
    expect(m.families).toEqual(['1x1', '2x2']);
    // Egress pinned to the Fitbit API host.
    expect(m.capabilities?.egress).toEqual(['api.fitbit.com']);
    // Bearer wiring.
    expect(m.capabilities?.secrets).toEqual(['FITBIT_TOKEN']);
    if (m.source.kind !== 'http') throw new Error('expected http source');
    expect(m.source.auth).toEqual({ type: 'bearer', secret: 'FITBIT_TOKEN' });
    // Templated date — the per-instance config supplies today's date, so the
    // manifest itself never has to know what day it is.
    expect(m.source.url).toContain('{{date}}');
  });

  it('applySelect on a Fitbit daily payload yields steps / calories / active_minutes', () => {
    const m = validateManifest(fitbitManifest);
    if (m.source.kind !== 'http') throw new Error('expected http source');

    const out = applySelect(FITBIT_FIXTURE, m.source.select) as Record<string, unknown>;

    // The 1x1 bignum binds `steps` (with a static `unit: "steps"`); the 2x2
    // adds `calories` and `active_minutes` as `text` rows underneath.
    expect(out.steps).toBe(8421);
    expect(out.calories).toBe(2310);
    expect(out.active_minutes).toBe(47);
  });

  it('the sample-data fixture is shape-compatible with the post-select shape', () => {
    const sample = SAMPLE_DATA['fitbit-rings'] as Record<string, unknown>;
    expect(sample).toEqual(
      expect.objectContaining({
        steps: expect.any(Number),
        calories: expect.any(Number),
        active_minutes: expect.any(Number),
      }),
    );
    expect(sample).toEqual(fitbitSample);
  });

  it('both layouts bind a bignum with a static `steps` unit', () => {
    const m = validateManifest(fitbitManifest);

    const oneByOne = m.layout['1x1'] as Node;
    expect(oneByOne.t).toBe('bignum');
    if (oneByOne.t !== 'bignum') throw new Error('expected bignum');
    // Static string is still accepted (Bind union includes string).
    expect(oneByOne.unit).toBe('steps');

    const twoByTwo = m.layout['2x2'] as Node;
    expect(twoByTwo.t).toBe('col');
    if (twoByTwo.t !== 'col') throw new Error('expected col');
    const firstChild = twoByTwo.children[0];
    expect(firstChild.t).toBe('bignum');
    if (firstChild.t !== 'bignum') throw new Error('expected bignum');
    expect(firstChild.unit).toBe('steps');
  });
});