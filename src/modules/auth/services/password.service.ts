import { hashPassword, needsRehash, verifyPassword } from '@shared/utils/password.js';

/**
 * Thin service wrapper around password utilities. Centralized so policy tweaks
 * (e.g. cost factor changes) are made in one place and the call sites are stable.
 */
export class PasswordService {
  public hash(plaintext: string): Promise<string> {
    return hashPassword(plaintext);
  }

  public verify(plaintext: string, hash: string): Promise<boolean> {
    return verifyPassword(plaintext, hash);
  }

  public needsRehash(hash: string): boolean {
    return needsRehash(hash);
  }
}

export const passwordService = new PasswordService();
