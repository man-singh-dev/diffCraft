import 'server-only';

import { headers } from 'next/headers';
import { clientIpFrom, forwardingHeaders } from './client-ip';
import { env } from './env.server';

export async function forwardedClientHeaders(): Promise<Record<string, string>> {
  if (!env.WEB_PROXY_SECRET) return {};
  return forwardingHeaders(clientIpFrom(await headers()), env.WEB_PROXY_SECRET);
}
