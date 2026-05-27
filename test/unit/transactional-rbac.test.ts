import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_SLUGS } from '@constants/rbac.js';

describe('transactional RBAC matrix', () => {
  it('owner + admin have all four permissions', () => {
    for (const role of [ROLE_SLUGS.OWNER, ROLE_SLUGS.ADMIN]) {
      const perms = new Set(ROLE_PERMISSIONS[role]);
      expect(perms.has(PERMISSIONS.EMAILS_SEND)).toBe(true);
      expect(perms.has(PERMISSIONS.EMAILS_READ)).toBe(true);
      expect(perms.has(PERMISSIONS.TEMPLATES_READ)).toBe(true);
      expect(perms.has(PERMISSIONS.TEMPLATES_WRITE)).toBe(true);
    }
  });

  it('member can send + manage templates', () => {
    const perms = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.MEMBER]);
    expect(perms.has(PERMISSIONS.EMAILS_SEND)).toBe(true);
    expect(perms.has(PERMISSIONS.EMAILS_READ)).toBe(true);
    expect(perms.has(PERMISSIONS.TEMPLATES_READ)).toBe(true);
    expect(perms.has(PERMISSIONS.TEMPLATES_WRITE)).toBe(true);
  });

  it('viewer is read-only', () => {
    const perms = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.VIEWER]);
    expect(perms.has(PERMISSIONS.EMAILS_READ)).toBe(true);
    expect(perms.has(PERMISSIONS.TEMPLATES_READ)).toBe(true);
    expect(perms.has(PERMISSIONS.EMAILS_SEND)).toBe(false);
    expect(perms.has(PERMISSIONS.TEMPLATES_WRITE)).toBe(false);
  });
});
