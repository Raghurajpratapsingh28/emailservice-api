import { createHash, randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { ForbiddenError, NotFoundError } from '@shared/errors/app-errors.js';
import type { ApiKey } from '@shared/database/schema/api-keys.js';
import type { AuditService } from '@modules/auth/services/audit.service.js';
import type { BillingService } from '@modules/billing/services/billing.service.js';
import { resourceLimitsForPlan } from '@constants/plan-limits.js';
import type { ApiKeyRepository, ListApiKeysFilter } from '../repositories/api-key.repository.js';
import type { CreateApiKeyBody, ListApiKeysQuery } from '../schemas/api-key.schema.js';

export interface ActorContext {
  user: { id: string };
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

/** Key format: eiq_live_<40 random hex chars> */
const KEY_PREFIX_LABEL = 'eiq_live_';
const KEY_DISPLAY_LENGTH = 12; // chars of plaintext shown in UI

function generatePlaintextKey(): string {
  return `${KEY_PREFIX_LABEL}${randomBytes(20).toString('hex')}`;
}

function hashKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

export interface CreatedApiKey {
  apiKey: ApiKey;
  /** Only returned once at creation time — never stored in plaintext. */
  plaintextKey: string;
}

export class ApiKeyService {
  public constructor(
    private readonly repo: ApiKeyRepository,
    private readonly audit: AuditService,
    private readonly log: FastifyBaseLogger,
    private readonly billing: BillingService,
  ) {}

  public async createApiKey(
    workspaceId: string,
    body: CreateApiKeyBody,
    actor: ActorContext,
  ): Promise<CreatedApiKey> {
    const sub = await this.billing.getSubscription(workspaceId);
    const limits = resourceLimitsForPlan(sub.plan);
    if (Number.isFinite(limits.maxApiKeys)) {
      const keyCount = await this.repo.countActiveByWorkspace(workspaceId);
      if (keyCount >= limits.maxApiKeys) {
        throw new ForbiddenError(
          `API key limit (${limits.maxApiKeys}) reached for your plan`,
          'QUOTA_EXCEEDED',
        );
      }
    }

    const plaintext = generatePlaintextKey();
    const keyHash = hashKey(plaintext);
    const keyPrefix = plaintext.slice(0, KEY_DISPLAY_LENGTH);
    const scope = body.scopes.join(',');

    const apiKey = await this.repo.insert({
      workspaceId,
      name: body.name,
      keyHash,
      keyPrefix,
      scope,
      rateLimit: body.rateLimit,
      isActive: true,
      createdBy: actor.user.id,
    });

    await this.audit.record({
      workspaceId,
      actorUserId: actor.user.id,
      action: 'api_key.created',
      targetType: 'api_key',
      targetId: apiKey.id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { name: body.name, scopes: body.scopes },
    });

    return { apiKey, plaintextKey: plaintext };
  }

  public async listApiKeys(
    workspaceId: string,
    query: ListApiKeysQuery,
  ): Promise<{ items: ApiKey[]; total: number; page: number; pageSize: number }> {
    const filter: ListApiKeysFilter = {
      workspaceId,
      page: query.page,
      pageSize: query.pageSize,
    };
    const { items, total } = await this.repo.list(filter);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  public async getApiKey(workspaceId: string, id: string): Promise<ApiKey> {
    const apiKey = await this.repo.findById(workspaceId, id);
    if (!apiKey) throw new NotFoundError('API key not found', 'API_KEY_NOT_FOUND');
    return apiKey;
  }

  public async revokeApiKey(
    workspaceId: string,
    id: string,
    actor: ActorContext,
  ): Promise<void> {
    const revoked = await this.repo.revoke(workspaceId, id);
    if (!revoked) throw new NotFoundError('API key not found', 'API_KEY_NOT_FOUND');

    await this.audit.record({
      workspaceId,
      actorUserId: actor.user.id,
      action: 'api_key.revoked',
      targetType: 'api_key',
      targetId: id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      requestId: actor.requestId,
      metadata: { name: revoked.name },
    });
  }

  /** Called by the SDK auth middleware on every inbound request. */
  public async verifyKey(plaintext: string): Promise<ApiKey | null> {
    const keyHash = hashKey(plaintext);
    const apiKey = await this.repo.findByHash(keyHash);
    if (!apiKey) return null;

    // Fire-and-forget — don't block the request path
    this.repo.touchLastUsed(apiKey.id).catch((err) => {
      this.log.warn({ err, apiKeyId: apiKey.id }, 'failed to update lastUsedAt');
    });

    return apiKey;
  }
}
