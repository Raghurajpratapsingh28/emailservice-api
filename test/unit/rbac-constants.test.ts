import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_SLUGS,
  ROLE_WEIGHT,
} from '@constants/rbac.js';

describe('rbac constants', () => {
  it('every role-permission entry references a known permission', () => {
    const perms = new Set<string>(ALL_PERMISSIONS);
    for (const role of Object.values(ROLE_SLUGS)) {
      for (const p of ROLE_PERMISSIONS[role]) {
        expect(perms.has(p)).toBe(true);
      }
    }
  });

  it('owner has every permission member has', () => {
    const memberPerms = new Set<string>(ROLE_PERMISSIONS[ROLE_SLUGS.MEMBER]);
    const ownerPerms = new Set<string>(ROLE_PERMISSIONS[ROLE_SLUGS.OWNER]);
    for (const p of memberPerms) {
      expect(ownerPerms.has(p)).toBe(true);
    }
  });

  it('viewer is read-only', () => {
    const viewerPerms = ROLE_PERMISSIONS[ROLE_SLUGS.VIEWER];
    for (const p of viewerPerms) {
      expect(p.endsWith('.read')).toBe(true);
    }
  });

  it('admin cannot delete the workspace or write billing', () => {
    const adminPerms = new Set<string>(ROLE_PERMISSIONS[ROLE_SLUGS.ADMIN]);
    expect(adminPerms.has(PERMISSIONS.WORKSPACE_DELETE)).toBe(false);
    expect(adminPerms.has(PERMISSIONS.BILLING_WRITE)).toBe(false);
  });

  it('role weights are strictly ordered owner > admin > member > viewer', () => {
    expect(ROLE_WEIGHT[ROLE_SLUGS.OWNER]).toBeGreaterThan(ROLE_WEIGHT[ROLE_SLUGS.ADMIN]);
    expect(ROLE_WEIGHT[ROLE_SLUGS.ADMIN]).toBeGreaterThan(ROLE_WEIGHT[ROLE_SLUGS.MEMBER]);
    expect(ROLE_WEIGHT[ROLE_SLUGS.MEMBER]).toBeGreaterThan(ROLE_WEIGHT[ROLE_SLUGS.VIEWER]);
  });
});
