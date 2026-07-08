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

/**
 * Run `fn` inside a SQLite transaction. better-sqlite3 transactions MUST be
 * synchronous, so `fn` is expected to run synchronously; if it throws, the
 * transaction rolls back.
 *
 * Usage:
 *   withTx(() => {
 *     insertWidget({ ... });
 *     updateDashboard(userId, id, { ... });
 *   });
 */
export function withTx<T>(fn: () => T): T {
  const tx = getDb().transaction(fn);
  return tx();
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

    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      url TEXT NOT NULL,
      events TEXT NOT NULL,        -- JSON array of event names
      secret TEXT NOT NULL,        -- used to sign deliveries (HMAC-SHA256)
      active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_delivered_at INTEGER,
      last_status INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT NOT NULL,
      status INTEGER,
      response_excerpt TEXT,
      delivered_at INTEGER NOT NULL,
      FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,            -- 'create' | 'update' | 'delete' | 'move' | 'login' | ...
      target_type TEXT NOT NULL,        -- 'provider' | 'stock' | 'settings' | 'share' | 'account'
      target_id TEXT,
      before_json TEXT,
      after_json TEXT,
      ip TEXT,
      user_agent TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_log(user_id, created_at DESC);

    -- Widget platform ---------------------------------------------------------
    CREATE TABLE IF NOT EXISTS dashboards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      base_device TEXT NOT NULL DEFAULT 'kindle-pw',
      layouts_json TEXT NOT NULL DEFAULT '{}',  -- { deviceId: Placement[] }
      refresh_overrides_json TEXT NOT NULL DEFAULT '{}', -- { deviceId: refreshSeconds }
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS widgets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      manifest_json TEXT NOT NULL,       -- full validated WidgetManifest
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS widget_secrets (
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,                 -- e.g. OWM_KEY (the manifest declares it)
      value_encrypted TEXT NOT NULL,      -- AES-256-GCM, per-user key
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, name),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS owned_state (
      user_id TEXT NOT NULL,
      store TEXT NOT NULL,                -- e.g. todo:groceries
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, store),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_manifests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      manifest_id TEXT NOT NULL,            -- manifest.id (palette key)
      manifest_json TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'custom', -- 'custom' | 'installed'
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (user_id, manifest_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Unique index on (user_id, symbol) for stocks
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_stocks_user_symbol ON stocks(user_id, symbol)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_stocks_user ON stocks(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON webhook_deliveries(webhook_id, delivered_at DESC)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_dashboards_user ON dashboards(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_widgets_user ON widgets(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_user_manifests_user ON user_manifests(user_id)');
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
  | 'groq' | 'mistral' | 'deepseek' | 'moonshot' | 'zhipu' | 'openrouter' | 'ollama'
  | 'minimax';

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

// --- Dashboards (user-scoped) ---
export interface DashboardRow {
  id: string;
  user_id: string;
  name: string;
  base_device: string;
  layouts_json: string; // JSON: { [deviceId]: Placement[] }
  refresh_overrides_json: string; // JSON: { [deviceId]: refreshSeconds }
  display_order: number;
  created_at: number;
  updated_at: number;
}

export function listDashboards(userId: string): DashboardRow[] {
  return getDb()
    .prepare('SELECT * FROM dashboards WHERE user_id = ? ORDER BY display_order ASC, created_at ASC')
    .all(userId) as DashboardRow[];
}

export function getDashboard(userId: string, id: string): DashboardRow | undefined {
  return getDb().prepare('SELECT * FROM dashboards WHERE user_id = ? AND id = ?').get(userId, id) as DashboardRow | undefined;
}

export function insertDashboard(d: Omit<DashboardRow, 'created_at' | 'updated_at'>): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO dashboards (id, user_id, name, base_device, layouts_json, refresh_overrides_json, display_order, created_at, updated_at)
       VALUES (@id, @user_id, @name, @base_device, @layouts_json, @refresh_overrides_json, @display_order, @created_at, @updated_at)`,
    )
    .run({ ...d, created_at: now, updated_at: now });
}

export function updateDashboard(userId: string, id: string, patch: Partial<DashboardRow>): void {
  const existing = getDashboard(userId, id);
  if (!existing) throw new Error('Dashboard not found');
  const merged = { ...existing, ...patch, updated_at: Date.now() };
  getDb()
    .prepare(
      `UPDATE dashboards SET name=@name, base_device=@base_device, layouts_json=@layouts_json,
        refresh_overrides_json=@refresh_overrides_json,
        display_order=@display_order, updated_at=@updated_at WHERE user_id=@user_id AND id=@id`,
    )
    .run(merged);
}

export function deleteDashboard(userId: string, id: string): void {
  getDb().prepare('DELETE FROM dashboards WHERE user_id = ? AND id = ?').run(userId, id);
}

// --- Widget instances (user-scoped) ---
export interface WidgetRow {
  id: string;
  user_id: string;
  manifest_json: string; // full validated manifest
  config_json: string; // per-instance config (city, providerId, …)
  created_at: number;
  updated_at: number;
}

export function listWidgets(userId: string): WidgetRow[] {
  return getDb().prepare('SELECT * FROM widgets WHERE user_id = ? ORDER BY created_at ASC').all(userId) as WidgetRow[];
}

export function getWidget(userId: string, id: string): WidgetRow | undefined {
  return getDb().prepare('SELECT * FROM widgets WHERE user_id = ? AND id = ?').get(userId, id) as WidgetRow | undefined;
}

export function insertWidget(w: Omit<WidgetRow, 'created_at' | 'updated_at'>): void {
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO widgets (id, user_id, manifest_json, config_json, created_at, updated_at)
       VALUES (@id, @user_id, @manifest_json, @config_json, @created_at, @updated_at)`,
    )
    .run({ ...w, created_at: now, updated_at: now });
}

export function updateWidget(userId: string, id: string, patch: Partial<WidgetRow>): void {
  const existing = getWidget(userId, id);
  if (!existing) throw new Error('Widget not found');
  const merged = { ...existing, ...patch, updated_at: Date.now() };
  getDb()
    .prepare('UPDATE widgets SET manifest_json=@manifest_json, config_json=@config_json, updated_at=@updated_at WHERE user_id=@user_id AND id=@id')
    .run(merged);
}

export function deleteWidget(userId: string, id: string): void {
  getDb().prepare('DELETE FROM widgets WHERE user_id = ? AND id = ?').run(userId, id);
}

// --- Widget secrets (user-scoped; the caller encrypts via lib/crypto) ---
export function setWidgetSecret(userId: string, name: string, valueEncrypted: string): void {
  getDb()
    .prepare(
      'INSERT INTO widget_secrets (user_id, name, value_encrypted, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, name) DO UPDATE SET value_encrypted=excluded.value_encrypted',
    )
    .run(userId, name, valueEncrypted, Date.now());
}

export function getWidgetSecret(userId: string, name: string): string | null {
  const row = getDb()
    .prepare('SELECT value_encrypted FROM widget_secrets WHERE user_id = ? AND name = ?')
    .get(userId, name) as { value_encrypted: string } | undefined;
  return row?.value_encrypted ?? null;
}

export function listWidgetSecretNames(userId: string): string[] {
  const rows = getDb().prepare('SELECT name FROM widget_secrets WHERE user_id = ? ORDER BY name').all(userId) as { name: string }[];
  return rows.map((r) => r.name);
}

export function deleteWidgetSecret(userId: string, name: string): void {
  getDb().prepare('DELETE FROM widget_secrets WHERE user_id = ? AND name = ?').run(userId, name);
}

// --- Owned widget state (TODO lists, notes, counters) ---
export function getOwnedState(userId: string, store: string): unknown {
  const row = getDb()
    .prepare('SELECT value_json FROM owned_state WHERE user_id = ? AND store = ?')
    .get(userId, store) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return null;
  }
}

export function setOwnedState(userId: string, store: string, value: unknown): void {
  getDb()
    .prepare(
      'INSERT INTO owned_state (user_id, store, value_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, store) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at',
    )
    .run(userId, store, JSON.stringify(value), Date.now());
}

// --- User manifest library (palette + installed-from-market) ---
export interface UserManifestRow {
  id: string;
  user_id: string;
  manifest_id: string;
  manifest_json: string;
  origin: string; // 'custom' | 'installed'
  created_at: number;
  updated_at: number;
}

export function listUserManifests(userId: string): UserManifestRow[] {
  return getDb()
    .prepare('SELECT * FROM user_manifests WHERE user_id = ? ORDER BY updated_at DESC')
    .all(userId) as UserManifestRow[];
}

export function getUserManifest(userId: string, manifestId: string): UserManifestRow | undefined {
  return getDb()
    .prepare('SELECT * FROM user_manifests WHERE user_id = ? AND manifest_id = ?')
    .get(userId, manifestId) as UserManifestRow | undefined;
}

export function upsertUserManifest(userId: string, manifestId: string, manifestJson: string, origin: string): void {
  const now = Date.now();
  const existing = getUserManifest(userId, manifestId);
  if (existing) {
    getDb()
      .prepare('UPDATE user_manifests SET manifest_json=?, origin=?, updated_at=? WHERE user_id=? AND manifest_id=?')
      .run(manifestJson, origin, now, userId, manifestId);
    return;
  }
  const id = 'um_' + now.toString(36) + Math.random().toString(36).slice(2, 8);
  getDb()
    .prepare('INSERT INTO user_manifests (id, user_id, manifest_id, manifest_json, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, userId, manifestId, manifestJson, origin, now, now);
}

export function deleteUserManifest(userId: string, manifestId: string): void {
  getDb().prepare('DELETE FROM user_manifests WHERE user_id = ? AND manifest_id = ?').run(userId, manifestId);
}
