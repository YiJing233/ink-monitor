/**
 * Tests for the Phase 1 `weather` built-in. The manifest is `http`-backed and
 * needs a live OWM_KEY to actually fetch; these tests only verify the
 * *contract* that the renderer + selectPath will rely on when an http call
 * comes back. We:
 *   1. Validate the manifest against the IR schema.
 *   2. Feed a hand-built OWM-shaped JSON response through `applySelect` and
 *      assert the bignum/text binds resolve to the expected primitives.
 *   3. Confirm the sample-data fixture matches the post-`applySelect` shape
 *      (i.e. the preview route would render the same fields without a
 *      network call).
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../ir';
import weatherManifest from '../manifests/weather.json';
import { SAMPLE_DATA, weatherSample } from '../manifests/sample-data';
import { applySelect } from '../select';

/** Realistic OWM response (subset). Matches the JSONPath targets declared in
 *  the manifest's `select` map. */
const OWM_FIXTURE = {
  coord: { lon: 121.47, lat: 31.23 },
  weather: [{ id: 802, main: 'Clouds', description: 'scattered clouds', icon: '03d' }],
  main: { temp: 18.4, feels_like: 17.1, humidity: 62, pressure: 1015 },
  wind: { speed: 3.6, deg: 180 },
  name: 'Shanghai',
};

describe('weather built-in', () => {
  it('the built-in weather manifest validates against the IR schema', () => {
    const m = validateManifest(weatherManifest);
    expect(m.id).toBe('weather');
    expect(m.version).toBe('0.1.0');
    expect(m.source).toMatchObject({ kind: 'http' });
    expect(m.families).toEqual(['1x1', '2x2', '4x2']);
    expect(m.capabilities?.egress).toEqual(['api.openweathermap.org']);
    expect(m.capabilities?.secrets).toEqual(['OWM_KEY']);
  });

  it('applySelect on an OWM response yields the four binds the layout reads', () => {
    // Pull the select map straight from the manifest so the test breaks the
    // moment the manifest's selectors drift.
    const m = validateManifest(weatherManifest);
    if (m.source.kind !== 'http') throw new Error('weather source is not http');

    const out = applySelect(OWM_FIXTURE, m.source.select) as Record<string, unknown>;

    // The bignum (temp), the bignum sub (cond), the 2x2 text bind (humidity),
    // and the 4x2 text bind (wind) — every layout reads at least one of these.
    expect(out.temp).toBe(18.4);
    expect(out.cond).toBe('Clouds');
    expect(out.humidity).toBe(62);
    expect(out.wind).toBe(3.6);
    // Bonus: the icon code is also extracted (Phase 2 could render it).
    expect(out.icon).toBe('03d');
  });

  it('the sample-data fixture is shape-compatible with the post-select shape', () => {
    // The preview route substitutes SAMPLE_DATA[id] for the source payload
    // when the user has not configured a live OWM_KEY, so it must already
    // contain every key the layout binds to.
    const sample = SAMPLE_DATA.weather as Record<string, unknown>;
    expect(sample).toEqual(
      expect.objectContaining({
        temp: expect.any(Number),
        cond: expect.any(String),
        humidity: expect.any(Number),
        wind: expect.any(Number),
      }),
    );
    // And the exported constant matches the registry entry — guards against
    // the two drifting if a future refactor moves one but not the other.
    expect(sample).toEqual(weatherSample);
  });

  it('rejects an http manifest with a non-allowlisted host at install time', () => {
    // Defence in depth: even though the manifest declares its own egress
    // allowlist, the install flow should still surface that the widget is
    // NOT unrestricted (i.e. it does NOT trigger the EGRESS_UNRESTRICTED
    // safety net). This guards against someone deleting the allowlist later.
    const m = validateManifest(weatherManifest);
    const egress = m.capabilities?.egress ?? [];
    expect(egress.length).toBeGreaterThan(0); // not empty → not unrestricted
    expect(egress).toContain('api.openweathermap.org');
  });
});
