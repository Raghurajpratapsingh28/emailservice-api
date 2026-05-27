import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_SLUGS } from '@constants/rbac.js';

describe('campaigns RBAC matrix', () => {
  it('owner + admin have read/write/send', () => {
    for (const role of [ROLE_SLUGS.OWNER, ROLE_SLUGS.ADMIN]) {
      const p = new Set(ROLE_PERMISSIONS[role]);
      expect(p.has(PERMISSIONS.CAMPAIGNS_READ)).toBe(true);
      expect(p.has(PERMISSIONS.CAMPAIGNS_WRITE)).toBe(true);
      expect(p.has(PERMISSIONS.CAMPAIGNS_SEND)).toBe(true);
    }
  });

  it('member has read + write but NOT send', () => {
    const p = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.MEMBER]);
    expect(p.has(PERMISSIONS.CAMPAIGNS_READ)).toBe(true);
    expect(p.has(PERMISSIONS.CAMPAIGNS_WRITE)).toBe(true);
    expect(p.has(PERMISSIONS.CAMPAIGNS_SEND)).toBe(false);
  });

  it('viewer has read only', () => {
    const p = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.VIEWER]);
    expect(p.has(PERMISSIONS.CAMPAIGNS_READ)).toBe(true);
    expect(p.has(PERMISSIONS.CAMPAIGNS_WRITE)).toBe(false);
    expect(p.has(PERMISSIONS.CAMPAIGNS_SEND)).toBe(false);
  });
});
