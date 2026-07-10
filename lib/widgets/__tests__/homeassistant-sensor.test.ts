/**
 * Tests for the Phase 2 `homeassistant-sensor` built-in. The manifest is
 * `http`-backed, uses a templated `headers` map (the IR extension under
 * test) carrying `Authorization: Bearer {{HASS_TOKEN}}`, and the server
 * host is per-instance config (`{{host}}`):
 *   1. Validate the manifest against the IR schema (families, source kind,
 *      egress allowlist, declared secrets, templated Bearer header).
 *   2. Confirm `capabilities.egress: ["{{host}}"]` triggers the install-time
 *      `unrestricted` warning (the templated-egress detector).
 *   3. Feed a hand-built Home Assistant `GET /api/states/{entity_id}` payload
 *      through `applySelect` and assert the three binds both layouts read.
 *   4. Confirm the sample-data fixture (used by `/preview` when no token is
 *      configured) carries the same shape as the post-`applySelect` output.
 *   5. Confirm `bignum.unit` accepts a Bind (`{ "$": "unit" }`) — the IR
 *      extension under test — and renders the API-reported unit inline with
 *      the bignum value.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest, type Node } from '../ir';
import { describeCapabilities, egressIsTemplated } from '../capabilities';
import hassManifest from '../manifests/homeassistant-sensor.json';
import { SAMPLE_DATA, homeassistantSample } from '../manifests/sample-data';
import { applySelect } from '../select';

/** Realistic subset of the Home Assistant `/api/states/{entity_id}` payload.
 *  Only the fields the manifest's `select` map references are populated. */
const HASS_FIXTURE = {
  entity_id: 'sensor.living_room_temperature',
  state: '21.4',
  attributes: {
    unit_of_measurement: '°C',
    friendly_name: 'Living Room Temperature',
    device_class: 'temperature',
  },
  last_changed: '2026-07-10T08:00:00+00:00',
};

describe('homeassistant-sensor built-in', () => {
  it('validates against the IR schema with the expected source + families', () => {
    const m = validateManifest(hassManifest);
    expect(m.id).toBe('homeassistant-sensor');
    expect(m.version).toBe('0.1.0');
    expect(m.source).toMatchObject({ kind: 'http' });
    expect(m.families).toEqual(['1x1', '2x2']);
    expect(m.capabilities?.secrets).toEqual(['HASS_TOKEN']);
    if (m.source.kind !== 'http') throw new Error('expected http source');
    // The new templated `headers` field carries the Bearer token inline — the
    // manifest author chose `auth: { type: 'none' }` and the explicit
    // Authorization header over the auth-type enum (which would also have
    // worked, but the headers path is more legible to a user reading the
    // manifest).
    expect(m.source.auth).toEqual({ type: 'none' });
    expect(m.source.headers).toEqual({ Authorization: 'Bearer {{HASS_TOKEN}}' });
    // Host + entity_id are per-instance config.
    expect(m.source.url).toContain('{{host}}');
    expect(m.source.url).toContain('{{entity_id}}');
    expect(m.source.url).toContain(':8123');
  });

  it('triggers the unrestricted egress warning because every entry is templated', () => {
    const m = validateManifest(hassManifest);
    expect(m.capabilities?.egress).toEqual(['{{host}}']);
    expect(m.capabilities!.egress!.every(egressIsTemplated)).toBe(true);

    const notices = describeCapabilities(m);
    expect(notices.some((n) => n.kind === 'unrestricted')).toBe(true);
  });

  it('applySelect on a Home Assistant states payload yields state / unit / name', () => {
    const m = validateManifest(hassManifest);
    if (m.source.kind !== 'http') throw new Error('expected http source');

    const out = applySelect(HASS_FIXTURE, m.source.select) as Record<string, unknown>;

    // 1x1 binds `state` (bignum) and `unit` (Bind). 2x2 adds `name` as a
    // caption-sized text.
    expect(out.state).toBe('21.4');
    expect(out.unit).toBe('°C');
    expect(out.name).toBe('Living Room Temperature');
  });

  it('the sample-data fixture is shape-compatible with the post-select shape', () => {
    const sample = SAMPLE_DATA['homeassistant-sensor'] as Record<string, unknown>;
    expect(sample).toEqual(
      expect.objectContaining({
        state: expect.any(String),
        unit: expect.any(String),
        name: expect.any(String),
      }),
    );
    expect(sample).toEqual(homeassistantSample);
  });

  it('both layouts bind `bignum.unit` as a Bind to the API-reported unit', () => {
    const m = validateManifest(hassManifest);

    const oneByOne = m.layout['1x1'] as Node;
    expect(oneByOne.t).toBe('bignum');
    if (oneByOne.t !== 'bignum') throw new Error('expected bignum');
    // The IR extension: bignum.unit is a Bind, not just a string.
    expect(oneByOne.unit).toEqual({ $: 'unit' });

    const twoByTwo = m.layout['2x2'] as Node;
    expect(twoByTwo.t).toBe('col');
    if (twoByTwo.t !== 'col') throw new Error('expected col');
    const firstChild = twoByTwo.children[0];
    expect(firstChild.t).toBe('bignum');
    if (firstChild.t !== 'bignum') throw new Error('expected bignum');
    expect(firstChild.unit).toEqual({ $: 'unit' });
  });
});