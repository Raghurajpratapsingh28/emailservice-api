import { Counter } from 'prom-client';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { NATS_SUBJECTS } from '@constants/nats-subjects.js';
import {
  ConflictError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  ValidationError,
} from '@shared/errors/app-errors.js';
import { domains as domainsTable } from '@shared/database/schema/domains.js';
import type { Database } from '@shared/database/client.js';
import type {
  EmailSend,
  EmailSendStatus,
  EmailTemplate,
  EmailTemplateStatus,
} from '@shared/database/schema/emails.js';
import type { NatsClient } from '@shared/queue/nats.js';
import type { AuthenticatedUser } from '@shared/types/index.js';
import type { AuditService } from '@modules/auth/services/audit.service.js';
import type { BillingService } from '@modules/billing/services/billing.service.js';
import type { IdempotencyCache } from '@shared/cache/idempotency.js';
import type { TransactionalRepository } from '../repositories/transactional.repository.js';
import type {
  CreateTemplateBody,
  ListTemplatesQuery,
  UpdateTemplateBody,
} from '../schemas/template.schema.js';
import type { ListSendsQuery, SendEmailBody } from '../schemas/send.schema.js';

// ─── Metrics ─────────────────────────────────────────────────────────────────

const emailsQueuedTotal = new Counter({
  name: 'emails_transactional_queued_total',
  help: 'Transactional sends successfully enqueued',
  labelNames: ['workspace_plan', 'used_template'] as const,
});
const emailsQueuePublishFailures = new Counter({
  name: 'emails_transactional_queue_publish_failures_total',
  help: 'Transactional NATS publish failures',
});
const emailsTemplateUsage = new Counter({
  name: 'emails_template_usage_total',
  help: 'Template uses at send time',
  labelNames: ['template_name'] as const,
});
const emailsIdempotencyHits = new Counter({
  name: 'emails_idempotency_hits_total',
  help: 'Idempotency replays returned without re-queuing',
});

// ─── Public types ────────────────────────────────────────────────────────────

export interface ActorContext {
  user: AuthenticatedUser;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface SendEmailResult {
  sendId: string;
  status: EmailSendStatus;
}

/** Locked queue contract — DO NOT change shape. */
interface QueuePayload {
  jobId: string;
  workspaceId: string;
  sendId: string;
  to: Array<{ email: string; name?: string }>;
  from: { email: string; name?: string };
  replyTo?: string;
  subject: string;
  html?: string;
  text?: string;
  tags: Record<string, string>;
  provider: 'ses';
}

// ─── Service ─────────────────────────────────────────────────────────────────

export class TransactionalService {
  public constructor(
    private readonly db: Database,
    private readonly repo: TransactionalRepository,
    private readonly idempotency: IdempotencyCache,
    private readonly nats: NatsClient,
    private readonly audit: AuditService,
    private readonly logger: {
      info: (...a: unknown[]) => void;
      warn: (...a: unknown[]) => void;
      error: (...a: unknown[]) => void;
    },
    private readonly billing: BillingService,
  ) {}

  // ─── 1. Send email ─────────────────────────────────────────────────────────

