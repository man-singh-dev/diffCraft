import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from './health.js';

const valid = {
  status: 'ok',
  uptimeSeconds: 12.5,
  timestamp: '2026-10-23T10:00:00.000Z',
};

describe('HealthResponseSchema', () => {
  it('parses a valid health response', () => {
    expect(HealthResponseSchema.parse(valid)).toEqual(valid);
  });

  it('rejects a status other than "ok"', () => {
    expect(HealthResponseSchema.safeParse({ ...valid, status: 'error' }).success).toBe(false);
  });

  it('rejects a negative uptime', () => {
    expect(HealthResponseSchema.safeParse({ ...valid, uptimeSeconds: -1 }).success).toBe(false);
  });

  it('rejects a non-ISO timestamp', () => {
    expect(
      HealthResponseSchema.safeParse({ ...valid, timestamp: 'Oct 23 2026 10:00' }).success,
    ).toBe(false);
  });
});
