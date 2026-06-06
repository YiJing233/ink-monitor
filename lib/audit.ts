import { getDb } from './db';

export type AuditAction =
  | 'create' | 'update' | 'delete' | 'move'
  | 'login' | 'logout' | 'share.create' | 'share.revoke' | 'share.rotate'
  | 'account.delete';

export type AuditTargetType = 'provider' | 'stock' | 'settings' | 'share' | 'account' | 'webhook' | 'session';

export interface AuditEntry {
  id: number;
  user_id: string;
  action: AuditAction;
  target_type: AuditTargetType;
  target_id: string | null;
  before_json: string | null;
  after_json: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: number;
}

export interface AuditInput {
  userId: string;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId?: string | null;
  before?: any;
  after?: any;
  ip?: string | null;
  userAgent?: string | null;
}

export function recordAudit(e: AuditInput): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO audit_log (user_id, action, target_type, target_id, before_json, after_json, ip, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        e.userId,
        e.action,
        e.targetType,
        e.targetId ?? null,
        e.before === undefined ? null : JSON.stringify(e.before),
        e.after === undefined ? null : JSON.stringify(e.after),
        e.ip ?? null,
        e.userAgent ?? null,
        Date.now(),
      );
  } catch (err) {
    // Audit must never block the request. Best-effort logging.
    // eslint-disable-next-line no-console
    console.error('[audit] record failed:', err);
  }
}

export function listAudit(userId: string, limit = 100): AuditEntry[] {
  return getDb()
    .prepare('SELECT * FROM audit_log WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit) as AuditEntry[];
}

export function parseAuditEntry(e: AuditEntry): Omit<AuditEntry, 'before_json' | 'after_json'> & {
  before: any | null;
  after: any | null;
} {
  return {
    ...e,
    before: e.before_json ? safeJson(e.before_json) : null,
    after: e.after_json ? safeJson(e.after_json) : null,
  };
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return null; }
}
