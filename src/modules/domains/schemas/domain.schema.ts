import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from '@shared/validators/common.js';
import { DOMAIN_STATUS } from '@shared/database/schema/domains.js';

/**
 * Domain validator.
 *
 * Rules:
 *   - 1–253 chars total
 *   - Lowercase ASCII letters, digits, hyphens, dots
 *   - At least one dot (multi-label)
 *   - Each label: 1–63 chars, no leading/trailing hyphen
 *   - TLD: only letters, ≥2 chars
 *   - Reject literals: `localhost`, `local`
 *   - Reject IPv4 / IPv6 addresses
 *   - Reject reserved/internal TLDs: `.local`, `.localdomain`, `.internal`,
 *     `.test`, `.example`, `.invalid`, `.localhost`
 */

const RESERVED_TLDS = new Set([
  'local',
  'localdomain',
  'internal',
  'test',
  'example',
  'invalid',
  'localhost',
]);

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /:[\da-f]{0,4}:|^::|::$/i;

function isValidDomainShape(input: string): { ok: true } | { ok: false; reason: string } {
  if (!input) {
    return { ok: false, reason: 'Domain is required' };
  }
  if (input.length < 4 || input.length > 253) {
    return { ok: false, reason: 'Domain length must be 4–253 characters' };
  }
  if (input === 'localhost' || input === 'local') {
    return { ok: false, reason: 'Reserved domain' };
  }
  if (IPV4_RE.test(input) || IPV6_RE.test(input)) {
    return { ok: false, reason: 'IP addresses are not allowed' };
  }
  if (!input.includes('.')) {
    return { ok: false, reason: 'Domain must contain at least one dot' };
  }

  const labels = input.split('.');
  for (const label of labels) {
    if (label.length < 1 || label.length > 63) {
      return { ok: false, reason: 'Each label must be 1–63 characters' };
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return { ok: false, reason: 'Labels cannot start or end with a hyphen' };
    }
    if (!/^[a-z0-9-]+$/.test(label)) {
      return { ok: false, reason: 'Labels may contain only a-z, 0-9, and hyphens' };
    }
  }

  const tld = labels[labels.length - 1]!.toLowerCase();
  if (!/^[a-z]{2,}$/.test(tld)) {
    return { ok: false, reason: 'TLD must be at least 2 letters and contain no digits' };
  }
  if (RESERVED_TLDS.has(tld)) {
    return { ok: false, reason: 'Reserved TLD' };
  }

  return { ok: true };
}

/**
 * Zod schema that normalises and validates a domain string.
 * Inputs are trimmed, lowercased, and stripped of a leading `www.` prefix.
 */
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((s) => s.replace(/^www\./, ''))
  .superRefine((value, ctx) => {
    const result = isValidDomainShape(value);
    if (!result.ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: result.reason,
      });
    }
  });

/** Exported for unit testing without going through Zod. */
export { isValidDomainShape };

// ─── Request shapes ────────────────────────────────────────────────────────

export const createDomainBodySchema = z.object({
  domain: domainSchema,
});
export type CreateDomainBody = z.infer<typeof createDomainBodySchema>;

export const domainIdParamSchema = z.object({
  id: uuidSchema,
});
export type DomainIdParams = z.infer<typeof domainIdParamSchema>;

export const listDomainsQuerySchema = paginationQuerySchema.extend({
  status: z.enum([...DOMAIN_STATUS] as [string, ...string[]]).optional(),
});
export type ListDomainsQuery = z.infer<typeof listDomainsQuerySchema>;
