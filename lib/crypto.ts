import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'node:crypto';

/**
 * Per-user AES-256-GCM encryption for API keys at rest.
 *
 * Key derivation:
 *   - master = process.env.ENCRYPTION_KEY (server-only, 64 hex chars)
 *   - user key = PBKDF2(master, user_id, 100_000 iterations, 32 bytes, sha256)
 *
 * Properties:
 *   - DB alone is not enough to decrypt — attacker needs the server's master
 *     key (held in env, not in the DB).
 *   - Per-user keys mean a stolen DB row for user A does not compromise user B
 *     (different salt / derived key).
 *   - Rotating the master key requires re-encrypting every row; the helper
 *     `reencryptForUser` is provided for that migration.
 */
const ALGO = 'aes-256-gcm';
const PBKDF2_ITER = 100_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';
const MASTER_KEY = process.env.ENCRYPTION_KEY || '';

// Lazily compute the master-key buffer once
let _masterBuf: Buffer | null = null;
function getMaster(): Buffer {
  if (_masterBuf) return _masterBuf;
  if (!MASTER_KEY) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('[crypto] ENCRYPTION_KEY not set — using insecure dev fallback');
    }
    _masterBuf = Buffer.alloc(32, 1);
  } else if (/^[0-9a-fA-F]{64}$/.test(MASTER_KEY)) {
    _masterBuf = Buffer.from(MASTER_KEY, 'hex');
  } else {
    _masterBuf = Buffer.from(MASTER_KEY.padEnd(32, '0').slice(0, 32), 'utf8');
  }
  return _masterBuf;
}

// Per-user derived keys, cached by user_id
const _userKeyCache = new Map<string, Buffer>();
function userKey(userId: string): Buffer {
  const cached = _userKeyCache.get(userId);
  if (cached) return cached;
  const key = pbkdf2Sync(getMaster(), userId, PBKDF2_ITER, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  _userKeyCache.set(userId, key);
  return key;
}

export function encryptForUser(userId: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, userKey(userId), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptForUser(userId: string, payload: string): string {
  const [ivHex, tagHex, ctHex] = payload.split(':');
  if (!ivHex || !tagHex || !ctHex) throw new Error('Invalid ciphertext format');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');
  const decipher = createDecipheriv(ALGO, userKey(userId), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Backwards-compat shim — used by legacy code paths. */
export const encrypt = (plaintext: string) => encryptForUser('_global_', plaintext);
export const decrypt = (payload: string) => decryptForUser('_global_', payload);
