import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_SLUGS } from '@constants/rbac.js';

describe('billing RBAC matrix', () => {
  it('owner has read + write', () => {
    const p = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.OWNER]);
    expect(p.has(PERMISSIONS.BILLING_READ)).toBe(true);
    expect(p.has(PERMISSIONS.BILLING_WRITE)).toBe(true);
  });

  it('admin has read but NOT write', () => {
    const p = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.ADMIN]);
    expect(p.has(PERMISSIONS.BILLING_READ)).toBe(true);
    expect(p.has(PERMISSIONS.BILLING_WRITE)).toBe(false);
  });

  it('member has neither', () => {
    const p = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.MEMBER]);
    expect(p.has(PERMISSIONS.BILLING_READ)).toBe(false);
    expect(p.has(PERMISSIONS.BILLING_WRITE)).toBe(false);
  });

  it('viewer has read only', () => {
    const p = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.VIEWER]);
    expect(p.has(PERMISSIONS.BILLING_READ)).toBe(true);
    expect(p.has(PERMISSIONS.BILLING_WRITE)).toBe(false);
  });
});
