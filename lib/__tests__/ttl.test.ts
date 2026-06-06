import { describe, it, expect } from 'vitest';
import { checkProviderTtl, checkStockTtl, PROVIDER_TTL, STOCK_TTL } from '../ttl';

describe('provider TTL checks', () => {
  it('OpenAI: 60s is OK (at recommended)', () => {
    const r = checkProviderTtl('openai', 60, 60);
    expect(r.severity).toBe('ok');
    expect(r.recommended).toBe(60);
  });

  it('OpenAI: 45s triggers warn', () => {
    const r = checkProviderTtl('openai', 45, 60);
    expect(r.severity).toBe('warn');
    expect(r.message).toMatch(/Below recommended/);
  });

  it('OpenAI: 20s triggers danger', () => {
    const r = checkProviderTtl('openai', 20, 60);
    expect(r.severity).toBe('danger');
    expect(r.message).toMatch(/rate-limit/);
  });

  it('Anthropic: 30s is danger (hardMin=60)', () => {
    const r = checkProviderTtl('anthropic', 30, 60);
    expect(r.severity).toBe('danger');
  });

  it('Anthropic: 300s is OK (at recommended)', () => {
    const r = checkProviderTtl('anthropic', 300, 60);
    expect(r.severity).toBe('ok');
  });

  it('null TTL falls back to default (60s → warn for Anthropic)', () => {
    const r = checkProviderTtl('anthropic', null, 60);
    expect(r.severity).toBe('warn');
  });

  it('Demo: 15s is OK', () => {
    const r = checkProviderTtl('demo', 15, 60);
    expect(r.severity).toBe('ok');
  });

  it('All known provider types have guidance entries', () => {
    for (const t of ['openai', 'anthropic', 'custom', 'demo']) {
      expect(PROVIDER_TTL[t]).toBeDefined();
    }
  });
});

describe('stock TTL checks', () => {
  it('US: 60s OK, 45s warn, 20s danger', () => {
    expect(checkStockTtl('us', 60, 60).severity).toBe('ok');
    expect(checkStockTtl('us', 45, 60).severity).toBe('warn');
    expect(checkStockTtl('us', 20, 60).severity).toBe('danger');
  });

  it('CN: 30s OK, 25s warn, 10s danger', () => {
    expect(checkStockTtl('cn', 30, 60).severity).toBe('ok');
    expect(checkStockTtl('cn', 25, 60).severity).toBe('warn');
    expect(checkStockTtl('cn', 10, 60).severity).toBe('danger');
  });

  it('HK: 60s OK', () => {
    expect(checkStockTtl('hk', 60, 60).severity).toBe('ok');
  });

  it('All markets have guidance', () => {
    for (const m of ['us', 'cn', 'hk']) {
      expect(STOCK_TTL[m]).toBeDefined();
    }
  });
});
