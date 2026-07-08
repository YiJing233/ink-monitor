/**
 * F7: POST body support for declarative http sources. We test the body
 * interpolation end-to-end (URL is unchanged from the http path) and the
 * "no body" default. The actual outbound HTTP is mocked.
 *
 * Mock paths must match the module specifier the *imported* module uses,
 * not the path from this test file. source.ts imports crypto/db via `'../crypto'`
 * and `'../db'` which resolve to `lib/crypto` and `lib/db` — so from this
 * test (in `lib/widgets/__tests__/`) those are `../../crypto` and `../../db`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateManifest } from '../ir';
import { resolveSource } from '../source';

// Mock the whole safe-fetch module so the test doesn't open sockets.
const safeFetchMock = vi.fn(async (_url: string, opts: any = {}) => ({
  ok: true,
  status: 200,
  bytes: Buffer.from(JSON.stringify({ ok: true, sent_body: opts.body, sent_method: opts.method })),
  contentType: 'application/json',
}));

vi.mock('../safe-fetch', () => ({
  safeFetch: (url: string, opts: any) => safeFetchMock(url, opts),
}));

vi.mock('../../crypto', () => ({
  decryptForUser: (_u: string, enc: string) => `decrypted:${enc}`,
}));

vi.mock('../../db', () => ({
  getWidgetSecret: (_u: string, name: string) => (name === 'API_KEY' ? 'encrypted-secret' : null),
  getOwnedState: () => null,
  listWidgets: () => [],
}));

const baseHttpManifest = (overrides: Record<string, unknown> = {}) =>
  validateManifest({
    v: 1,
    id: 'http-body-test',
    name: 'http body test',
    source: {
      kind: 'http',
      url: 'https://api.example.com/endpoint',
      method: 'POST',
      auth: { type: 'none', secret: 'API_KEY' },
      ...overrides,
    },
    families: ['1x1'],
    layout: { '1x1': { t: 'text', value: 'ok' } },
  });

beforeEach(() => {
  safeFetchMock.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('http source — body (F7)', () => {
  it('substitutes {{VAR}} in body from config + secrets', async () => {
    const manifest = baseHttpManifest({
      body: '{"q":"{{QUERY}}","token":"{{API_KEY}}","n":{{N}}}',
    });
    await resolveSource(manifest, { QUERY: 'hello', N: '42' }, { userId: 'u1' });

    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    const [_url, opts] = safeFetchMock.mock.calls[0]!;
    // Secret from crypto stub comes through as `decrypted:encrypted-secret`.
    expect(opts.body).toBe('{"q":"hello","token":"decrypted:encrypted-secret","n":42}');
    expect(opts.method).toBe('POST');
  });

  it('leaves body undefined and stays a GET when no body is declared', async () => {
    const manifest = baseHttpManifest(); // no body, no method override
    await resolveSource(manifest, {}, { userId: 'u1' });

    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    const [_url, opts] = safeFetchMock.mock.calls[0]!;
    expect(opts.body).toBeUndefined();
    expect(opts.method).toBe('POST'); // method from manifest, body omitted
  });
});