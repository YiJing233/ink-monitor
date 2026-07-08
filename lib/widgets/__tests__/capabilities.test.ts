import { describe, it, expect } from 'vitest';
import { describeCapabilities, requiredSecrets } from '../capabilities';
import { BUILTIN_MANIFESTS } from '../registry';

describe('describeCapabilities', () => {
  it('surfaces egress + secret for an http widget (todo-lark)', () => {
    const notices = describeCapabilities(BUILTIN_MANIFESTS['todo-lark']);
    const kinds = notices.map((n) => n.kind);
    expect(kinds).toContain('source');
    expect(notices.some((n) => n.kind === 'egress' && n.text.includes('open.feishu.cn'))).toBe(true);
    expect(notices.some((n) => n.kind === 'secret' && n.text.includes('LARK_TENANT_TOKEN'))).toBe(true);
    expect(requiredSecrets(BUILTIN_MANIFESTS['todo-lark'])).toEqual(['LARK_TENANT_TOKEN']);
  });

  it('reports a builtin source and no secrets (stocks-table)', () => {
    const notices = describeCapabilities(BUILTIN_MANIFESTS['stocks-table']);
    expect(notices.some((n) => n.kind === 'source' && n.text.includes('stocks'))).toBe(true);
    expect(notices.some((n) => n.kind === 'secret')).toBe(false);
    expect(requiredSecrets(BUILTIN_MANIFESTS['stocks-table'])).toEqual([]);
  });
});
