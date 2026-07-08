/**
 * Turn a manifest's declared source + capabilities into human-readable notices
 * for the install-time permission prompt. This is the safety surface: before a
 * user installs a shared widget, they see exactly what it will reach and need.
 *
 * Client-safe (pure).
 */
import type { Manifest } from './ir';
import { EGRESS_UNRESTRICTED } from './registry-meta';

export interface CapabilityNotice {
  kind: 'source' | 'egress' | 'secret' | 'write' | typeof EGRESS_UNRESTRICTED;
  text: string;
}

export function describeCapabilities(m: Manifest): CapabilityNotice[] {
  const out: CapabilityNotice[] = [];
  switch (m.source.kind) {
    case 'http':
      out.push({ kind: 'source', text: '通过网络请求获取数据' });
      break;
    case 'builtin':
      out.push({ kind: 'source', text: `使用内置数据源（${m.source.ref}）` });
      break;
    case 'owned':
      out.push({ kind: 'source', text: `读写平台存储（${m.source.store}）` });
      break;
    case 'asset':
      out.push({ kind: 'source', text: '显示图片（服务端抖动为 1-bit）' });
      break;
    case 'demo':
      out.push({ kind: 'source', text: '使用内置示例数据' });
      break;
  }
  for (const d of m.capabilities?.egress ?? []) out.push({ kind: 'egress', text: `访问外部域名：${d}` });
  for (const s of m.capabilities?.secrets ?? []) out.push({ kind: 'secret', text: `需要你的密钥：${s}` });
  if (m.capabilities?.writes) out.push({ kind: 'write', text: '会写入你的数据' });

  // Safety net: an http source with no egress allowlist is treated as "any
  // public host" by safe-fetch (hostAllowed returns true for an empty list).
  // Surface that prominently so the user is not surprised at install time.
  if (
    m.source.kind === 'http' &&
    (!m.capabilities?.egress || m.capabilities.egress.length === 0)
  ) {
    out.push({
      kind: EGRESS_UNRESTRICTED,
      text: '⚠ 未声明 egress（unrestricted）— 该 widget 可访问任意公网主机',
    });
  }

  return out;
}

/** Secret names the widget needs the user to supply (drives the install form). */
export function requiredSecrets(m: Manifest): string[] {
  return m.capabilities?.secrets ?? [];
}
