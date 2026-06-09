import { describe, expect, it, vi } from 'vitest';
import { ConflictError, NotFoundError } from '@shared/errors/app-errors.js';
import { ContactService } from '@modules/contacts/services/contact.service.js';

// ─── Minimal mocks ────────────────────────────────────────────────────────────

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    insert: vi.fn(),
    insertBulk: vi.fn(),
    findById: vi.fn(),
    findByEmail: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
    countByWorkspace: vi.fn().mockResolvedValue(0),
    getTagsForContact: vi.fn().mockResolvedValue([]),
    getTagsForContacts: vi.fn().mockResolvedValue(new Map()),
    replaceTags: vi.fn(),
    addTags: vi.fn(),
    removeTags: vi.fn(),
    ...overrides,
  };
}

function makeDb(repo: ReturnType<typeof makeRepo>) {
  return {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        insert: repo.insert,
        delete: vi.fn(),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([{ c: 0 }]),
          }),
        }),
      });
    }),
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeLog() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
}

function makeBilling() {
  return {
    getSubscription: vi.fn().mockResolvedValue({ plan: 'pro' }),
    recordUsage: vi.fn().mockResolvedValue(undefined),
    hasQuotaRemaining: vi.fn().mockResolvedValue(true),
  };
}

const actor = { user: { id: 'user-1' }, ipAddress: '127.0.0.1' };
const workspaceId = 'ws-1';

describe('ContactService', () => {
  describe('createContact', () => {
    it('creates a contact and returns it with tags', async () => {
      const contact = { id: 'c-1', workspaceId, email: 'alice@example.com' };
      const repo = makeRepo({
        findByEmail: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue(contact),
      });
      const db = makeDb(repo);
      const svc = new ContactService(db as never, repo as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      const result = await svc.createContact(workspaceId, { email: 'Alice@Example.com' }, actor);
      expect(result.id).toBe('c-1');
      expect(result.tags).toEqual([]);
    });

    it('throws CONTACT_ALREADY_EXISTS when email is taken', async () => {
      const repo = makeRepo({
        findByEmail: vi.fn().mockResolvedValue({ id: 'existing' }),
      });
      const db = makeDb(repo);
      const svc = new ContactService(db as never, repo as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      await expect(
        svc.createContact(workspaceId, { email: 'alice@example.com' }, actor),
      ).rejects.toThrow(ConflictError);
    });

    it('normalizes email to lowercase', async () => {
      const repo = makeRepo({
        findByEmail: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockImplementation(async (_tx, values) => ({ ...values, id: 'c-1' })),
      });
      const db = makeDb(repo);
      const svc = new ContactService(db as never, repo as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      await svc.createContact(workspaceId, { email: 'ALICE@EXAMPLE.COM' }, actor);
      const insertCall = repo.insert.mock.calls[0]![1] as { email: string };
      expect(insertCall.email).toBe('alice@example.com');
    });
  });

  describe('getContact', () => {
    it('throws CONTACT_NOT_FOUND when contact does not exist', async () => {
      const repo = makeRepo({ findById: vi.fn().mockResolvedValue(null) });
      const db = makeDb(repo);
      const svc = new ContactService(db as never, repo as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      await expect(svc.getContact(workspaceId, 'missing-id')).rejects.toThrow(NotFoundError);
    });

    it('returns contact with tags', async () => {
      const contact = { id: 'c-1', workspaceId };
      const repo = makeRepo({
        findById: vi.fn().mockResolvedValue(contact),
        getTagsForContact: vi.fn().mockResolvedValue(['trial', 'saas']),
      });
      const db = makeDb(repo);
      const svc = new ContactService(db as never, repo as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      const result = await svc.getContact(workspaceId, 'c-1');
      expect(result.tags).toEqual(['trial', 'saas']);
    });
  });

  describe('deleteContact', () => {
    it('throws CONTACT_NOT_FOUND when contact does not exist', async () => {
      const repo = makeRepo({ softDelete: vi.fn().mockResolvedValue(null) });
      const db = makeDb(repo);
      const svc = new ContactService(db as never, repo as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      await expect(svc.deleteContact(workspaceId, 'missing', actor)).rejects.toThrow(NotFoundError);
    });

    it('soft-deletes successfully', async () => {
      const repo = makeRepo({ softDelete: vi.fn().mockResolvedValue({ id: 'c-1' }) });
      const db = makeDb(repo);
      const svc = new ContactService(db as never, repo as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      await expect(svc.deleteContact(workspaceId, 'c-1', actor)).resolves.toBeUndefined();
    });
  });

  describe('bulkImport', () => {
    it('returns imported and skipped counts', async () => {
      const inserted = [{ id: 'c-1', email: 'a@b.com' }];
      const repo = makeRepo({
        countByWorkspace: vi.fn().mockResolvedValue(0),
        insertBulk: vi.fn().mockResolvedValue(inserted),
      });
      const db = makeDb(repo);
      // Override transaction to run the callback with a tx that delegates insertBulk
      db.transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn({ insertBulk: repo.insertBulk, select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ c: 0 }]) }) }) });
      });
      const svc = new ContactService(db as never, repo as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      const result = await svc.bulkImport(
        workspaceId,
        [{ email: 'a@b.com' }, { email: 'b@b.com' }],
        actor,
      );
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(1);
    });
  });

  describe('suppressContact', () => {
    it('sets emailSuppressed to true', async () => {
      const updated = { id: 'c-1', emailSuppressed: true };
      const repo = makeRepo({ update: vi.fn().mockResolvedValue(updated) });
      const db = makeDb(repo);
      const svc = new ContactService(db as never, repo as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      const result = await svc.suppressContact(workspaceId, 'c-1', actor);
      expect(result.emailSuppressed).toBe(true);
      expect(repo.update).toHaveBeenCalledWith(workspaceId, 'c-1', { emailSuppressed: true });
    });

    it('throws CONTACT_NOT_FOUND when contact missing', async () => {
      const repo = makeRepo({ update: vi.fn().mockResolvedValue(null) });
      const db = makeDb(repo);
      const svc = new ContactService(db as never, repo as never, makeAudit() as never, makeLog() as never, makeBilling() as never);

      await expect(svc.suppressContact(workspaceId, 'missing', actor)).rejects.toThrow(NotFoundError);
    });
  });
});
