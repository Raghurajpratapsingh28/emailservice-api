import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  createSegmentBodySchema,
  listSegmentsQuerySchema,
  previewSegmentQuerySchema,
  updateSegmentBodySchema,
} from '@modules/segments/schemas/segment.schema.js';

describe('segment Zod schemas', () => {
  describe('createSegmentBodySchema', () => {
    it('accepts static segment without filterTree', () => {
      const out = createSegmentBodySchema.parse({ name: 'All Users', type: 'static' });
      expect(out.name).toBe('All Users');
      expect(out.type).toBe('static');
    });

    it('accepts dynamic segment with valid filterTree', () => {
      const out = createSegmentBodySchema.parse({
        name: 'Trial Users',
        type: 'dynamic',
        filterTree: {
          operator: 'AND',
          rules: [{ field: 'properties.plan', operator: 'equals', value: 'free' }],
        },
      });
      expect(out.filterTree?.operator).toBe('AND');
    });

    it('accepts nested filter tree', () => {
      const out = createSegmentBodySchema.parse({
        name: 'Complex',
        type: 'dynamic',
        filterTree: {
          operator: 'AND',
          rules: [
            { field: 'email', operator: 'exists' },
            {
              operator: 'OR',
              rules: [
                { field: 'properties.plan', operator: 'equals', value: 'pro' },
                { field: 'properties.plan', operator: 'equals', value: 'enterprise' },
              ],
            },
          ],
        },
      });
      expect(out.filterTree?.rules).toHaveLength(2);
    });

    it('rejects invalid operator in rule', () => {
      expect(() =>
        createSegmentBodySchema.parse({
          name: 'Bad',
          type: 'dynamic',
          filterTree: {
            operator: 'AND',
            rules: [{ field: 'email', operator: 'invalid_op' }],
          },
        }),
      ).toThrow(ZodError);
    });

    it('rejects empty name', () => {
      expect(() => createSegmentBodySchema.parse({ name: '' })).toThrow(ZodError);
    });

    it('rejects invalid segment type', () => {
      expect(() => createSegmentBodySchema.parse({ name: 'X', type: 'realtime' })).toThrow(ZodError);
    });

    it('rejects filterTree with empty rules', () => {
      expect(() =>
        createSegmentBodySchema.parse({
          name: 'X',
          filterTree: { operator: 'AND', rules: [] },
        }),
      ).toThrow(ZodError);
    });
  });

  describe('updateSegmentBodySchema', () => {
    it('accepts partial update', () => {
      const out = updateSegmentBodySchema.parse({ name: 'New Name' });
      expect(out.name).toBe('New Name');
    });

    it('accepts empty object', () => {
      expect(() => updateSegmentBodySchema.parse({})).not.toThrow();
    });
  });

  describe('listSegmentsQuerySchema', () => {
    it('applies defaults', () => {
      const out = listSegmentsQuerySchema.parse({});
      expect(out.page).toBe(1);
      expect(out.pageSize).toBe(20);
    });
  });

  describe('previewSegmentQuerySchema', () => {
    it('applies default limit', () => {
      const out = previewSegmentQuerySchema.parse({});
      expect(out.limit).toBe(20);
    });

    it('rejects limit > 100', () => {
      expect(() => previewSegmentQuerySchema.parse({ limit: '200' })).toThrow(ZodError);
    });
  });
});
