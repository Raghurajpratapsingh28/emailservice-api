import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_SLUGS } from '@constants/rbac.js';

describe('workflows RBAC matrix', () => {
  it('owner + admin have read/write/publish', () => {
    for (const role of [ROLE_SLUGS.OWNER, ROLE_SLUGS.ADMIN]) {
      const p = new Set(ROLE_PERMISSIONS[role]);
      expect(p.has(PERMISSIONS.WORKFLOWS_READ), `${role} should have workflows.read`).toBe(true);
      expect(p.has(PERMISSIONS.WORKFLOWS_WRITE), `${role} should have workflows.write`).toBe(true);
      expect(p.has(PERMISSIONS.WORKFLOWS_PUBLISH), `${role} should have workflows.publish`).toBe(true);
    }
  });

  it('member has read + write but NOT publish', () => {
    const p = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.MEMBER]);
    expect(p.has(PERMISSIONS.WORKFLOWS_READ)).toBe(true);
    expect(p.has(PERMISSIONS.WORKFLOWS_WRITE)).toBe(true);
    expect(p.has(PERMISSIONS.WORKFLOWS_PUBLISH)).toBe(false);
  });

  it('viewer has read only', () => {
    const p = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.VIEWER]);
    expect(p.has(PERMISSIONS.WORKFLOWS_READ)).toBe(true);
    expect(p.has(PERMISSIONS.WORKFLOWS_WRITE)).toBe(false);
    expect(p.has(PERMISSIONS.WORKFLOWS_PUBLISH)).toBe(false);
  });
});
