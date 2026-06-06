import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'monitor.db');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  _db = db;
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,            -- = GitHub user id (string) or "local:<id>"
      email TEXT,
      name TEXT,
      avatar_url TEXT,
      share_token TEXT UNIQUE,        -- random token for /display?share=TOKEN
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      base_url TEXT,
      endpoint TEXT,
      json_path TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      refresh_seconds INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS stocks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      market TEXT NOT NULL,
      display_name TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      refresh_seconds INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS fetch_cache (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Unique index on (user_id, symbol) for stocks
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_stocks_user_symbol ON stocks(user_id, symbol)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_stocks_user ON stocks(user_id)');
}

// --- Users ---
export interface User {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  share_token: string | null;
  created_at: number;
  last_seen_at: number;
}

export function upsertUser(u: Omit<User, 'created_at' | 'last_seen_at'> & { last_seen_at?: number }): User {
  const now = Date.now();
  const existing = getDb().prepare('SELECT * FROM users WHERE id = ?').get(u.id) as User | undefined;
  if (existing) {
    getDb()
      .prepare('UPDATE users SET email=?, name=?, avatar_url=?, last_seen_at=? WHERE id=?')
      .run(u.email, u.name, u.avatar_url, now, u.id);
    return { ...existing, email: u.email, name: u.name, avatar_url: u.avatar_url, last_seen_at: now };
  }
  getDb()
    .prepare('INSERT INTO users (id, email, name, avatar_url, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(u.id, u.email, u.name, u.avatar_url, now, now);
  return { ...u, created_at: now, last_seen_at: now };
}

export function getUser(id: string): User | undefined {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
}

export function getUserByShareToken(token: string): User | undefined {
  if (!token) return undefined;
  return getDb().prepare('SELECT * FROM users WHERE share_token = ?').get(token) as User | undefined;
}

export function setShareToken(userId: string, token: string | null): void {
  getDb().prepare('UPDATE users SET share_token = ? WHERE id = ?').run(token, userId);
}

// --- Provider CRUD (user-scoped) ---
export type ProviderType =
  | 'openai' | 'anthropic' | 'custom' | 'demo'
  | 'groq' | 'mistral' | 'deepseek' | 'moonshot' | 'zhipu' | 'openrouter' | 'ollama';

export interface Provider {
  id: string;
  user_id: string;
  name: string;
  type: ProviderType;
  api_key_encrypted: string;
  base_url: string | null;
  endpoint: string | null;
  json_path: string | null;
  display_order: number;
  refresh_seconds: number | null;
  created_at: number;
  updated_at: number;
}

export function listProviders(userId: string): Provider[] {
  return getDb()
    .prepare('SELECT * FROM providers WHERE user_id = ? ORDER BY display_order ASC, created_at ASC')
    .all(userId) as Provider[];
}

export function getProvider(userId: string, id: string): Provider | undefined {
  return getDb()
    .prepare('SELECT * FROM providers WHERE user_id = ? AND id = ?')
    .get(userId, id) as Provider | undefined;
}

export function insertProvider(p: Omit<Provider, 'created_at' | 'updated_at'>): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO providers (id, user_id, name, type, api_key_encrypted, base_url, endpoint, json_path, display_order, refresh_seconds, created_at, updated_at)
       VALUES (@id, @user_id, @name, @type, @api_key_encrypted, @base_url, @endpoint, @json_path, @display_order, @refresh_seconds, @created_at, @updated_at)`,
    )
    .run({ ...p, created_at: now, updated_at: now });
}

export function updateProvider(userId: string, id: string, p: Partial<Provider>): void {
  const now = Date.now();
  const existing = getProvider(userId, id);
  if (!existing) throw new Error('Provider not found');
  const merged = { ...existing, ...p, updated_at: now };
  getDb()
    .prepare(
      `UPDATE providers SET name=@name, type=@type, api_key_encrypted=@api_key_encrypted,
        base_url=@base_url, endpoint=@endpoint, json_path=@json_path,
        display_order=@display_order, refresh_seconds=@refresh_seconds,
        updated_at=@updated_at WHERE user_id=@user_id AND id=@id`,
    )
    .run(merged);
}

export function deleteProvider(userId: string, id: string): void {
  getDb().prepare('DELETE FROM providers WHERE user_id = ? AND id = ?').run(userId, id);
  getDb().prepare('DELETE FROM fetch_cache WHERE user_id = ? AND key = ?').run(userId, `provider:${id}`);
}

export function swapProviderOrder(userId: string, idA: string, idB: string): void {
  const a = getProvider(userId, idA);
  const b = getProvider(userId, idB);
  if (!a || !b) throw new Error('Provider not found');
  const now = Date.now();
  const tx = getDb().transaction(() => {
    getDb()
      .prepare('UPDATE providers SET display_order = ?, updated_at = ? WHERE user_id = ? AND id = ?')
      .run(-1, now, userId, idA);
    getDb()
      .prepare('UPDATE providers SET display_order = ?, updated_at = ? WHERE user_id = ? AND id = ?')
      .run(a.display_order, now, userId, idB);
    getDb()
      .prepare('UPDATE providers SET display_order = ?, updated_at = ? WHERE user_id = ? AND id = ?')
      .run(b.display_order, now, userId, idA);
  });
  tx();
}

// --- Stock CRUD (user-scoped) ---
export type StockMarket = 'us' | 'cn' | 'hk';

export interface Stock {
  id: string;
  user_id: string;
  symbol: string;
  market: StockMarket;
  display_name: string | null;
  display_order: number;
  refresh_seconds: number | null;
  created_at: number;
}

export function listStocks(userId: string): Stock[] {
  return getDb()
    .prepare('SELECT * FROM stocks WHERE user_id = ? ORDER BY display_order ASC, created_at ASC')
    .all(userId) as Stock[];
}

export function insertStock(s: Omit<Stock, 'created_at'>): void {
  const now = Date.now();
  getDb()
    .prepare(
      'INSERT INTO stocks (id, user_id, symbol, market, display_name, display_order, refresh_seconds, created_at) VALUES (@id, @user_id, @symbol, @market, @display_name, @display_order, @refresh_seconds, @created_at)',
    )
    .run({ ...s, created_at: now });
}

export function updateStock(userId: string, id: string, s: Partial<Stock>): void {
  const existing = getDb()
    .prepare('SELECT * FROM stocks WHERE user_id = ? AND id = ?')
    .get(userId, id) as Stock | undefined;
  if (!existing) throw new Error('Stock not found');
  const merged = { ...existing, ...s };
  getDb()
    .prepare(
      'UPDATE stocks SET symbol=@symbol, market=@market, display_name=@display_name, display_order=@display_order, refresh_seconds=@refresh_seconds WHERE user_id=@user_id AND id=@id',
    )
    .run(merged);
}

export function deleteStock(userId: string, id: string): void {
  getDb().prepare('DELETE FROM stocks WHERE user_id = ? AND id = ?').run(userId, id);
  getDb()
    .prepare('DELETE FROM fetch_cache WHERE user_id = ? AND key = ?')
    .run(userId, `stock:${id}`);
}

export function swapStockOrder(userId: string, idA: string, idB: string): void {
  const a = getDb()
    .prepare('SELECT * FROM stocks WHERE user_id = ? AND id = ?')
    .get(userId, idA) as Stock | undefined;
  const b = getDb()
    .prepare('SELECT * FROM stocks WHERE user_id = ? AND id = ?')
    .get(userId, idB) as Stock | undefined;
  if (!a || !b) throw new Error('Stock not found');
  const tx = getDb().transaction(() => {
    getDb().prepare('UPDATE stocks SET display_order = -1 WHERE user_id = ? AND id = ?').run(userId, idA);
    getDb().prepare('UPDATE stocks SET display_order = ? WHERE user_id = ? AND id = ?').run(a.display_order, userId, idB);
    getDb().prepare('UPDATE stocks SET display_order = ? WHERE user_id = ? AND id = ?').run(b.display_order, userId, idA);
  });
  tx();
}

// --- Settings (user-scoped) ---
export function getSetting(userId: string, key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?')
    .get(userId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(userId: string, key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value',
    )
    .run(userId, key, value);
}

export function getAllSettings(userId: string): Record<string, string> {
  const rows = getDb()
    .prepare('SELECT key, value FROM settings WHERE user_id = ?')
    .all(userId) as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// --- Fetch cache (user-scoped) ---
export function getCache(userId: string, key: string): { value: string; updated_at: number } | null {
  const row = getDb()
    .prepare('SELECT value, updated_at FROM fetch_cache WHERE user_id = ? AND key = ?')
    .get(userId, key) as { value: string; updated_at: number } | undefined;
  return row ?? null;
}

export function setCache(userId: string, key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO fetch_cache (user_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
    )
    .run(userId, key, value, Date.now());
}

export function clearCache(userId: string, key: string): void {
  getDb().prepare('DELETE FROM fetch_cache WHERE user_id = ? AND key = ?').run(userId, key);
}
