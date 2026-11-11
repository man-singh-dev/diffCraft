import { RealtimeTicketResponseSchema } from '@diffcraft/shared';

export type TicketResult = { ok: true; ticket: string } | { ok: false; unauthorized: boolean };

export async function fetchRealtimeTicket(fetchImpl: typeof fetch = fetch): Promise<TicketResult> {
  try {
    const res = await fetchImpl('/api/v1/realtime/ticket', { method: 'POST', cache: 'no-store' });
    if (res.status === 401) return { ok: false, unauthorized: true };
    if (!res.ok) return { ok: false, unauthorized: false };
    const parsed = RealtimeTicketResponseSchema.safeParse(await res.json());
    return parsed.success
      ? { ok: true, ticket: parsed.data.ticket }
      : { ok: false, unauthorized: false };
  } catch {
    return { ok: false, unauthorized: false };
  }
}
