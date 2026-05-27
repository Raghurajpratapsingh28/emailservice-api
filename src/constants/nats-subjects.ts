/**
 * NATS subjects used across the system. Centralized to avoid typos.
 * Convention: <bounded-context>.<event>.<version>
 */
export const NATS_SUBJECTS = {
  // Auth events
  AUTH_USER_REGISTERED: 'auth.user.registered.v1',
  AUTH_USER_LOGGED_IN: 'auth.user.logged_in.v1',
  AUTH_USER_LOGGED_OUT: 'auth.user.logged_out.v1',
  AUTH_PASSWORD_RESET_REQUESTED: 'auth.password.reset_requested.v1',
  AUTH_PASSWORD_RESET_COMPLETED: 'auth.password.reset_completed.v1',
  AUTH_EMAIL_VERIFICATION_REQUESTED: 'auth.email.verification_requested.v1',
  AUTH_EMAIL_VERIFIED: 'auth.email.verified.v1',
  AUTH_INVITE_SENT: 'auth.invite.sent.v1',
  AUTH_INVITE_ACCEPTED: 'auth.invite.accepted.v1',

  // Email pipeline
  EMAIL_TRANSACTIONAL_SEND: 'email.transactional.send.v1',
  /** Locked queue contract for /api/v1/emails/send — payload defined in the spec. */
  EMAIL_SEND_TRANSACTIONAL: 'email.send.transactional',
  /** Locked queue contract for campaign send triggers — payload defined in the spec. */
  CAMPAIGN_SEND_START: 'campaign.send.start',

  // Workspaces
  WORKSPACE_CREATED: 'workspace.created.v1',
  WORKSPACE_MEMBER_ADDED: 'workspace.member.added.v1',
  WORKSPACE_MEMBER_REMOVED: 'workspace.member.removed.v1',

  // Domain onboarding
  DOMAIN_CREATED: 'domain.created.v1',
  DOMAIN_VERIFIED: 'domain.verified.v1',
  DOMAIN_VERIFICATION_FAILED: 'domain.verification_failed.v1',
  DOMAIN_DELETED: 'domain.deleted.v1',
  /** Worker subscribes to this and runs an SES `GetIdentityVerificationAttributes` poll. */
  DOMAIN_VERIFY_POLL: 'domain.verify.poll.v1',

  /**
   * Locked queue contract for raw event ingestion.
   * Subject is per-workspace: `events.raw.{workspaceId}`.
   * Use `eventsRaw(workspaceId)` helper to build the subject.
   */
  EVENTS_RAW_PREFIX: 'events.raw',

  /** Locked queue contract for workflow registration — payload: { workspaceId, workflowId }. */
  WORKFLOW_REGISTER: 'workflow.register',
} as const;

/** Build the per-workspace events ingestion subject. */
export function eventsRawSubject(workspaceId: string): string {
  return `${NATS_SUBJECTS.EVENTS_RAW_PREFIX}.${workspaceId}`;
}

export type NatsSubject = (typeof NATS_SUBJECTS)[keyof typeof NATS_SUBJECTS];
