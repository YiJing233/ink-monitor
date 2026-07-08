import { describe, it, expect } from 'vitest';
import { describeCapabilities, requiredSecrets } from '../capabilities';
import { BUILTIN_MANIFESTS } from '../registry';
import { EGRESS_UNRESTRICTED } from '../registry-meta';
import type { Manifest } from '../ir';

describe('describeCapabilities', () => {
  it('surfaces egress + secret for an http widget (todo-lark)', () => {
    const notices = describeCapabilities(BUILTIN_MANIFESTS['todo-lark']);
    const kinds = notices.map((n) => n.kind);
    expect(kinds).toContain('source');
    expect(notices.some((n) => n.kind === 'egress' && n.text.includes('open.feishu.cn'))).toBe(true);
    expect(notices.some((n) => n.kind === 'secret' && n.text.includes('LARK_TENANT_TOKEN'))).toBe(true);
    expect(requiredSecrets(BUILTIN_MANIFESTS['todo-lark'])).toEqual(['LARK_TENANT_TOKEN']);
    // todo-lark declares its egress explicitly → no "unrestricted" warning.
    expect(notices.some((n) => n.kind === EGRESS_UNRESTRICTED)).toBe(false);
  });

  it('reports a builtin source and no secrets (stocks-table)', () => {
    const notices = describeCapabilities(BUILTIN_MANIFESTS['stocks-table']);
    expect(notices.some((n) => n.kind === 'source' && n.text.includes('stocks'))).toBe(true);
    expect(notices.some((n) => n.kind === 'secret')).toBe(false);
    expect(requiredSecrets(BUILTIN_MANIFESTS['stocks-table'])).toEqual([]);
  });

  it('warns when an http source has no egress allowlist (unrestricted)', () => {
    const m = {
      v: 1 as const,
      id: 'no-egress',
      name: 'No Egress',
      description: 'http source without capabilities.egress',
      source: {
        kind: 'http' as const,
        url: 'https://example.com/data',
        auth: { type: 'none' as const },
      },
      families: ['1x1' as const],
      layout: { '1x1': { t: 'text' as const, value: '' } },
      capabilities: {},
    } satisfies Manifest;

    const notices = describeCapabilities(m);
    const warn = notices.find((n) => n.kind === EGRESS_UNRESTRICTED);
    expect(warn, 'expected an unrestricted-egress notice').toBeDefined();
    expect(warn!.text).toContain('未声明');
    expect(warn!.text.toLowerCase()).toContain('unrestricted');
    // The warn should not appear for a non-http source even with no egress.
    const builtin = { ...m, source: { kind: 'builtin' as const, ref: 'demo' } };
    expect(describeCapabilities(builtin).some((n) => n.kind === EGRESS_UNRESTRICTED)).toBe(false);
  });

  it('does NOT warn when capabilities.egress is a non-empty allowlist', () => {
    const m = {
      v: 1 as const,
      id: 'with-egress',
      name: 'With Egress',
      source: {
        kind: 'http' as const,
        url: 'https://api.example.com/',
        auth: { type: 'none' as const },
      },
      families: ['1x1' as const],
      layout: { '1x1': { t: 'text' as const, value: '' } },
      capabilities: { egress: ['api.example.com'] },
    } satisfies Manifest;
    expect(describeCapabilities(m).some((n) => n.kind === EGRESS_UNRESTRICTED)).toBe(false);
  });
});
