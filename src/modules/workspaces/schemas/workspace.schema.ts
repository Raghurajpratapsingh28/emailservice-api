import { z } from 'zod';
import { ALL_ROLE_SLUGS, ROLE_SLUGS } from '@constants/rbac.js';
import { ALL_PLAN_TIERS } from '@constants/plan-limits.js';
import {
  paginationQuerySchema,
  slugSchema,
  uuidSchema,
} from '@shared/validators/common.js';

// Roles assignable in member-update; owner is excluded — use transfer-ownership instead.
const ASSIGNABLE_ROLES = ALL_ROLE_SLUGS.filter((r) => r !== ROLE_SLUGS.OWNER) as ReadonlyArray<
  Exclude<(typeof ALL_ROLE_SLUGS)[number], 'owner'>
>;

// ─── Common params ─────────────────────────────────────────────────────────

export const workspaceIdParamSchema = z.object({
  workspaceId: uuidSchema,
});
export type WorkspaceIdParams = z.infer<typeof workspaceIdParamSchema>;

export const workspaceMemberParamsSchema = z.object({
  workspaceId: uuidSchema,
  memberId: uuidSchema,
});
export type WorkspaceMemberParams = z.infer<typeof workspaceMemberParamsSchema>;

// ─── Bodies ────────────────────────────────────────────────────────────────

export const createWorkspaceBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: slugSchema.optional(),
  plan: z.enum(ALL_PLAN_TIERS as [string, ...string[]]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CreateWorkspaceBody = z.infer<typeof createWorkspaceBodySchema>;

export const updateWorkspaceBodySchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    slug: slugSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    /** Required for optimistic concurrency. */
    version: z.number().int().positive(),
  })
  .refine(
    (v) => v.name !== undefined || v.slug !== undefined || v.metadata !== undefined,
    { message: 'At least one of name, slug, metadata must be provided' },
  );
export type UpdateWorkspaceBody = z.infer<typeof updateWorkspaceBodySchema>;

export const switchWorkspaceBodySchema = z.object({
  workspaceId: uuidSchema,
});
export type SwitchWorkspaceBody = z.infer<typeof switchWorkspaceBodySchema>;

export const updateMemberRoleBodySchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES as [string, ...string[]]),
});
export type UpdateMemberRoleBody = z.infer<typeof updateMemberRoleBodySchema>;

export const transferOwnershipBodySchema = z.object({
  newOwnerUserId: uuidSchema,
});
export type TransferOwnershipBody = z.infer<typeof transferOwnershipBodySchema>;

// ─── Settings ──────────────────────────────────────────────────────────────

const brandingSchema = z
  .object({
    logoUrl: z.string().url().max(2048).optional(),
    primaryColor: z
      .string()
      .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
      .optional(),
    faviconUrl: z.string().url().max(2048).optional(),
  })
  .strict();

const emailDefaultsSchema = z
  .object({
    fromName: z.string().trim().min(1).max(100).optional(),
    fromEmail: z.string().email().max(254).optional(),
    replyTo: z.string().email().max(254).optional(),
    footerHtml: z.string().max(10_000).optional(),
  })
  .strict();

const webhookSettingsSchema = z
  .object({
    url: z.string().url().max(2048).optional(),
    secret: z.string().min(16).max(256).optional(),
    events: z.array(z.string().min(1).max(100)).max(50).optional(),
  })
  .strict();

const featureFlagsSchema = z.record(z.string(), z.boolean());

export const updateSettingsBodySchema = z
  .object({
    timezone: z.string().min(2).max(64).optional(),
    locale: z.string().min(2).max(16).optional(),
    branding: brandingSchema.optional(),
    emailDefaults: emailDefaultsSchema.optional(),
    featureFlags: featureFlagsSchema.optional(),
    webhookSettings: webhookSettingsSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one setting must be provided' });
export type UpdateSettingsBody = z.infer<typeof updateSettingsBodySchema>;

// ─── Listing ───────────────────────────────────────────────────────────────

export const listMembersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
  role: z.enum(ALL_ROLE_SLUGS as [string, ...string[]]).optional(),
});
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;
