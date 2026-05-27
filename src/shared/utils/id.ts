import { randomUUID } from 'node:crypto';

/**
 * Generates a UUID v4. Used as default primary key generator for application code
 * (DB columns also default via `gen_random_uuid()`).
 */
export function newId(): string {
  return randomUUID();
}

/**
 * Slug-safe lowercase id with prefix, e.g. "wks_a1b2c3..." for human-readable
 * resource references that aren't primary keys.
 */
export function newPrefixedId(prefix: string, byteLength = 12): string {
  const bytes = new Uint8Array(byteLength);
  // Fall back to Math.random only if crypto is unavailable; in Node it always is.
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < byteLength; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}
