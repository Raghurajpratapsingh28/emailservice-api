import { auditLogs, type NewAuditLog } from '@shared/database/schema/auth.js';
import type { Database } from '@shared/database/client.js';

/**
 * Standardized audit-log writer. Append-only, never carries secrets.
 *
 * Hardening:
 *  - `metadata` is now passed as an object (jsonb column).
 *  - Adds `requestId` for cross-trace correlation with logs/metrics.
 *  - Failures are swallowed but counted via a logger error so audit-write
 *    failures show up in observability without breaking the user request.
 */

export type AuditAction =
  | 'auth.signup'
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.login.locked'
  | 'auth.logout'
  | 'auth.logout_all'
  | 'auth.refresh.success'
  | 'auth.refresh.failure'
  | 'auth.refresh.reuse_detected'
  | 'auth.password.reset_requested'
  | 'auth.password.reset_completed'
  | 'auth.password.changed'
  | 'auth.email.verification_sent'
  | 'auth.email.verified'
  | 'auth.invite.sent'
  | 'auth.invite.accepted'
  | 'auth.invite.revoked'
  | 'auth.session.revoked'
  | 'rbac.permission.denied'
  | 'workspace.created'
  | 'workspace.member.added'
  | 'workspace.member.removed'
  | 'contact.created'
  | 'contact.updated'
  | 'contact.deleted'
  | 'contact.bulk_imported'
  | 'segment.created'
  | 'segment.updated'
  | 'segment.deleted'
  | 'segment.contact_added'
  | 'segment.contact_removed'
  | 'workflow.created'
  | 'workflow.updated'
  | 'workflow.published'
  | 'workflow.paused'
  | 'workflow.resumed'
  | 'workflow.deleted'
  | 'billing.checkout.created'
  | 'billing.portal.created'
  | 'billing.subscription.updated'
  | 'billing.plan.changed'
  | 'billing.subscription.canceled'
  | 'billing.subscription.resumed'
  | 'billing.invoice.synced'
  | 'billing.webhook.received'
  | 'billing.webhook.replay_blocked'
  | 'billing.payment.failed';

export interface AuditEntry {
  action: AuditAction;
  workspaceId?: string | null;
  actorUserId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  success?: boolean;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
}

export interface AuditLogger {
  error: (msg: unknown, ...rest: unknown[]) => void;
}

export class AuditService {
  public constructor(
    private readonly db: Database,
    private readonly logger: AuditLogger,
  ) {}

  public async record(entry: AuditEntry): Promise<void> {
    const row: NewAuditLog = {
      action: entry.action,
      workspaceId: entry.workspaceId ?? null,
      actorUserId: entry.actorUserId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      success: entry.success ?? true,
      ipAddress: entry.ipAddress?.slice(0, 64) ?? null,
      userAgent: entry.userAgent?.slice(0, 512) ?? null,
      metadata: entry.metadata ?? null,
      requestId: entry.requestId ?? null,
    };

    try {
      await this.db.insert(auditLogs).values(row);
    } catch (err) {
      this.logger.error({ msg: '[audit] write failed', action: entry.action, err });
    }
  }
}
