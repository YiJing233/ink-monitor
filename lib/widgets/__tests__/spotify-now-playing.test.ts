/**
 * Tests for the Phase 2 `spotify-now-playing` built-in. The manifest is
 * `http`-backed and needs a live `SPOTIFY_TOKEN` to actually fetch; these
 * tests verify the *contract* the renderer depends on without a network call:
 *   1. Validate the manifest against the IR schema (families, source kind,
 *      egress allowlist, declared secrets, Bearer wiring).
 *   2. Feed a hand-built Spotify `GET /v1/me/player/currently-playing`
 *      response through `applySelect` and assert the four binds the
 *      layouts read.
 *   3. Confirm the sample-data fixture (used by `/preview` when no token
 *      is configured) carries the same shape as the post-`applySelect`
 *      output.
 */
import { describe, it, expect } from 'vitest';
import { validateManifest } from '../ir';
import spotifyManifest from '../manifests/spotify-now-playing.json';
import { SAMPLE_DATA, spotifySample } from '../manifests/sample-data';
import { applySelect } from '../select';

/** Realistic subset of the Spotify `/v1/me/player/currently-playing`
 *  payload. Only the fields the manifest's `select` map references are
 *  populated; downstream `applySelect` ignores the rest. */
const SPOTIFY_FIXTURE = {
  is_playing: true,
  progress_ms: 124000,
  item: {
    name: 'Bohemian Rhapsody',
    duration_ms: 354000,
    artists: [{ name: 'Queen' }, { name: 'Queen & David Bowie' }],
    album: {
      name: 'A Night at the Opera',
      release_date: '1975-11-21',
    },
  },
};

describe('spotify-now-playing built-in', () => {
  it('validates against the IR schema with the expected source + families', () => {
    const m = validateManifest(spotifyManifest);
    expect(m.id).toBe('spotify-now-playing');
    expect(m.version).toBe('0.1.0');
    expect(m.source).toMatchObject({ kind: 'http' });
    expect(m.families).toEqual(['1x1', '2x2', '4x2']);
    // Egress is pinned to the Spotify Web API host — a future maintainer
    // cannot widen the URL to a Spotify-themed phishing mirror without
    // tripping this assertion.
    expect(m.capabilities?.egress).toEqual(['api.spotify.com']);
    // Bearer wiring on the source so the manifest can't silently down-grade
    // to an unauthenticated call (Spotify's player endpoint 401s without it).
    expect(m.capabilities?.secrets).toEqual(['SPOTIFY_TOKEN']);
    if (m.source.kind !== 'http') throw new Error('expected http source');
    expect(m.source.auth).toEqual({ type: 'bearer', secret: 'SPOTIFY_TOKEN' });
  });

  it('applySelect on a Spotify now-playing payload yields title / artist / album / is_playing', () => {
    const m = validateManifest(spotifyManifest);
    if (m.source.kind !== 'http') throw new Error('expected http source');

    const out = applySelect(SPOTIFY_FIXTURE, m.source.select) as Record<string, unknown>;

    // The 1x1 col binds title (size=title) + artist. The 2x2 col adds album.
    // The 4x2 header row binds title + is_playing. Every layout reads at
    // least one of these.
    expect(out.title).toBe('Bohemian Rhapsody');
    expect(out.artist).toBe('Queen'); // item.artists[0].name — first artist only
    expect(out.album).toBe('A Night at the Opera');
    expect(out.is_playing).toBe(true);
  });

  it('the sample-data fixture is shape-compatible with the post-select shape', () => {
    // The /preview route substitutes SAMPLE_DATA[id] when the user has not
    // configured a live SPOTIFY_TOKEN, so it must carry every key the
    // layout binds to (title, artist, album, is_playing).
    const sample = SAMPLE_DATA['spotify-now-playing'] as Record<string, unknown>;
    expect(sample).toEqual(
      expect.objectContaining({
        title: expect.any(String),
        artist: expect.any(String),
        album: expect.any(String),
        is_playing: expect.any(Boolean),
      }),
    );
    // And the registry entry matches the exported constant — guards against
    // the two drifting if a future refactor moves one but not the other.
    expect(sample).toEqual(spotifySample);
  });
});