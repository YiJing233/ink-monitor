/**
 * Tests for the Phase 2 `plex-now-playing` built-in. The manifest is `http`-
 * backed, uses a templated `headers` map (the IR extension under test), and
 * needs a live `PLEX_TOKEN` (sent via Plex's `X-Plex-Token` header — NOT a
 * Bearer). The server host is per-instance config (`{{host}}`):
 *   1. Validate the manifest against the IR schema (families, source kind,
 *      egress allowlist, declared secrets, templated headers + host).
 *   2. Confirm `capabilities.egress: ["{{host}}"]` triggers the install-time
 *      `unrestricted` warning — every entry is a `{{VAR}}` template so the
 *      safe-fetch allowlist check cannot actually confine egress.
 *   3. Feed a hand-built Plex `GET /status/sessions` payload through
 *      `applySelect` and assert the two binds both layouts read.
 *   4. Confirm the sample-data fixture (used by `/preview` when no token is
 *      configured) carries the same shape as the post-`applySelect` output.
 *   5. Confirm the templated `X-Plex-Token` header survives manifest validation
 *      untouched so the Source layer's `{{PLEX_TOKEN}}` substitution can fire.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest, type Node } from '../ir';
import { describeCapabilities, egressIsTemplated } from '../capabilities';
import plexManifest from '../manifests/plex-now-playing.json';
import { SAMPLE_DATA, plexSample } from '../manifests/sample-data';
import { applySelect } from '../select';

/** Realistic subset of the Plex `/status/sessions` payload when at least one
 *  session is active. Only the fields the manifest's `select` references
 *  are populated. */
const PLEX_FIXTURE = {
  MediaContainer: {
    size: 1,
    Metadata: [
      {
        title: 'Dune: Part Two',
        type: 'movie',
      },
    ],
  },
};

describe('plex-now-playing built-in', () => {
  it('validates against the IR schema with the expected source + families', () => {
    const m = validateManifest(plexManifest);
    expect(m.id).toBe('plex-now-playing');
    expect(m.version).toBe('0.1.0');
    expect(m.source).toMatchObject({ kind: 'http' });
    expect(m.families).toEqual(['1x1', '2x2']);
    expect(m.capabilities?.secrets).toEqual(['PLEX_TOKEN']);
    if (m.source.kind !== 'http') throw new Error('expected http source');
    // Plex authenticates via the `X-Plex-Token` header, NOT Bearer — the
    // manifest declares it through the new templated `headers` field.
    expect(m.source.auth).toEqual({ type: 'none' });
    expect(m.source.headers).toEqual({ 'X-Plex-Token': '{{PLEX_TOKEN}}' });
    // Host is per-instance config.
    expect(m.source.url).toContain('{{host}}');
    expect(m.source.url).toContain(':32400');
  });

  it('triggers the unrestricted egress warning because every entry is templated', () => {
    const m = validateManifest(plexManifest);
    // Every egress entry is a {{VAR}} template — the allowlist check happens
    // against a hostname the safe-fetch layer never sees.
    expect(m.capabilities?.egress).toEqual(['{{host}}']);
    expect(m.capabilities!.egress!.every(egressIsTemplated)).toBe(true);

    const notices = describeCapabilities(m);
    expect(notices.some((n) => n.kind === 'unrestricted')).toBe(true);
  });

  it('applySelect on a Plex sessions payload yields title / type', () => {
    const m = validateManifest(plexManifest);
    if (m.source.kind !== 'http') throw new Error('expected http source');

    const out = applySelect(PLEX_FIXTURE, m.source.select) as Record<string, unknown>;

    // Both layouts bind `title` and `type`.
    expect(out.title).toBe('Dune: Part Two');
    expect(out.type).toBe('movie');
  });

  it('the sample-data fixture is shape-compatible with the post-select shape', () => {
    const sample = SAMPLE_DATA['plex-now-playing'] as Record<string, unknown>;
    expect(sample).toEqual(
      expect.objectContaining({
        title: expect.any(String),
        type: expect.any(String),
      }),
    );
    expect(sample).toEqual(plexSample);
  });

  it('both layouts are valid Node trees', () => {
    const m = validateManifest(plexManifest);
    const oneByOne = m.layout['1x1'] as Node;
    expect(oneByOne.t).toBe('col');
    if (oneByOne.t !== 'col') throw new Error('expected col');
    expect(oneByOne.children).toHaveLength(2);
    // The first child is the title text; the second is the caption-sized type.
    expect(oneByOne.children[0].t).toBe('text');
    expect(oneByOne.children[1].t).toBe('text');

    const twoByTwo = m.layout['2x2'] as Node;
    expect(twoByTwo.t).toBe('col');
    if (twoByTwo.t !== 'col') throw new Error('expected col');
    expect(twoByTwo.children).toHaveLength(2);
    // 2x2 uses a larger title above a caption-sized type.
    const first = twoByTwo.children[0];
    const second = twoByTwo.children[1];
    expect(first.t).toBe('text');
    expect(second.t).toBe('text');
    if (first.t !== 'text' || second.t !== 'text') throw new Error('expected text');
    expect(first.size).toBe('title');
    expect(second.size).toBe('caption');
  });
});