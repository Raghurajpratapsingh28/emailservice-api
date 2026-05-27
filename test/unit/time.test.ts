import { describe, expect, it } from 'vitest';
import { parseDurationToSeconds } from '@shared/utils/time.js';

describe('shared/utils/time', () => {
  it.each([
    ['15m', 900],
    ['1h', 3600],
    ['30d', 30 * 86400],
    ['1w', 7 * 86400],
    ['2000ms', 2],
    ['90', 90],
    [60, 60],
  ])('parses %s as %i seconds', (input, expected) => {
    expect(parseDurationToSeconds(input as never)).toBe(expected);
  });

  it('throws on invalid input', () => {
    expect(() => parseDurationToSeconds('-1m')).toThrow();
    expect(() => parseDurationToSeconds('15xyz')).toThrow();
    expect(() => parseDurationToSeconds(-5)).toThrow();
  });
});
