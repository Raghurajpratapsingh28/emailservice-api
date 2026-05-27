import { generateRandomToken, sha256 } from './crypto.js';

/**
 * Opaque token utilities for password reset, email verification, refresh, and invites.
 *
 * Pattern:
 *   - Issue: generate a high-entropy random token, return plaintext to user.
 *   - Persist: store SHA-256 hash + expiry. Never store plaintext.
 *   - Verify: hash the candidate and compare in constant time at the DB query level
 *     (we look up by hash directly, which is itself constant-time vs a single row).
 */

export interface IssuedToken {
  /** The plaintext token to return to the user (e.g. via email link). */
  plaintext: string;
  /** SHA-256 hex hash to persist. */
  hash: string;
}

export function issueOpaqueToken(byteLength = 32): IssuedToken {
  const plaintext = generateRandomToken(byteLength);
  return { plaintext, hash: sha256(plaintext) };
}

export function hashOpaqueToken(plaintext: string): string {
  return sha256(plaintext);
}
