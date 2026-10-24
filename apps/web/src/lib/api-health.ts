import { HealthResponseSchema, type HealthResponse } from '@diffcraft/shared';

type ApiHealthResult = { ok: true; data: HealthResponse } | { ok: false; reason: string };
export async function getApiHealth(
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiHealthResult> {
  try {
    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), 5_000);

    let res: Response;
    try {
      res = await fetchImpl(`${apiUrl}/health`, {
        signal: controller.signal,
        cache: 'no-store',
      });
    } finally {
      clearTimeout(timerId);
    }

    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status}` };
    }

    const body: unknown = await res.json();
    const parsed = HealthResponseSchema.safeParse(body);

    if (!parsed.success) {
      return { ok: false, reason: 'Invalid response shape from API' };
    }

    return { ok: true, data: parsed.data };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Unknown error' };
  }
}
