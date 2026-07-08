/**
 * Resolve a Bind (literal | {$: path}) against a source-data object.
 * Reuses the same dot/bracket path resolver the `custom` provider uses, so
 * binding semantics are identical across the codebase.
 *
 * Client-safe.
 */
import { resolvePath } from '../utils';
import type { Bind } from './ir';

export function resolveBind(data: unknown, b: Bind | undefined): unknown {
  if (b == null) return undefined;
  if (typeof b === 'object' && '$' in b) return resolvePath(data, b.$);
  return b;
}

export function resolveNumber(data: unknown, b: Bind | undefined): number | null {
  const v = resolveBind(data, b);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function resolveString(data: unknown, b: Bind | undefined): string {
  const v = resolveBind(data, b);
  return v == null ? '' : String(v);
}

export function resolveArray(data: unknown, b: Bind | undefined): unknown[] {
  const v = resolveBind(data, b);
  return Array.isArray(v) ? v : [];
}
