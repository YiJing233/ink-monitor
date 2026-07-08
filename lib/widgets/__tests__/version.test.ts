import { describe, it, expect } from 'vitest';
import { compareVersions, isNewer, parseVersion } from '../version';

describe('parseVersion', () => {
  it('parses simple semver', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
  });
  it('tolerates missing minor / patch', () => {
    expect(parseVersion('4')).toEqual([4, 0, 0]);
    expect(parseVersion('4.5')).toEqual([4, 5, 0]);
  });
  it('returns 0.0.0 for missing/garbage input', () => {
    expect(parseVersion(undefined)).toEqual([0, 0, 0]);
    expect(parseVersion('')).toEqual([0, 0, 0]);
    expect(parseVersion('garbage')).toEqual([0, 0, 0]);
  });
});

describe('compareVersions / isNewer', () => {
  it('orders major > minor > patch', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.10.0', '1.2.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.4', '1.2.3')).toBeGreaterThan(0);
  });
  it('treats equal as 0', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });
  it('isNewer', () => {
    expect(isNewer('1.2.4', '1.2.3')).toBe(true);
    expect(isNewer('1.2.3', '1.2.3')).toBe(false);
    expect(isNewer('1.2.3', '1.2.4')).toBe(false);
  });
});
