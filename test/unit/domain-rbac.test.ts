import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_SLUGS } from '@constants/rbac.js';

describe('domain RBAC matrix', () => {
  it('owner has read + write', () => {
    const perms = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.OWNER]);
    expect(perms.has(PERMISSIONS.DOMAINS_READ)).toBe(true);
    expect(perms.has(PERMISSIONS.DOMAINS_WRITE)).toBe(true);
  });

  it('admin has read + write', () => {
    const perms = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.ADMIN]);
    expect(perms.has(PERMISSIONS.DOMAINS_READ)).toBe(true);
    expect(perms.has(PERMISSIONS.DOMAINS_WRITE)).toBe(true);
  });

  it('member has read only', () => {
    const perms = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.MEMBER]);
    expect(perms.has(PERMISSIONS.DOMAINS_READ)).toBe(true);
    expect(perms.has(PERMISSIONS.DOMAINS_WRITE)).toBe(false);
  });

  it('viewer has read only', () => {
    const perms = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.VIEWER]);
    expect(perms.has(PERMISSIONS.DOMAINS_READ)).toBe(true);
    expect(perms.has(PERMISSIONS.DOMAINS_WRITE)).toBe(false);
  });
});
