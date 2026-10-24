import { describe, expect, it, vi } from 'vitest';
import { getApiHealth } from './api-health.js';

const VALID_BODY = {
  status: 'ok',
  uptimeSeconds: 42,
  timestamp: '2026-10-23T10:00:00.000Z',
};

const TEST_URL = 'http://test.invalid';

function makeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

describe('getApiHealth', () => {
  it('returns ok:true with valid data for a good response', async () => {
    const result = await getApiHealth(TEST_URL, makeFetch(200, VALID_BODY));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe('ok');
      expect(result.data.uptimeSeconds).toBe(42);
    }
  });

  it('returns ok:false when the response body has an invalid shape', async () => {
    const result = await getApiHealth(TEST_URL, makeFetch(200, { wrong: 'shape' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/invalid/i);
  });

  it('returns ok:false for a non-200 status', async () => {
    const result = await getApiHealth(TEST_URL, makeFetch(503, {}));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('503');
  });

  it('returns ok:false for a network error', async () => {
    const errorFetch = vi.fn().mockRejectedValue(new Error('Network failure'));
    const result = await getApiHealth(TEST_URL, errorFetch as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('Network failure');
  });
});
