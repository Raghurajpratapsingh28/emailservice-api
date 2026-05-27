import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Generates a cryptographically secure random token, URL-safe (base64url).
 * @param byteLength - bytes of entropy (default 32 = 256 bits)
 */
export function generateRandomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString('base64url');
}

/**
 * Generates a hex-encoded random string.
 */
export function generateRandomHex(byteLength = 16): string {
  return randomBytes(byteLength).toString('hex');
}

/**
 * SHA-256 hash, hex encoded. Used for one-way hashing of opaque tokens
 * (refresh tokens, password reset tokens, invite tokens) before storing in DB.
 *
 * NOTE: do NOT use this for passwords — use bcrypt instead.
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * HMAC-SHA-256, hex encoded.
 */
export function hmacSha256(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input, 'utf8').digest('hex');
}

/**
 * Constant-time string comparison. Returns false for unequal-length inputs
 * without leaking that fact via timing.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  // Pad the shorter to the longer to keep compare time constant on length mismatch
  const len = Math.max(aBuf.length, bBuf.length);
  const aPad = Buffer.alloc(len);
  const bPad = Buffer.alloc(len);
  aBuf.copy(aPad);
  bBuf.copy(bPad);
  const equal = timingSafeEqual(aPad, bPad);
  return equal && aBuf.length === bBuf.length;
}

export { randomUUID };
