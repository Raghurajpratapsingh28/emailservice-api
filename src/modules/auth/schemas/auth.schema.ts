import { z } from 'zod';
import { ALL_ROLE_SLUGS } from '@constants/rbac.js';
import {
  emailSchema,
  opaqueTokenSchema,
  passwordSchema,
  uuidSchema,
} from '@shared/validators/common.js';

// ─── Request bodies ────────────────────────────────────────────────────────

export const signupBodySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  workspaceName: z.string().trim().min(1).max(200).optional(),
});
export type SignupBody = z.infer<typeof signupBodySchema>;

export const loginBodySchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(20).max(512),
});
export type RefreshBody = z.infer<typeof refreshBodySchema>;

export const logoutBodySchema = z.object({
  refreshToken: z.string().min(20).max(512).optional(),
});
export type LogoutBody = z.infer<typeof logoutBodySchema>;

export const forgotPasswordBodySchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;

export const resetPasswordBodySchema = z.object({
  token: opaqueTokenSchema,
  password: passwordSchema,
});
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;

export const verifyEmailBodySchema = z.object({
  token: opaqueTokenSchema,
});
export type VerifyEmailBody = z.infer<typeof verifyEmailBodySchema>;

export const resendVerificationBodySchema = z.object({}).strict();

export const inviteRoleSlugs = ALL_ROLE_SLUGS.filter((r) => r !== 'owner');

export const inviteBodySchema = z.object({
  email: emailSchema,
  role: z.enum(inviteRoleSlugs as [typeof inviteRoleSlugs[number], ...typeof inviteRoleSlugs[number][]]),
});
export type InviteBody = z.infer<typeof inviteBodySchema>;

export const acceptInviteBodySchema = z.object({
  token: opaqueTokenSchema,
  password: passwordSchema.optional(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
});
export type AcceptInviteBody = z.infer<typeof acceptInviteBodySchema>;

export const revokeSessionParamsSchema = z.object({
  sessionId: uuidSchema,
});
export type RevokeSessionParams = z.infer<typeof revokeSessionParamsSchema>;

// ─── Headers ───────────────────────────────────────────────────────────────

export const workspaceHeaderSchema = z.object({
  'x-workspace-id': uuidSchema,
});
