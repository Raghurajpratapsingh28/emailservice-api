import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '@shared/database/client.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '@shared/errors/app-errors.js';
import type { Paginated } from '@shared/types/index.js';
import type { Contact } from '@shared/database/schema/contacts.js';
import type { AuditService } from '@modules/auth/services/audit.service.js';
import type { BillingService } from '@modules/billing/services/billing.service.js';
import { quotasForPlan } from '@constants/plan-limits.js';
import type { ContactRepository, ListContactsFilter } from '../repositories/contact.repository.js';
import type { CreateContactBody, ListContactsQuery, UpdateContactBody } from '../schemas/contact.schema.js';
import {
  contactsCreated,
  contactsUpdated,
} from '@observability/contacts-metrics.js';

export interface ActorContext {
  user: { id: string };
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface ContactWithTags extends Contact {
  tags: string[];
  segments?: Array<{ id: string; name: string }>;
}

export class ContactService {
  public constructor(
    private readonly db: Database,
    private readonly repo: ContactRepository,
    private readonly audit: AuditService,
    private readonly log: FastifyBaseLogger,
    private readonly billing: BillingService,
  ) {}

  public async createContact(
    workspaceId: string,
    body: CreateContactBody,
    actor: ActorContext,
  ): Promise<ContactWithTags> {
    const email = body.email?.toLowerCase();

    if (email) {
      const existing = await this.repo.findByEmail(workspaceId, email);
      if (existing) {
        throw new ConflictError('Contact with this email already exists', 'CONTACT_ALREADY_EXISTS');
      }
    }

    const sub = await this.billing.getSubscription(workspaceId);
    const quotas = quotasForPlan(sub.plan);
    const contactCount = await this.repo.countByWorkspace(workspaceId);
    if (contactCount >= quotas.contacts) {
      throw new ForbiddenError(
        `Contact limit (${quotas.contacts}) reached for your plan`,
        'QUOTA_EXCEEDED',
      );
    }

    const contact = await this.db.transaction(async (tx) => {
      const created = await this.repo.insert(tx, {
        workspaceId,
        email,
        anonymousId: body.anonymousId,
        externalId: body.externalId,
        firstName: body.firstName,
        lastName: body.lastName,
        phone: body.phone,
        lifecycleStage: body.lifecycleStage ?? 'lead',
        leadScore: body.leadScore ?? 0,
        properties: (body.properties ?? {}) as Record<string, unknown>,
        source: (body.source ?? {}) as Record<string, unknown>,
      });

      if (body.tags && body.tags.length > 0) {
        await this.repo.replaceTags(tx, workspaceId, created.id, body.tags);
      }

      return created;
    });

    contactsCreated.inc({ workspace_id: workspaceId });
    this.billing.recordUsage(workspaceId, 'contacts', 1).catch(() => undefined);
    this.log.info({ contactId: contact.id, workspaceId }, 'contact created');

    await this.audit.record({
      action: 'contact.created',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'contact',
      targetId: contact.id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      success: true,
    }).catch(() => undefined);

    return { ...contact, tags: body.tags ?? [] };
  }

