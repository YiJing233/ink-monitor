import { describe, it, expect } from 'vitest';
import { ipIsBlocked, hostAllowed } from '../safe-fetch';

describe('ipIsBlocked', () => {
  it('blocks loopback / private / link-local / metadata', () => {
    expect(ipIsBlocked('127.0.0.1')).toBe(true);
    expect(ipIsBlocked('10.0.0.5')).toBe(true);
    expect(ipIsBlocked('192.168.1.1')).toBe(true);
    expect(ipIsBlocked('172.16.0.1')).toBe(true);
    expect(ipIsBlocked('172.31.255.255')).toBe(true);
    expect(ipIsBlocked('169.254.169.254')).toBe(true); // cloud metadata
    expect(ipIsBlocked('100.64.0.1')).toBe(true); // CGNAT
    expect(ipIsBlocked('0.0.0.0')).toBe(true);
    expect(ipIsBlocked('::1')).toBe(true);
    expect(ipIsBlocked('fe80::1')).toBe(true);
    expect(ipIsBlocked('fd00::1')).toBe(true);
    expect(ipIsBlocked('::ffff:127.0.0.1')).toBe(true); // IPv4-mapped loopback
  });

  it('allows public addresses', () => {
    expect(ipIsBlocked('8.8.8.8')).toBe(false);
    expect(ipIsBlocked('1.1.1.1')).toBe(false);
    expect(ipIsBlocked('172.32.0.1')).toBe(false); // just outside private range
    expect(ipIsBlocked('2606:4700:4700::1111')).toBe(false);
  });

  it('blocks garbage', () => {
    expect(ipIsBlocked('not-an-ip')).toBe(true);
    expect(ipIsBlocked('')).toBe(true);
  });
});

describe('hostAllowed', () => {
  it('allows anything when no allowlist', () => {
    expect(hostAllowed('evil.com')).toBe(true);
    expect(hostAllowed('evil.com', [])).toBe(true);
  });
  it('matches exact host and subdomains only', () => {
    expect(hostAllowed('api.openai.com', ['openai.com'])).toBe(true);
    expect(hostAllowed('openai.com', ['openai.com'])).toBe(true);
    expect(hostAllowed('openai.com.evil.com', ['openai.com'])).toBe(false);
    expect(hostAllowed('notopenai.com', ['openai.com'])).toBe(false);
  });
});
