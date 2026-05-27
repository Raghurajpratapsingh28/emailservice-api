import type { FastifyInstance } from 'fastify';
import { PERMISSIONS } from '@constants/rbac.js';
import { requirePermissions } from '@http/middleware/rbac.js';
import { billingController } from './controllers/billing.controller.js';

/**
 * Authenticated billing routes — mounted at `/api/v1/billing`.
 *
 * Permissions:
 *   - read endpoints: billing.read
 *   - write endpoints (checkout, portal, change-plan, cancel, resume): billing.write
 */
export default async function billingRoutes(app: FastifyInstance): Promise<void> {
  const read = [app.authenticate, app.workspaceGuard, requirePermissions(PERMISSIONS.BILLING_READ)];
  const write = [app.authenticate, app.workspaceGuard, requirePermissions(PERMISSIONS.BILLING_WRITE)];

  app.post(
    '/checkout',
    {
      preHandler: write,
      schema: { tags: ['billing'], summary: 'Create Stripe Checkout session', security: [{ bearerAuth: [] }] },
    },
    billingController.createCheckout,
  );

  app.post(
    '/portal',
    {
      preHandler: write,
      schema: { tags: ['billing'], summary: 'Create Stripe Customer Portal session', security: [{ bearerAuth: [] }] },
    },
    billingController.createPortal,
  );

  app.get(
    '/subscription',
    {
      preHandler: read,
      schema: { tags: ['billing'], summary: 'Get current workspace subscription', security: [{ bearerAuth: [] }] },
    },
    billingController.getSubscription,
  );

  app.get(
    '/usage',
    {
      preHandler: read,
      schema: { tags: ['billing'], summary: 'Get current workspace usage vs quota', security: [{ bearerAuth: [] }] },
    },
    billingController.getUsage,
  );

  app.get(
    '/invoices',
    {
      preHandler: read,
      schema: { tags: ['billing'], summary: 'List workspace invoices', security: [{ bearerAuth: [] }] },
    },
    billingController.listInvoices,
  );

  app.post(
    '/cancel',
    {
      preHandler: write,
      schema: { tags: ['billing'], summary: 'Cancel subscription at period end', security: [{ bearerAuth: [] }] },
    },
    billingController.cancel,
  );

  app.post(
    '/resume',
    {
      preHandler: write,
      schema: { tags: ['billing'], summary: 'Resume a pending cancellation', security: [{ bearerAuth: [] }] },
    },
    billingController.resume,
  );

  app.post(
    '/change-plan',
    {
      preHandler: write,
      schema: { tags: ['billing'], summary: 'Change subscription plan / interval', security: [{ bearerAuth: [] }] },
    },
    billingController.changePlan,
  );
}

/**
 * Stripe webhook route — mounted at `/api/v1/webhooks/stripe`.
 *
 * Special characteristics:
 *   - No JWT/workspace auth — Stripe-Signature header is the auth.
 *   - Receives raw body (Buffer) so signature verification can be performed.
 *   - Registers an `application/json` content-type parser scoped to this
 *     plugin scope only, so it doesn't override the global JSON parser.
 */
export async function stripeWebhookRoutes(app: FastifyInstance): Promise<void> {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body: Buffer, done) => {
      // Attach raw body for the controller; do not parse to JSON here so the
      // webhook signature check sees the exact bytes Stripe signed.
      (req as typeof req & { rawBody?: Buffer }).rawBody = body;
      done(null, body);
    },
  );

  app.post(
    '/stripe',
    {
      schema: {
        tags: ['webhooks'],
        summary: 'Stripe webhook endpoint',
        // No security: the Stripe-Signature header is verified by the handler.
      },
    },
    billingController.stripeWebhook,
  );
}
