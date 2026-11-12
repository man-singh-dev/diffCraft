import { isIP } from 'node:net';

// Must match apps/api/src/plugins/client-ip.ts.
export const CLIENT_IP_HEADER = 'x-diffcraft-client-ip';
export const PROXY_SECRET_HEADER = 'x-diffcraft-proxy-secret';

// Vercel overwrites X-Forwarded-For with the address that connected to it, so its first entry is the client.
export function clientIpFrom(headers: Headers): string | null {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return first && isIP(first) !== 0 ? first : null;
}

export function proxySecretFrom(value: string | undefined): string | undefined {
  return value && value.length >= 32 ? value : undefined;
}

export function forwardingHeaders(
  clientIp: string | null,
  secret: string | undefined,
): Record<string, string> {
  return clientIp && secret ? { [CLIENT_IP_HEADER]: clientIp, [PROXY_SECRET_HEADER]: secret } : {};
}
