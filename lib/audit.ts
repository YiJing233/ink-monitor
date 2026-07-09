import { getDb } from './db';
import { safeJson } from './safe-json';

/**
 * Audit action vocabulary.
 *
 * Core verbs (`create`/`update`/`delete`/`move`) are kept generic so existing
 * callers don't churn. Dot-suffixed forms (`widget.create`, `dashboard.save`,
 * `manifest.install`, `secret.add`) carry a noun prefix so the audit UI can
 * group related actions under a resource without needing a separate column.
 */
export type AuditAction =
  | 'create' | 'update' | 'delete' | 'move'
  | 'login' | 'logout' | 'share.create' | 'share.revoke' | 'share.rotate'
  | 'account.delete'
  // Widget platform -- resource.action
  | 'widget.create' | 'widget.update' | 'widget.delete'
  | 'manifest.install' | 'manifest.delete'
  | 'secret.add' | 'secret.remove'
  | 'dashboard.create' | 'dashboard.update' | 'dashboard.save' | 'dashboard.delete'
  | 'album.upload' | 'album.save' | 'album.delete';

export type AuditTargetType =
  | 'provider' | 'stock' | 'settings' | 'share' | 'account' | 'webhook' | 'session'
  // Widget platform -- resource nouns, line up with AuditAction prefixes
  | 'widget' | 'manifest' | 'secret' | 'dashboard' | 'album';

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
    before: e.before_json ? safeJson(e.before_json, 'audit_log.before_json') : null,
    after: e.after_json ? safeJson(e.after_json, 'audit_log.after_json') : null,
  };
}
