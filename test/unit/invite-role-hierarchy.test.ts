import { describe, expect, it } from 'vitest';
import { ROLE_SLUGS, ROLE_WEIGHT, type RoleSlug } from '@constants/rbac.js';

/**
 * The inviteUser hardening (F5) requires:
 *   ROLE_WEIGHT[invitedRole] < ROLE_WEIGHT[inviterRole]
 *
 * This test pins that invariant against ALL inviter/invited combinations
 * so changes to the matrix are caught.
 */
describe('invite role hierarchy', () => {
  const ALLOWED: ReadonlyArray<readonly [RoleSlug, RoleSlug]> = [
    [ROLE_SLUGS.OWNER, ROLE_SLUGS.ADMIN],
    [ROLE_SLUGS.OWNER, ROLE_SLUGS.MEMBER],
    [ROLE_SLUGS.OWNER, ROLE_SLUGS.VIEWER],
    [ROLE_SLUGS.ADMIN, ROLE_SLUGS.MEMBER],
    [ROLE_SLUGS.ADMIN, ROLE_SLUGS.VIEWER],
    [ROLE_SLUGS.MEMBER, ROLE_SLUGS.VIEWER],
  ];

  const FORBIDDEN: ReadonlyArray<readonly [RoleSlug, RoleSlug]> = [
    [ROLE_SLUGS.OWNER, ROLE_SLUGS.OWNER],
    [ROLE_SLUGS.ADMIN, ROLE_SLUGS.OWNER],
    [ROLE_SLUGS.ADMIN, ROLE_SLUGS.ADMIN],
    [ROLE_SLUGS.MEMBER, ROLE_SLUGS.OWNER],
    [ROLE_SLUGS.MEMBER, ROLE_SLUGS.ADMIN],
    [ROLE_SLUGS.MEMBER, ROLE_SLUGS.MEMBER],
    [ROLE_SLUGS.VIEWER, ROLE_SLUGS.OWNER],
    [ROLE_SLUGS.VIEWER, ROLE_SLUGS.ADMIN],
    [ROLE_SLUGS.VIEWER, ROLE_SLUGS.MEMBER],
    [ROLE_SLUGS.VIEWER, ROLE_SLUGS.VIEWER],
  ];

  it.each(ALLOWED)('%s may invite %s', (inviter, invited) => {
    expect(ROLE_WEIGHT[invited]).toBeLessThan(ROLE_WEIGHT[inviter]);
  });

  it.each(FORBIDDEN)('%s must NOT be able to invite %s', (inviter, invited) => {
    expect(ROLE_WEIGHT[invited]).toBeGreaterThanOrEqual(ROLE_WEIGHT[inviter]);
  });
});
