import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, ROLE_SLUGS } from '@constants/rbac.js';

describe('contacts + segments RBAC matrix', () => {
  describe('contacts', () => {
    it('owner + admin + member have contacts.read and contacts.write', () => {
      for (const role of [ROLE_SLUGS.OWNER, ROLE_SLUGS.ADMIN, ROLE_SLUGS.MEMBER]) {
        const p = new Set(ROLE_PERMISSIONS[role]);
        expect(p.has(PERMISSIONS.CONTACTS_READ), `${role} should have contacts.read`).toBe(true);
        expect(p.has(PERMISSIONS.CONTACTS_WRITE), `${role} should have contacts.write`).toBe(true);
      }
    });

    it('viewer has contacts.read but NOT contacts.write', () => {
      const p = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.VIEWER]);
      expect(p.has(PERMISSIONS.CONTACTS_READ)).toBe(true);
      expect(p.has(PERMISSIONS.CONTACTS_WRITE)).toBe(false);
    });
  });

  describe('segments', () => {
    it('owner + admin + member have segments.read and segments.write', () => {
      for (const role of [ROLE_SLUGS.OWNER, ROLE_SLUGS.ADMIN, ROLE_SLUGS.MEMBER]) {
        const p = new Set(ROLE_PERMISSIONS[role]);
        expect(p.has(PERMISSIONS.SEGMENTS_READ), `${role} should have segments.read`).toBe(true);
        expect(p.has(PERMISSIONS.SEGMENTS_WRITE), `${role} should have segments.write`).toBe(true);
      }
    });

    it('viewer has segments.read but NOT segments.write', () => {
      const p = new Set(ROLE_PERMISSIONS[ROLE_SLUGS.VIEWER]);
      expect(p.has(PERMISSIONS.SEGMENTS_READ)).toBe(true);
      expect(p.has(PERMISSIONS.SEGMENTS_WRITE)).toBe(false);
    });
  });
});
