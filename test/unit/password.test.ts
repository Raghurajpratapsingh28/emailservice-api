import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, verifyPassword } from '@shared/utils/password.js';

describe('shared/utils/password', () => {
  it('hashes and verifies correctly', async () => {
    const hash = await hashPassword('Sup3rSecret!Pass');
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(await verifyPassword('Sup3rSecret!Pass', hash)).toBe(true);
  });

  it('returns false on wrong password', async () => {
    const hash = await hashPassword('Sup3rSecret!Pass');
    expect(await verifyPassword('Sup3rSecret!Wrong', hash)).toBe(false);
  });

  it('returns false for empty inputs', async () => {
    expect(await verifyPassword('', '')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('', 'x')).toBe(false);
  });

  it('returns false on malformed hash without throwing', async () => {
    expect(await verifyPassword('whatever', 'not-a-bcrypt-hash')).toBe(false);
  });

  it('detects rehash necessity for low-cost hashes', () => {
    // $2b$04 is below the test default of 4 — equal, not less, so should be false
    const lowCost = '$2b$04$' + 'a'.repeat(53);
    expect(needsRehash(lowCost)).toBe(false);
    const veryLow = '$2b$03$' + 'a'.repeat(53);
    expect(needsRehash(veryLow)).toBe(true);
    expect(needsRehash('not-a-hash')).toBe(true);
  });
});
