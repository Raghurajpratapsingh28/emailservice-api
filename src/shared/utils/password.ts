import bcrypt from 'bcrypt';
import { config } from '@config/index.js';

/**
 * Hashes a plaintext password using bcrypt with the configured cost factor.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, config.BCRYPT_ROUNDS);
}

/**
 * Verifies a plaintext password against a bcrypt hash. Returns false on any failure
 * (invalid hash, mismatch). Bcrypt's `compare` is itself constant-time within a hash.
 */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  if (!plaintext || !hash) {
    return false;
  }
  try {
    return await bcrypt.compare(plaintext, hash);
  } catch {
    return false;
  }
}

/**
 * Returns true if the hash should be re-hashed because the cost factor changed.
 * Call this after a successful login to opportunistically upgrade old hashes.
 */
export function needsRehash(hash: string): boolean {
  // bcrypt hash format: $2[aby]$<rounds>$<22-char-salt><31-char-hash>
  const match = /^\$2[aby]\$(\d{2})\$/.exec(hash);
  if (!match) {
    return true;
  }
  const rounds = Number.parseInt(match[1]!, 10);
  return rounds < config.BCRYPT_ROUNDS;
}
