/**
 * Tests for the IR extensions introduced alongside the `plex-now-playing` and
 * `homeassistant-sensor` built-ins:
 *   - http `source.headers` — a record of static + `{{VAR}}` templated
 *     key/value pairs the Source layer interpolates with the same variable
 *     scope as the URL / body.
 *   - `bignum.unit` accepts a Bind (so a layout can render a server-side
 *     dynamic unit, e.g. Home Assistant's `attributes.unit_of_measurement`,
 *     inline with the value).
 *   - `egressIsTemplated` + the updated `describeCapabilities` — an egress
 *     allowlist whose every entry is a `{{VAR}}` template cannot actually
 *     confine egress (the safe-fetch layer never sees the resolved host),
 *     so the install prompt must surface the unrestricted warning.
 *
 * The existing `bignum` test (string unit) is still valid — the Bind union
 * is a strict superset of the previous `unit?: string` schema.
 */
import { describe, it, expect } from 'vitest';
import { ManifestSchema, validateManifest, type Node } from '../ir';
import { describeCapabilities, egressIsTemplated } from '../capabilities';

/** Minimal valid manifest factory. Each test overrides the fields it needs. */
const baseHttpManifest = (overrides: Record<string, unknown> = {}) => ({
  v: 1,
  id: 'ir-ext-test',
  name: 'IR extension test',
  source: { kind: 'http' as const, url: 'https://example.com/x' },
  families: ['1x1'],
  layout: { '1x1': { t: 'text' as const, value: 'hi' } },
  ...overrides,
});

describe('IR — http source headers field', () => {
  it('accepts an http source with no headers (backward-compatible)', () => {
    const m = ManifestSchema.parse(baseHttpManifest());
    if (m.source.kind !== 'http') throw new Error('expected http source');
    expect(m.source.headers).toBeUndefined();
  });

  it('accepts static (non-templated) header values', () => {
    const m = ManifestSchema.parse(
      baseHttpManifest({
        source: {
          kind: 'http',
          url: 'https://example.com/x',
          headers: { 'X-Static': 'value' },
        },
      }),
    );
    if (m.source.kind !== 'http') throw new Error('expected http source');
    expect(m.source.headers).toEqual({ 'X-Static': 'value' });
  });

  it('accepts templated header names AND values', () => {
    const m = ManifestSchema.parse(
      baseHttpManifest({
        source: {
          kind: 'http',
          url: 'https://{{host}}/x',
          headers: {
            Authorization: 'Bearer {{TOKEN}}',
            'X-{{tag}}': '{{value}}',
          },
        },
      }),
    );
    if (m.source.kind !== 'http') throw new Error('expected http source');
    expect(m.source.headers).toEqual({
      Authorization: 'Bearer {{TOKEN}}',
      'X-{{tag}}': '{{value}}',
    });
  });

  it('rejects a header value that is not a string', () => {
    // Numbers / booleans in the headers map would silently render as
    // "[object Object]" after String coercion — the schema refuses them.
    const result = ManifestSchema.safeParse(
      baseHttpManifest({
        source: {
          kind: 'http',
          url: 'https://example.com/x',
          headers: { Authorization: 42 } as unknown as Record<string, string>,
        },
      }),
    );
    expect(result.success).toBe(false);
  });
});

describe('IR — bignum.unit as Bind', () => {
  it('still accepts a plain string unit (backward-compatible)', () => {
    const m = ManifestSchema.parse(
      baseHttpManifest({
        layout: { '1x1': { t: 'bignum', value: 42, unit: 'steps' } },
      }),
    );
    const n = m.layout['1x1'] as Node;
    expect(n.t).toBe('bignum');
    if (n.t !== 'bignum') throw new Error('expected bignum');
    expect(n.unit).toBe('steps');
  });

  it('accepts a literal numeric Bind for unit (e.g. a numeric ID)', () => {
    const m = ManifestSchema.parse(
      baseHttpManifest({
        layout: { '1x1': { t: 'bignum', value: 7, unit: 42 } },
      }),
    );
    const n = m.layout['1x1'] as Node;
    if (n.t !== 'bignum') throw new Error('expected bignum');
    expect(n.unit).toBe(42);
  });

  it('accepts a reference Bind for unit (the homeassistant-sensor pattern)', () => {
    const m = ManifestSchema.parse(
      baseHttpManifest({
        layout: { '1x1': { t: 'bignum', value: { $: 'state' }, unit: { $: 'unit' } } },
      }),
    );
    const n = m.layout['1x1'] as Node;
    if (n.t !== 'bignum') throw new Error('expected bignum');
    expect(n.unit).toEqual({ $: 'unit' });
  });
});

describe('IR — templated egress detection (capabilities)', () => {
  it('egressIsTemplated detects {{VAR}} placeholders', () => {
    expect(egressIsTemplated('{{host}}')).toBe(true);
    expect(egressIsTemplated('api.{{suffix}}.com')).toBe(true);
    expect(egressIsTemplated('api.fitbit.com')).toBe(false);
    expect(egressIsTemplated('')).toBe(false);
  });

  it('surfaces an unrestricted notice when every egress entry is templated', () => {
    const m = validateManifest(
      baseHttpManifest({
        source: {
          kind: 'http',
          url: 'http://{{host}}:32400/status/sessions',
          headers: { 'X-Plex-Token': '{{PLEX_TOKEN}}' },
        },
        capabilities: { egress: ['{{host}}'], secrets: ['PLEX_TOKEN'], writes: false },
      }),
    );
    const notices = describeCapabilities(m);
    expect(notices.some((n) => n.kind === 'unrestricted')).toBe(true);
  });

  it('still surfaces the unrestricted notice when egress is empty', () => {
    const m = validateManifest(baseHttpManifest());
    const notices = describeCapabilities(m);
    expect(notices.some((n) => n.kind === 'unrestricted')).toBe(true);
  });

  it('does NOT surface the unrestricted notice when egress contains at least one static entry', () => {
    // A mixed allowlist (one static + one templated) is still partial; the
    // safe-fetch layer enforces the static entry, and the install prompt lists
    // the static entry by name — no unrestricted warning.
    const m = validateManifest(
      baseHttpManifest({
        capabilities: { egress: ['api.fitbit.com'], secrets: [], writes: false },
      }),
    );
    const notices = describeCapabilities(m);
    expect(notices.some((n) => n.kind === 'unrestricted')).toBe(false);
  });
});