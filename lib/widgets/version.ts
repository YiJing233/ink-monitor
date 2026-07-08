/**
 * Minimal semver comparator — just major/minor/patch, no prerelease. The only
 * guarantee we need is "X is newer than Y"; the gallery doesn't ship
 * prerelease tags today. Pure + unit-tested.
 */
export function parseVersion(v: string | undefined | null): [number, number, number] {
  if (!v) return [0, 0, 0];
  const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.trim());
  if (!m) return [0, 0, 0];
  return [Number(m[1]) || 0, Number(m[2]) || 0, Number(m[3]) || 0];
}

export function compareVersions(a: string | undefined | null, b: string | undefined | null): number {
  const [a1, a2, a3] = parseVersion(a);
  const [b1, b2, b3] = parseVersion(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

export function isNewer(remote: string | undefined | null, local: string | undefined | null): boolean {
  return compareVersions(remote, local) > 0;
}