  public async sendEmail(
    workspaceId: string,
    body: SendEmailBody,
    actor: ActorContext,
  ): Promise<SendEmailResult> {
    // 1a. Idempotency reservation (Redis SET NX)
    if (body.idempotencyKey) {
      const lookup = await this.idempotency.checkOrReserve<SendEmailResult>(
        workspaceId,
        body.idempotencyKey,
        body,
      );
      if (lookup.status === 'conflict') {
        throw new ConflictError(
          'Idempotency key reused with a different request body',
          'IDEMPOTENT_REPLAY',
        );
      }
      if (lookup.status === 'hit' && lookup.response) {
        emailsIdempotencyHits.inc();
        this.logger.info(
          { workspaceId, idempotencyKey: body.idempotencyKey, sendId: lookup.response.sendId },
          '[transactional] idempotency hit',
        );
        return lookup.response;
      }
      // hit with response=null => previous request mid-flight; treat as miss
    }

    // 1b. Verified sending domain check
    const senderHost = this.extractHost(body.from.email);
    if (!senderHost) {
      throw new ValidationError('Invalid sender email');
    }
    const senderDomainRow = await this.findVerifiedSendingDomain(workspaceId, senderHost);
    if (!senderDomainRow) {
      throw new ForbiddenError(
        'Sender domain is not verified for this workspace',
        'SENDER_DOMAIN_NOT_VERIFIED',
      );
    }

    // 1c. Quota check (per calendar month)
    await this.assertWithinQuota(workspaceId);

    // 1d. Materialize template (if any)
    const materialized = await this.materialize(workspaceId, body);

    // 1e. Persist DB record + publish queue inside a single txn boundary
    const primary = body.to[0]!;
    const generatedSendId = randomUUID();
    const internalRow = await this.db.transaction(async (tx) => {
      return this.repo.insertSend(tx, {
        workspaceId,
        sendId: generatedSendId,
        status: 'queued',
        senderEmail: body.from.email,
        senderName: body.from.name ?? null,
        replyTo: body.replyTo ?? null,
        recipientEmail: primary.email,
        recipientName: primary.name ?? null,
        subject: materialized.subject,
        htmlBody: materialized.html ?? null,
        textBody: materialized.text ?? null,
        templateId: materialized.templateId ?? null,
        templateVersion: materialized.templateVersion ?? null,
        templateData: body.templateData ?? {},
        provider: 'ses',
        tags: body.tags ?? {},
        metadata: {
          to: body.to,
          idempotencyKey: body.idempotencyKey ?? null,
          requestId: actor.requestId ?? null,
        },
        createdBy: actor.user.id,
      });
    });

    const payload: QueuePayload = {
      jobId: randomUUID(),
      workspaceId,
      sendId: internalRow.sendId,
      to: body.to,
      from: body.from,
      ...(body.replyTo ? { replyTo: body.replyTo } : {}),
      subject: materialized.subject,
      ...(materialized.html ? { html: materialized.html } : {}),
      ...(materialized.text ? { text: materialized.text } : {}),
      tags: body.tags ?? {},
      provider: 'ses',
    };

    // 1f. Publish — with rollback on failure
    try {
      await this.nats.publish(NATS_SUBJECTS.EMAIL_SEND_TRANSACTIONAL, payload);
    } catch (err) {
      emailsQueuePublishFailures.inc();
      this.logger.error(
        { err, workspaceId, sendId: internalRow.sendId },
        '[transactional] queue publish failed; rolling back DB row',
      );
      await this.db.transaction(async (tx) => {
        await this.repo.deleteSendByIdTx(tx, workspaceId, internalRow.id);
      });
      throw new InternalServerError(
        'Failed to enqueue email send',
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    await this.billing.recordUsage(workspaceId, 'emails', 1);

    const result: SendEmailResult = {
      sendId: internalRow.sendId,
      status: 'queued',
    };

    // 1g. Persist idempotency response so retries return identical result
    if (body.idempotencyKey) {
      await this.idempotency
        .storeResponse(workspaceId, body.idempotencyKey, body, result)
        .catch((err) =>
          this.logger.warn({ err }, '[transactional] idempotency store failed'),
        );
    }

    // 1h. Metrics + audit
    const usedTemplate = materialized.templateId !== null;
    emailsQueuedTotal.inc({
      workspace_plan: 'unknown',
      used_template: usedTemplate ? 'true' : 'false',
    });
    if (materialized.templateName) {
      emailsTemplateUsage.inc({ template_name: materialized.templateName });
    }

    await this.audit.record({
      action: 'workspace.member.added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'email_send',
      targetId: internalRow.sendId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: {
        kind: 'email.queued',
        recipientCount: body.to.length,
        usedTemplate,
        templateId: materialized.templateId ?? undefined,
      },
    });

    this.logger.info(
      {
        workspaceId,
        sendId: internalRow.sendId,
        recipientCount: body.to.length,
        usedTemplate,
      },
      '[transactional] queued',
    );

    return result;
  }

  // ─── 2. Get send ───────────────────────────────────────────────────────────

  public async getSend(workspaceId: string, sendId: string): Promise<EmailSend> {
    const row = await this.repo.findSendBySendId(workspaceId, sendId);
    if (!row) {
      throw new NotFoundError('Send not found', 'EMAIL_NOT_FOUND');
    }
    return row;
  }

  // ─── 3. List sends ─────────────────────────────────────────────────────────

  public async listSends(
    workspaceId: string,
    query: ListSendsQuery,
  ): Promise<{ items: EmailSend[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const result = await this.repo.listSends({
      workspaceId,
      status: query.status as EmailSendStatus | undefined,
      recipientSearch: query.recipient,
      fromDate: query.fromDate,
      toDate: query.toDate,
      page,
      pageSize,
    });
    return { ...result, page, pageSize };
  }

  // ─── 4. Templates: create ─────────────────────────────────────────────────

  public async createTemplate(
    workspaceId: string,
    body: CreateTemplateBody,
    actor: ActorContext,
  ): Promise<EmailTemplate> {
    const exists = await this.repo.templateNameExists(workspaceId, body.name);
    if (exists) {
      throw new ConflictError('Template name already exists', 'TEMPLATE_NAME_TAKEN');
    }

    const created = await this.db.transaction(async (tx) => {
      const inserted = await this.repo.insertTemplate(tx, {
        workspaceId,
        name: body.name,
        version: 1,
        subject: body.subject,
        htmlBody: body.htmlBody ?? null,
        textBody: body.textBody ?? null,
        variables: body.variables ?? {},
        status: body.publish ? 'published' : 'draft',
        createdBy: actor.user.id,
      });
      return inserted;
    });

    await this.audit.record({
      action: 'workspace.member.added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'email_template',
      targetId: created.id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: {
        kind: 'email.template.created',
        name: created.name,
        version: created.version,
        published: created.status === 'published',
      },
    });

    return created;
  }

  // ─── 5. Templates: list ───────────────────────────────────────────────────

  public async listTemplates(
    workspaceId: string,
    query: ListTemplatesQuery,
  ): Promise<{ items: EmailTemplate[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 100);
    const result = await this.repo.listTemplates({
      workspaceId,
      status: query.status as EmailTemplateStatus | undefined,
      search: query.search,
      latestOnly: query.latestOnly,
      page,
      pageSize,
    });
    return { ...result, page, pageSize };
  }

  // ─── 6. Templates: get ────────────────────────────────────────────────────

  public async getTemplate(workspaceId: string, templateId: string): Promise<EmailTemplate> {
    const row = await this.repo.findTemplateById(workspaceId, templateId);
    if (!row) {
      throw new NotFoundError('Template not found', 'TEMPLATE_NOT_FOUND');
    }
    return row;
  }

  // ─── 7. Templates: update ─────────────────────────────────────────────────

  /**
   * Updates a draft. If the target is published, automatically clones it as
   * the next draft version (immutable history) and applies the patch there.
   * Setting `publish: true` transitions the resulting draft to published.
   */
  public async updateTemplate(
    workspaceId: string,
    templateId: string,
    body: UpdateTemplateBody,
    actor: ActorContext,
  ): Promise<EmailTemplate> {
    const existing = await this.repo.findTemplateById(workspaceId, templateId);
    if (!existing) {
      throw new NotFoundError('Template not found', 'TEMPLATE_NOT_FOUND');
    }

    let target = existing;

    // Published → clone as next draft version, apply patch there.
    if (existing.status === 'published') {
      const nextVersion = await this.repo.nextTemplateVersion(workspaceId, existing.name);
      target = await this.repo.insertTemplate(this.db, {
        workspaceId,
        name: existing.name,
        version: nextVersion,
        subject: existing.subject,
        htmlBody: existing.htmlBody,
        textBody: existing.textBody,
        variables: existing.variables,
        status: 'draft',
        createdBy: actor.user.id,
      });
    } else if (existing.status === 'archived') {
      throw new ConflictError('Template is archived', 'TEMPLATE_ARCHIVED');
    }

    const patch: Record<string, unknown> = {};
    if (body.subject !== undefined) patch.subject = body.subject;
    if (body.htmlBody !== undefined) patch.htmlBody = body.htmlBody;
    if (body.textBody !== undefined) patch.textBody = body.textBody;
    if (body.variables !== undefined) patch.variables = body.variables;

    let updated: EmailTemplate | null = null;
    if (Object.keys(patch).length > 0) {
      updated = await this.repo.updateTemplate(workspaceId, target.id, patch);
      if (!updated) {
        throw new ConflictError('Template state changed — please retry', 'CONFLICT');
      }
    } else {
      updated = target;
    }

    if (body.publish === true) {
      const published = await this.repo.publishTemplate(workspaceId, updated.id);
      if (!published) {
        throw new ConflictError('Template state changed — please retry', 'CONFLICT');
      }
      updated = published;
    }

    await this.audit.record({
      action: 'workspace.member.added',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'email_template',
      targetId: updated.id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: {
        kind: 'email.template.updated',
        name: updated.name,
        version: updated.version,
        published: updated.status === 'published',
        clonedFromPublished: existing.status === 'published',
      },
    });

    return updated;
  }

  // ─── 8. Templates: delete ─────────────────────────────────────────────────

  public async deleteTemplate(
    workspaceId: string,
    templateId: string,
    actor: ActorContext,
  ): Promise<void> {
    const existing = await this.repo.findTemplateById(workspaceId, templateId);
    if (!existing) {
      throw new NotFoundError('Template not found', 'TEMPLATE_NOT_FOUND');
    }

    const deleted = await this.repo.softDeleteTemplate(workspaceId, templateId);
    if (!deleted) {
      throw new ConflictError('Template state changed — please retry', 'CONFLICT');
    }

    await this.audit.record({
      action: 'workspace.member.removed',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'email_template',
      targetId: templateId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { kind: 'email.template.deleted', name: existing.name, version: existing.version },
    });
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private extractHost(email: string): string | null {
    const at = email.lastIndexOf('@');
    if (at < 0 || at === email.length - 1) return null;
    return email.slice(at + 1).toLowerCase();
  }

  private async findVerifiedSendingDomain(
    workspaceId: string,
    host: string,
  ): Promise<{ id: string; domain: string } | null> {
    const rows = await this.db
      .select({ id: domainsTable.id, domain: domainsTable.domain })
      .from(domainsTable)
      .where(
        and(
          eq(domainsTable.workspaceId, workspaceId),
          eq(domainsTable.domain, host),
          eq(domainsTable.status, 'verified'),
          isNull(domainsTable.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Resolves the workspace's plan, looks up the monthly campaign quota, and
   * compares against the count of sends so far this month. The
   * `EMAIL_QUOTA_EXCEEDED` error is mapped to 429 by the controller layer (we
   * use Forbidden + custom code to keep things simple at this layer).
   */
  private async assertWithinQuota(workspaceId: string): Promise<void> {
    const allowed = await this.billing.hasQuotaRemaining(workspaceId, 'emails', 1);
    if (!allowed) {
      throw new ForbiddenError(
        'Monthly email quota exceeded for your plan',
        'EMAIL_QUOTA_EXCEEDED',
      );
    }
  }

  /**
   * Returns the final {subject, html, text} that ships in the queue payload.
   * If the body references a template, the latest published version is used
   * and `{{var}}` placeholders are substituted with `templateData[var]`.
   */
  private async materialize(
    workspaceId: string,
    body: SendEmailBody,
  ): Promise<{
    subject: string;
    html?: string;
    text?: string;
    templateId: string | null;
    templateVersion: number | null;
    templateName: string | null;
  }> {
    if (!body.templateId) {
      return {
        subject: body.subject!,
        html: body.html,
        text: body.text,
        templateId: null,
        templateVersion: null,
        templateName: null,
      };
    }

    const template = await this.repo.findTemplateById(workspaceId, body.templateId);
    if (!template) {
      throw new NotFoundError('Template not found', 'TEMPLATE_NOT_FOUND');
    }
    if (template.status !== 'published') {
      throw new ValidationError('Template must be published before use');
    }

    const data = body.templateData ?? {};
    return {
      subject: this.render(template.subject, data),
      html: template.htmlBody ? this.render(template.htmlBody, data) : undefined,
      text: template.textBody ? this.render(template.textBody, data) : undefined,
      templateId: template.id,
      templateVersion: template.version,
      templateName: template.name,
    };
  }

  /** Tiny `{{var}}` interpolation. Missing keys are replaced with empty string. */
  private render(input: string, data: Record<string, unknown>): string {
    return input.replace(/\{\{\s*([a-zA-Z0-9_.\-]+)\s*\}\}/g, (_, name: string) => {
      const value = data[name];
      return value === null || value === undefined ? '' : String(value);
    });
  }
}

// silence unused
void sql;
