/**
 * Stable role identifiers used across the application.
 * These values must match the `roles.slug` column.
 */
export const ROLE_SLUGS = {
  OWNER: 'owner',
  ADMIN: 'admin',
  MEMBER: 'member',
  VIEWER: 'viewer',
} as const;

export type RoleSlug = (typeof ROLE_SLUGS)[keyof typeof ROLE_SLUGS];

export const ALL_ROLE_SLUGS: readonly RoleSlug[] = Object.values(ROLE_SLUGS);

/** Numeric weight for role hierarchy comparisons (higher == more privileged). */
export const ROLE_WEIGHT: Record<RoleSlug, number> = {
  [ROLE_SLUGS.OWNER]: 100,
  [ROLE_SLUGS.ADMIN]: 75,
  [ROLE_SLUGS.MEMBER]: 50,
  [ROLE_SLUGS.VIEWER]: 25,
};

/**
 * Granular permissions. Naming convention: `<resource>.<action>`.
 * Add new permissions here, then map them to roles in `ROLE_PERMISSIONS`.
 */
export const PERMISSIONS = {
  // Workspace
  WORKSPACE_READ: 'workspace.read',
  WORKSPACE_WRITE: 'workspace.write',
  WORKSPACE_DELETE: 'workspace.delete',
  WORKSPACE_MEMBERS_READ: 'workspace.members.read',
  WORKSPACE_MEMBERS_WRITE: 'workspace.members.write',

  // Contacts
  CONTACTS_READ: 'contacts.read',
  CONTACTS_WRITE: 'contacts.write',

  // Segments
  SEGMENTS_READ: 'segments.read',
  SEGMENTS_WRITE: 'segments.write',

  // Workflows
  WORKFLOWS_READ: 'workflows.read',
  WORKFLOWS_WRITE: 'workflows.write',
  WORKFLOWS_PUBLISH: 'workflows.publish',

  // Campaigns
  CAMPAIGNS_READ: 'campaigns.read',
  CAMPAIGNS_WRITE: 'campaigns.write',
  CAMPAIGNS_SEND: 'campaigns.send',

  // Billing
  BILLING_READ: 'billing.read',
  BILLING_WRITE: 'billing.write',

  // Domains (sending domain onboarding)
  DOMAINS_READ: 'domains.read',
  DOMAINS_WRITE: 'domains.write',

  // Transactional emails
  EMAILS_SEND: 'emails.send',
  EMAILS_READ: 'emails.read',
  TEMPLATES_READ: 'templates.read',
  TEMPLATES_WRITE: 'templates.write',

  // Admin (super-admin only)
  ADMIN_READ: 'admin.read',
  ADMIN_WRITE: 'admin.write',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(PERMISSIONS);

/**
 * Default role-permission matrix. Used by the seeder.
 * Owner: everything in the workspace + billing.
 * Admin: workspace mgmt and writes, no destructive billing ops, no workspace deletion.
 * Member: read everything, write content.
 * Viewer: read-only.
 */
export const ROLE_PERMISSIONS: Record<RoleSlug, readonly Permission[]> = {
  [ROLE_SLUGS.OWNER]: [
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.WORKSPACE_WRITE,
    PERMISSIONS.WORKSPACE_DELETE,
    PERMISSIONS.WORKSPACE_MEMBERS_READ,
    PERMISSIONS.WORKSPACE_MEMBERS_WRITE,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.CONTACTS_WRITE,
    PERMISSIONS.CAMPAIGNS_READ,
    PERMISSIONS.CAMPAIGNS_WRITE,
    PERMISSIONS.CAMPAIGNS_SEND,
    PERMISSIONS.BILLING_READ,
    PERMISSIONS.BILLING_WRITE,
    PERMISSIONS.DOMAINS_READ,
    PERMISSIONS.DOMAINS_WRITE,
    PERMISSIONS.EMAILS_SEND,
    PERMISSIONS.EMAILS_READ,
    PERMISSIONS.TEMPLATES_READ,
    PERMISSIONS.TEMPLATES_WRITE,
    PERMISSIONS.SEGMENTS_READ,
    PERMISSIONS.SEGMENTS_WRITE,
    PERMISSIONS.WORKFLOWS_READ,
    PERMISSIONS.WORKFLOWS_WRITE,
    PERMISSIONS.WORKFLOWS_PUBLISH,
  ],
  [ROLE_SLUGS.ADMIN]: [
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.WORKSPACE_WRITE,
    PERMISSIONS.WORKSPACE_MEMBERS_READ,
    PERMISSIONS.WORKSPACE_MEMBERS_WRITE,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.CONTACTS_WRITE,
    PERMISSIONS.CAMPAIGNS_READ,
    PERMISSIONS.CAMPAIGNS_WRITE,
    PERMISSIONS.CAMPAIGNS_SEND,
    PERMISSIONS.BILLING_READ,
    PERMISSIONS.DOMAINS_READ,
    PERMISSIONS.DOMAINS_WRITE,
    PERMISSIONS.EMAILS_SEND,
    PERMISSIONS.EMAILS_READ,
    PERMISSIONS.TEMPLATES_READ,
    PERMISSIONS.TEMPLATES_WRITE,
    PERMISSIONS.SEGMENTS_READ,
    PERMISSIONS.SEGMENTS_WRITE,
    PERMISSIONS.WORKFLOWS_READ,
    PERMISSIONS.WORKFLOWS_WRITE,
    PERMISSIONS.WORKFLOWS_PUBLISH,
  ],
  [ROLE_SLUGS.MEMBER]: [
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.WORKSPACE_MEMBERS_READ,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.CONTACTS_WRITE,
    PERMISSIONS.CAMPAIGNS_READ,
    PERMISSIONS.CAMPAIGNS_WRITE,
    PERMISSIONS.DOMAINS_READ,
    PERMISSIONS.EMAILS_SEND,
    PERMISSIONS.EMAILS_READ,
    PERMISSIONS.TEMPLATES_READ,
    PERMISSIONS.TEMPLATES_WRITE,
    PERMISSIONS.SEGMENTS_READ,
    PERMISSIONS.SEGMENTS_WRITE,
    PERMISSIONS.WORKFLOWS_READ,
    PERMISSIONS.WORKFLOWS_WRITE,
  ],
  [ROLE_SLUGS.VIEWER]: [
    PERMISSIONS.WORKSPACE_READ,
    PERMISSIONS.CONTACTS_READ,
    PERMISSIONS.CAMPAIGNS_READ,
    PERMISSIONS.BILLING_READ,
    PERMISSIONS.DOMAINS_READ,
    PERMISSIONS.EMAILS_READ,
    PERMISSIONS.TEMPLATES_READ,
    PERMISSIONS.SEGMENTS_READ,
    PERMISSIONS.WORKFLOWS_READ,
  ],
};
