import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance } from 'fastify';
import { config } from '@config/index.js';
import { parseDurationToSeconds } from '@shared/utils/time.js';
import { createJtiDenylist, type JtiDenylist } from '@shared/cache/jti-denylist.js';
import { createIdempotencyCache } from '@shared/cache/idempotency.js';
import { createSesIdentityClient } from '@shared/email/ses-identity.js';
import { AuditService } from '@modules/auth/services/audit.service.js';
import { AuthService } from '@modules/auth/services/auth.service.js';
import { PasswordService } from '@modules/auth/services/password.service.js';
import { RbacService } from '@modules/auth/services/rbac.service.js';
import { TokenService } from '@modules/auth/services/token.service.js';
import { WorkspaceRepository } from '@modules/workspaces/repositories/workspace.repository.js';
import { WorkspaceService } from '@modules/workspaces/services/workspace.service.js';
import { DomainRepository } from '@modules/domains/repositories/domain.repository.js';
import { DomainService } from '@modules/domains/services/domain.service.js';
import { TransactionalRepository } from '@modules/transactional/repositories/transactional.repository.js';
import { TransactionalService } from '@modules/transactional/services/transactional.service.js';
import { CampaignRepository } from '@modules/campaigns/repositories/campaign.repository.js';
import { CampaignService } from '@modules/campaigns/services/campaign.service.js';
import { EventRepository } from '@modules/events/repositories/event.repository.js';
import { EventService } from '@modules/events/services/event.service.js';
import { ContactRepository } from '@modules/contacts/repositories/contact.repository.js';
import { ContactService } from '@modules/contacts/services/contact.service.js';
import { SegmentRepository } from '@modules/segments/repositories/segment.repository.js';
import { SegmentService } from '@modules/segments/services/segment.service.js';
import { WorkflowRepository } from '@modules/workflows/repositories/workflow.repository.js';
import { WorkflowService } from '@modules/workflows/services/workflow.service.js';
import { BillingRepository } from '@modules/billing/repositories/billing.repository.js';
import { BillingService } from '@modules/billing/services/billing.service.js';
import { StripeWebhookHandler } from '@modules/billing/stripe-webhook.handler.js';
import { createStripeClient, createStripeStub } from '@shared/payments/stripe.js';
import { ApiKeyRepository } from '@modules/api-keys/repositories/api-key.repository.js';
import { ApiKeyService } from '@modules/api-keys/services/api-key.service.js';

declare module 'fastify' {
  interface FastifyInstance {
    services: {
      auth: AuthService;
      tokens: TokenService;
      passwords: PasswordService;
      audit: AuditService;
      rbac: RbacService;
      jtiDenylist: JtiDenylist;
      workspaces: WorkspaceService;
      domains: DomainService;
      transactional: TransactionalService;
      campaigns: CampaignService;
      events: EventService;
      contacts: ContactService;
      segments: SegmentService;
      workflows: WorkflowService;
      billing: BillingService;
      stripeWebhook: StripeWebhookHandler;
      apiKeys: ApiKeyService;
    };
  }
}

export default fp(
  async function authPlugin(app: FastifyInstance) {
    if (!app.hasDecorator('db') || !app.hasDecorator('redis') || !app.hasDecorator('nats')) {
      throw new Error(
        '[auth-plugin] requires database, redis, and nats plugins to be registered first',
      );
    }

    await app.register(fastifyJwt, {
      secret: config.JWT_ACCESS_SECRET,
      sign: {
        algorithm: 'HS256',
        iss: config.JWT_ISSUER,
        aud: config.JWT_AUDIENCE,
        expiresIn: parseDurationToSeconds(config.JWT_ACCESS_TTL),
      },
      verify: {
        algorithms: ['HS256'],
        allowedIss: config.JWT_ISSUER,
        allowedAud: config.JWT_AUDIENCE,
      },
    });

    const jtiDenylist = createJtiDenylist(app.redis);
    const passwords = new PasswordService();
    const tokens = new TokenService(app.db, jtiDenylist);
    const audit = new AuditService(app.db, app.log);
    const rbac = new RbacService(app.db, app.redis);

    const workspaceRepo = new WorkspaceRepository(app.db);
    const workspaces = new WorkspaceService(app.db, workspaceRepo, rbac, audit, tokens, app.nats);

    const idempotency = createIdempotencyCache(app.redis);
    const transactionalRepo = new TransactionalRepository(app.db);

    // ─── Billing ─────────────────────────────────────────────────────────
    // The Stripe client is constructed lazily; it throws if STRIPE_SECRET_KEY
    // is unset. In dev/test without Stripe configured, billing endpoints will
    // fail fast with STRIPE_NOT_CONFIGURED — by design.
    const billingRepo = new BillingRepository(app.db);
    let billing: BillingService;
    let stripeWebhook: StripeWebhookHandler;
    if (config.STRIPE_SECRET_KEY) {
      const stripeClient = createStripeClient();
      billing = new BillingService(app.db, billingRepo, stripeClient, app.redis, audit, app.log);
      stripeWebhook = new StripeWebhookHandler(app.db, billingRepo, billing, stripeClient, app.redis, audit, app.log);
    } else {
      // Build a service that always throws so tests / dev can still boot the
      // app without Stripe configured — but any billing call will be rejected.
      const stub = createStripeStub();
      billing = new BillingService(app.db, billingRepo, stub, app.redis, audit, app.log);
      stripeWebhook = new StripeWebhookHandler(app.db, billingRepo, billing, stub, app.redis, audit, app.log);
    }

    const domainRepo = new DomainRepository(app.db);
    const sesIdentity = createSesIdentityClient();
    const domains = new DomainService(app.db, domainRepo, sesIdentity, audit, app.nats, app.log, billing);

    const auth = new AuthService(app.db, tokens, passwords, audit, rbac, app.nats, app.email, billing);

    const transactional = new TransactionalService(
      app.db,
      transactionalRepo,
      idempotency,
      app.nats,
      audit,
      app.log,
      billing,
    );

    const campaignRepo = new CampaignRepository(app.db);
    const campaigns = new CampaignService(app.db, campaignRepo, app.nats, audit, app.log, billing);

    const eventRepo = new EventRepository(app.db);
    const events = new EventService(app.db, eventRepo, app.redis, app.nats, app.log, billing);

    const contactRepo = new ContactRepository(app.db);
    const contacts = new ContactService(app.db, contactRepo, audit, app.log, billing);

    const segmentRepo = new SegmentRepository(app.db);
    const segments = new SegmentService(segmentRepo, app.nats, audit, app.log, billing);

    const workflowRepo = new WorkflowRepository(app.db);
    const workflows = new WorkflowService(workflowRepo, app.nats, app.redis, audit, app.log, billing);

    const apiKeyRepo = new ApiKeyRepository(app.db);
    const apiKeys = new ApiKeyService(apiKeyRepo, audit, app.log, billing);

    const subscriber = app.redis.duplicate();
    await rbac.startInvalidationListener(subscriber);

    app.decorate('services', {
      auth,
      tokens,
      passwords,
      audit,
      rbac,
      jtiDenylist,
      workspaces,
      domains,
      transactional,
      campaigns,
      events,
      contacts,
      segments,
      workflows,
      billing,
      stripeWebhook,
      apiKeys,
    });

    app.addHook('onClose', async () => {
      try {
        await rbac.stopInvalidationListener();
      } finally {
        await subscriber.quit().catch(() => undefined);
      }
    });
  },
  {
    name: 'auth-plugin',
    dependencies: ['database-plugin', 'redis-plugin', 'nats-plugin'],
  },
);
