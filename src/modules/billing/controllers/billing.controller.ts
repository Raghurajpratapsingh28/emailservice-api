import type { FastifyReply, FastifyRequest } from 'fastify';
import { ForbiddenError, UnauthorizedError, ValidationError } from '@shared/errors/app-errors.js';
import {
  PLAN_QUOTAS,
  PLAN_LIMITS,
  RESOURCE_LIMITS,
  BILLING_PLANS,
  type BillingPlan,
} from '@constants/plan-limits.js';
import {
  changePlanBodySchema,
  createCheckoutBodySchema,
  listInvoicesQuerySchema,
} from '../schemas/billing.schema.js';

function actorCtx(req: FastifyRequest) {
  if (!req.authedUser) throw new UnauthorizedError();
  return {
    user: req.authedUser,
    ipAddress: req.ip,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
  };
}

function workspaceId(req: FastifyRequest): string {
  if (!req.workspace) throw new ForbiddenError('Workspace context required', 'WORKSPACE_REQUIRED');
  return req.workspace.id;
}

export const billingController = {
  // POST /api/v1/billing/checkout
  async createCheckout(req: FastifyRequest, reply: FastifyReply) {
    const body = createCheckoutBodySchema.parse(req.body);
    const result = await req.server.services.billing.createCheckoutSession(
      workspaceId(req),
      body,
      actorCtx(req),
    );
    return reply.status(200).send(result);
  },

  // POST /api/v1/billing/portal
  async createPortal(req: FastifyRequest, reply: FastifyReply) {
    const result = await req.server.services.billing.createPortalSession(
      workspaceId(req),
      actorCtx(req),
    );
    return reply.status(200).send(result);
  },

  // GET /api/v1/billing/subscription
  async getSubscription(req: FastifyRequest, reply: FastifyReply) {
    const sub = await req.server.services.billing.getSubscription(workspaceId(req));
    return reply.status(200).send({
      plan: sub.plan,
      status: sub.status,
      billingInterval: sub.billingInterval,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      canceledAt: sub.canceledAt,
      trialEndsAt: sub.trialEndsAt,
    });
  },

  // GET /api/v1/billing/usage
  async getUsage(req: FastifyRequest, reply: FastifyReply) {
    const usage = await req.server.services.billing.getUsage(workspaceId(req));
    return reply.status(200).send(usage);
  },

  // GET /api/v1/billing/invoices
  async listInvoices(req: FastifyRequest, reply: FastifyReply) {
    const query = listInvoicesQuerySchema.parse(req.query);
    const result = await req.server.services.billing.listInvoices(workspaceId(req), query);
    return reply.status(200).send({
      ...result,
      items: result.items.map((inv) => ({
        id: inv.stripeInvoiceId,
        amountDue: inv.amountDue,
        amountPaid: inv.amountPaid,
        currency: inv.currency,
        status: inv.status,
        hostedInvoiceUrl: inv.hostedInvoiceUrl,
        pdfUrl: inv.invoicePdf,
        createdAt: inv.invoiceDate ?? inv.createdAt,
      })),
    });
  },

  // POST /api/v1/billing/cancel
  async cancel(req: FastifyRequest, reply: FastifyReply) {
    const sub = await req.server.services.billing.cancelSubscription(workspaceId(req), actorCtx(req));
    return reply.status(200).send({
      plan: sub.plan,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      canceledAt: sub.canceledAt,
      currentPeriodEnd: sub.currentPeriodEnd,
    });
  },

  // POST /api/v1/billing/resume
  async resume(req: FastifyRequest, reply: FastifyReply) {
    const sub = await req.server.services.billing.resumeSubscription(workspaceId(req), actorCtx(req));
    return reply.status(200).send({
      plan: sub.plan,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    });
  },

  // POST /api/v1/billing/change-plan
  async changePlan(req: FastifyRequest, reply: FastifyReply) {
    const body = changePlanBodySchema.parse(req.body);
    const sub = await req.server.services.billing.changePlan(workspaceId(req), body, actorCtx(req));
    return reply.status(200).send({
      plan: sub.plan,
      billingInterval: sub.billingInterval,
      status: sub.status,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
    });
  },

  // POST /api/v1/webhooks/stripe — raw body, no auth, signature is the auth.
  async stripeWebhook(req: FastifyRequest, reply: FastifyReply) {
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string' || signature.length === 0) {
      throw new ValidationError('Missing Stripe-Signature header', { code: 'WEBHOOK_SIGNATURE_INVALID' });
    }
    // The raw body is attached by the content-type parser registered for the webhook route.
    const rawBody = (req as FastifyRequest & { rawBody?: Buffer }).rawBody ?? (req.body as Buffer | string);
    if (!rawBody) {
      throw new ValidationError('Missing webhook payload', { code: 'WEBHOOK_SIGNATURE_INVALID' });
    }
    const result = await req.server.services.stripeWebhook.handle(rawBody, signature);
    return reply.status(200).send(result);
  },

  // GET /api/v1/billing/plans — public, no auth required.
  async listPlans(_req: FastifyRequest, reply: FastifyReply) {
    const PLAN_PRICING: Record<BillingPlan, { monthly: number; yearly: number }> = {
      free: { monthly: 0, yearly: 0 },
      starter: { monthly: 12, yearly: 120 },
      growth: { monthly: 39, yearly: 390 },
      pro: { monthly: 99, yearly: 990 },
      scale: { monthly: 249, yearly: 2490 },
    };

    const PLAN_FEATURES: Record<BillingPlan, string[]> = {
      free: [
        '1,000 contacts',
        '3,000 emails/month',
        'Basic automation',
        '1 custom domain',
        'Mailvex branding',
      ],
      starter: [
        '10,000 contacts',
        '25,000 emails/month',
        'Automation workflows',
        'Segments',
        'Custom domains',
        'No branding',
      ],
      growth: [
        '50,000 contacts',
        '150,000 emails/month',
        'Advanced workflows',
        'API access',
        'Webhooks',
        'Analytics',
      ],
      pro: [
        '150,000 contacts',
        '500,000 emails/month',
        'Priority support',
        'Team members',
        'Advanced permissions',
      ],
      scale: [
        '500,000 contacts',
        '2,000,000 emails/month',
        'Dedicated onboarding',
        'SLA',
        'Premium support',
      ],
    };

    const plans = BILLING_PLANS.map((planId) => ({
      id: planId,
      name: planId.charAt(0).toUpperCase() + planId.slice(1),
      pricing: PLAN_PRICING[planId],
      quotas: PLAN_QUOTAS[planId],
      limits: PLAN_LIMITS[planId as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.free,
      resources: RESOURCE_LIMITS[planId as keyof typeof RESOURCE_LIMITS] ?? RESOURCE_LIMITS.free,
      features: PLAN_FEATURES[planId],
      isFree: planId === 'free',
      isPopular: planId === 'growth',
    }));

    return reply
      .header('cache-control', 'public, max-age=3600, s-maxage=86400')
      .status(200)
      .send({ plans });
  },
};
