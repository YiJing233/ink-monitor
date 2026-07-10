/**
 * Tests for the http-source `headers` field (IR extension). The Plex and Home
 * Assistant built-ins need templated headers that the fixed `auth` enum can't
 * express (Plex's `X-Plex-Token: <raw>` header, Home Assistant's `Authorization:
 * Bearer <token>` header). This test verifies the Source layer interpolates
 * {{VAR}} in BOTH header names and header values, and that manifest-declared
 * headers layer on top of auth-derived headers without colliding.
 *
 * Mirrors the structure of `http-body.test.ts` — mocks safe-fetch + crypto +
 * db so the test doesn't open sockets.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveSource } from '../source';
import { validateManifest } from '../ir';

const safeFetchMock = vi.fn(async (_url: string, opts: any = {}) => ({
  ok: true,
  status: 200,
  bytes: Buffer.from(JSON.stringify({ ok: true, headers_seen: opts.headers })),
  contentType: 'application/json',
}));

vi.mock('../safe-fetch', () => ({
  safeFetch: (url: string, opts: any) => safeFetchMock(url, opts),
}));

vi.mock('../../crypto', () => ({
  decryptForUser: (_u: string, enc: string) => `decrypted:${enc}`,
}));

vi.mock('../../db', () => ({
  getWidgetSecret: (_u: string, name: string) => (name === 'PLEX_TOKEN' ? 'encrypted-plex' : null),
  getOwnedState: () => null,
  listWidgets: () => [],
}));

const baseHttpManifest = (overrides: Record<string, unknown> = {}) =>
  validateManifest({
    v: 1,
    id: 'http-headers-test',
    name: 'http headers test',
    source: {
      kind: 'http',
      url: 'https://example.com/x',
      ...overrides,
    },
    families: ['1x1'],
    layout: { '1x1': { t: 'text', value: 'ok' } },
    // The Source layer reads declared secrets from capabilities.secrets so a
    // manifest whose auth is carried in templated `headers` (not in `auth`)
    // can still inject the secret value into the variable scope.
    capabilities: { secrets: ['PLEX_TOKEN'], writes: false },
  });

beforeEach(() => {
  safeFetchMock.mockClear();
});

describe('http source — templated headers (F-extension)', () => {
  it('substitutes {{VAR}} in header values from config + secrets', async () => {
    const manifest = baseHttpManifest({
      headers: { 'X-Plex-Token': '{{PLEX_TOKEN}}' },
      // auth: none so the Source layer doesn't ALSO set Authorization —
      // we want to isolate the headers path.
      auth: { type: 'none' },
    });
    await resolveSource(manifest, {}, { userId: 'u1' });

    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    const [_url, opts] = safeFetchMock.mock.calls[0]!;
    // The Plex token decrypts to `decrypted:encrypted-plex`.
    expect(opts.headers['X-Plex-Token']).toBe('decrypted:encrypted-plex');
    // Accept: application/json is always present.
    expect(opts.headers['Accept']).toBe('application/json');
  });

  it('substitutes {{VAR}} in the header NAME from config (dynamic header key)', async () => {
    const manifest = baseHttpManifest({
      headers: { 'X-{{tag}}': 'static-value' },
      auth: { type: 'none' },
    });
    await resolveSource(manifest, { tag: 'Tenant' }, { userId: 'u1' });

    const [_url, opts] = safeFetchMock.mock.calls[0]!;
    // The header key itself was templated.
    expect(opts.headers['X-Tenant']).toBe('static-value');
  });

  it('layers headers on top of bearer-auth without losing the Authorization header', async () => {
    // Bearer auth sets `Authorization: Bearer <secret>`. A manifest that adds
    // a custom header (e.g. a tenant ID) should keep the bearer Authorization.
    const manifest = baseHttpManifest({
      auth: { type: 'bearer', secret: 'PLEX_TOKEN' },
      headers: { 'X-Tenant': '{{tenant}}' },
    });
    await resolveSource(manifest, { tenant: 'acme' }, { userId: 'u1' });

    const [_url, opts] = safeFetchMock.mock.calls[0]!;
    expect(opts.headers['Authorization']).toBe('Bearer decrypted:encrypted-plex');
    expect(opts.headers['X-Tenant']).toBe('acme');
  });

  it('leaves the headers map untouched when none is declared (backward-compatible)', async () => {
    const manifest = baseHttpManifest({ auth: { type: 'none' } });
    await resolveSource(manifest, {}, { userId: 'u1' });

    const [_url, opts] = safeFetchMock.mock.calls[0]!;
    // Only Accept + nothing else when no auth + no headers.
    expect(opts.headers).toEqual({ Accept: 'application/json' });
  });
});