  public async updateContact(
    workspaceId: string,
    id: string,
    body: UpdateContactBody,
    actor: ActorContext,
  ): Promise<ContactWithTags> {
    const existing = await this.repo.findById(workspaceId, id);
    if (!existing) {
      throw new NotFoundError('Contact not found', 'CONTACT_NOT_FOUND');
    }

    if (body.email) {
      const email = body.email.toLowerCase();
      const dup = await this.repo.findByEmail(workspaceId, email);
      if (dup && dup.id !== id) {
        throw new ConflictError('Email already in use by another contact', 'CONTACT_ALREADY_EXISTS');
      }
    }

    const updated = await this.db.transaction(async (tx) => {
      const patch: Partial<Contact> = {};
      if (body.email !== undefined) patch.email = body.email.toLowerCase();
      if (body.firstName !== undefined) patch.firstName = body.firstName;
      if (body.lastName !== undefined) patch.lastName = body.lastName;
      if (body.phone !== undefined) patch.phone = body.phone;
      if (body.lifecycleStage !== undefined) patch.lifecycleStage = body.lifecycleStage;
      if (body.leadScore !== undefined) patch.leadScore = body.leadScore;
      if (body.properties !== undefined) patch.properties = body.properties as Record<string, unknown>;
      if (body.emailSuppressed !== undefined) patch.emailSuppressed = body.emailSuppressed;
      if (body.globallySuppressed !== undefined) patch.globallySuppressed = body.globallySuppressed;
      if (body.unsubscribed !== undefined) patch.unsubscribed = body.unsubscribed;

      const contact = await this.repo.update(workspaceId, id, patch);
      if (!contact) throw new NotFoundError('Contact not found', 'CONTACT_NOT_FOUND');

      if (body.tags !== undefined) {
        await this.repo.replaceTags(tx, workspaceId, id, body.tags);
      }

      return contact;
    });

    contactsUpdated.inc({ workspace_id: workspaceId });
    this.log.info({ contactId: id, workspaceId }, 'contact updated');

    await this.audit.record({
      action: 'contact.updated',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'contact',
      targetId: id,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);

    const tags = body.tags !== undefined
      ? body.tags
      : await this.repo.getTagsForContact(id);

    return { ...updated, tags };
  }

  public async getContact(workspaceId: string, id: string): Promise<ContactWithTags> {
    const contact = await this.repo.findById(workspaceId, id);
    if (!contact) throw new NotFoundError('Contact not found', 'CONTACT_NOT_FOUND');
    const tags = await this.repo.getTagsForContact(id);
    return { ...contact, tags };
  }

  public async listContacts(
    workspaceId: string,
    query: ListContactsQuery,
  ): Promise<Paginated<ContactWithTags>> {
    const filter: ListContactsFilter = {
      workspaceId,
      search: query.search,
      tags: query.tags,
      lifecycleStage: query.lifecycleStage,
      emailSuppressed: query.emailSuppressed,
      unsubscribed: query.unsubscribed,
      fromDate: query.fromDate,
      toDate: query.toDate,
      page: query.page,
      pageSize: query.pageSize,
    };

    const { items, total } = await this.repo.list(filter);
    const ids = items.map((c) => c.id);
    const tagsMap = await this.repo.getTagsForContacts(ids);

    return {
      items: items.map((c) => ({ ...c, tags: tagsMap.get(c.id) ?? [] })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  public async deleteContact(
    workspaceId: string,
    id: string,
    actor: ActorContext,
  ): Promise<void> {
    const deleted = await this.repo.softDelete(workspaceId, id);
    if (!deleted) throw new NotFoundError('Contact not found', 'CONTACT_NOT_FOUND');

    this.log.info({ contactId: id, workspaceId }, 'contact deleted');
    await this.audit.record({
      action: 'contact.deleted',
      actorUserId: actor.user.id,
      workspaceId,
      targetType: 'contact',
      targetId: id,
      ipAddress: actor.ipAddress,
      success: true,
    }).catch(() => undefined);
  }

  public async bulkImport(
    workspaceId: string,
    items: CreateContactBody[],
    actor: ActorContext,
  ): Promise<{ imported: number; skipped: number }> {
    const sub = await this.billing.getSubscription(workspaceId);
    const quotas = quotasForPlan(sub.plan);
    const contactCount = await this.repo.countByWorkspace(workspaceId);
    if (contactCount + items.length > quotas.contacts) {
      throw new ForbiddenError(
        `Contact limit (${quotas.contacts}) reached for your plan`,
        'QUOTA_EXCEEDED',
      );
    }

    const values = items.map((item) => ({
      workspaceId,
      email: item.email?.toLowerCase(),
      anonymousId: item.anonymousId,
      externalId: item.externalId,
      firstName: item.firstName,
      lastName: item.lastName,
      phone: item.phone,
      lifecycleStage: item.lifecycleStage ?? 'lead',
      leadScore: item.leadScore ?? 0,
      properties: (item.properties ?? {}) as Record<string, unknown>,
      source: (item.source ?? {}) as Record<string, unknown>,
    }));

    const inserted = await this.repo.insertBulk(this.db, values);
    const imported = inserted.length;
    const skipped = items.length - imported;

    // Attach tags for inserted contacts
    for (let i = 0; i < inserted.length; i++) {
      const contact = inserted[i]!;
      const originalItem = items.find(
        (it) => it.email?.toLowerCase() === contact.email || it.anonymousId === contact.anonymousId,
      );
      if (originalItem?.tags && originalItem.tags.length > 0) {
        await this.repo.addTags(workspaceId, contact.id, originalItem.tags);
      }
    }

    contactsCreated.inc({ workspace_id: workspaceId }, imported);
    this.billing.recordUsage(workspaceId, 'contacts', imported).catch(() => undefined);
    this.log.info({ workspaceId, imported, skipped }, 'bulk import completed');

    await this.audit.record({
      action: 'contact.bulk_imported',
      actorUserId: actor.user.id,
      workspaceId,
      ipAddress: actor.ipAddress,
      success: true,
      metadata: { imported, skipped },
    }).catch(() => undefined);
    return { imported, skipped };
  }

  public async suppressContact(
    workspaceId: string,
    id: string,
    _actor: ActorContext,
  ): Promise<ContactWithTags> {
    const updated = await this.repo.update(workspaceId, id, { emailSuppressed: true });
    if (!updated) throw new NotFoundError('Contact not found', 'CONTACT_NOT_FOUND');
    this.log.info({ contactId: id, workspaceId }, 'contact suppressed');
    const tags = await this.repo.getTagsForContact(id);
    return { ...updated, tags };
  }

  public async unsuppressContact(
    workspaceId: string,
    id: string,
    _actor: ActorContext,
  ): Promise<ContactWithTags> {
    const updated = await this.repo.update(workspaceId, id, { emailSuppressed: false });
    if (!updated) throw new NotFoundError('Contact not found', 'CONTACT_NOT_FOUND');
    this.log.info({ contactId: id, workspaceId }, 'contact unsuppressed');
    const tags = await this.repo.getTagsForContact(id);
    return { ...updated, tags };
  }
}
