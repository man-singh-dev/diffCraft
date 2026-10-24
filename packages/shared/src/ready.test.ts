import { describe, expect, it } from 'vitest';
import { ReadyResponseSchema } from './ready.js';

describe('ReadyResponseSchema', () => {
  it('parses "ready" and "not_ready"', () => {
    expect(ReadyResponseSchema.parse({ status: 'ready' })).toEqual({ status: 'ready' });
    expect(ReadyResponseSchema.parse({ status: 'not_ready' })).toEqual({ status: 'not_ready' });
  });

  it('rejects any other status', () => {
    expect(ReadyResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
  });
});
