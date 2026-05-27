import { describe, expect, it } from 'vitest';
import { hashOpaqueToken, issueOpaqueToken } from '@shared/utils/tokens.js';
import {
  generateRandomToken,
  sha256,
  timingSafeEqualString,
} from '@shared/utils/crypto.js';

describe('shared/utils/tokens', () => {
  it('issued tokens have plaintext + matching hash', () => {
    const issued = issueOpaqueToken();
    expect(issued.plaintext.length).toBeGreaterThanOrEqual(40);
    expect(issued.hash).toBe(sha256(issued.plaintext));
    expect(issued.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('hashOpaqueToken is deterministic', () => {
    expect(hashOpaqueToken('foo')).toBe(hashOpaqueToken('foo'));
    expect(hashOpaqueToken('foo')).not.toBe(hashOpaqueToken('bar'));
  });

  it('generates URL-safe random tokens', () => {
    const t = generateRandomToken(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('shared/utils/crypto', () => {
  it('timingSafeEqualString is true for equal strings', () => {
    expect(timingSafeEqualString('abcdef', 'abcdef')).toBe(true);
  });

  it('timingSafeEqualString is false for unequal strings', () => {
    expect(timingSafeEqualString('abcdef', 'abcdeg')).toBe(false);
  });

  it('timingSafeEqualString is false for different lengths', () => {
    expect(timingSafeEqualString('abc', 'abcdef')).toBe(false);
  });
});
