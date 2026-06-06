import { describe, it, expect } from 'vitest';

// env is set in vitest.setup.ts before any test imports
import { encryptForUser, decryptForUser } from '../crypto';

describe('crypto per-user AES-256-GCM', () => {
  it('round-trips a plaintext for the same user', () => {
    const userId = 'github:42';
    const ct = encryptForUser(userId, 'sk-abc-123');
    expect(ct).not.toContain('sk-abc-123');
    expect(ct.split(':')).toHaveLength(3);
    expect(decryptForUser(userId, ct)).toBe('sk-abc-123');
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const userId = 'github:42';
    const a = encryptForUser(userId, 'sk-abc-123');
    const b = encryptForUser(userId, 'sk-abc-123');
    expect(a).not.toBe(b);
  });

  it('two different users get different ciphertexts from the same plaintext', () => {
    const a = encryptForUser('github:1', 'sk-test');
    const b = encryptForUser('github:2', 'sk-test');
    expect(a).not.toBe(b);
  });

  it('rejects ciphertext written for a different user', () => {
    const ct = encryptForUser('github:1', 'sk-test');
    expect(() => decryptForUser('github:2', ct)).toThrow();
  });

  it('rejects tampered ciphertext', () => {
    const userId = 'github:42';
    const ct = encryptForUser(userId, 'sk-test');
    // Flip the first hex char
    const tampered = ct.replace(/^./, ct[0] === '0' ? '1' : '0');
    expect(() => decryptForUser(userId, tampered)).toThrow();
  });

  it('handles empty string', () => {
    const userId = 'github:42';
    expect(decryptForUser(userId, encryptForUser(userId, ''))).toBe('');
  });

  it('handles unicode', () => {
    const userId = 'github:42';
    const txt = '凭据：sk-中文-🚀';
    expect(decryptForUser(userId, encryptForUser(userId, txt))).toBe(txt);
  });
});
