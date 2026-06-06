import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number | null | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPercent(n: number | null | undefined, decimals = 2): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`;
}

export function formatTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function timeUntil(ts: number | null | undefined): string {
  if (!ts) return '—';
  const diff = ts - Date.now();
  if (diff <= 0) return 'now';
  const mins = Math.floor(diff / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    return `${hours}h${mins % 60}m`;
  }
  return `${mins}m${secs.toString().padStart(2, '0')}s`;
}

export function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/**
 * Resolve a dot/bracket path like "data.usage.total" or "usage[0].value"
 * against an arbitrary JSON object. Returns undefined if missing.
 */
export function resolvePath(obj: any, path: string): any {
  if (!path) return obj;
  const tokens = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let cur: any = obj;
  for (const t of tokens) {
    if (cur == null) return undefined;
    cur = cur[t];
  }
  return cur;
}
