import { NextResponse, type NextRequest } from 'next/server';
import {
  CLIENT_IP_HEADER,
  clientIpFrom,
  forwardingHeaders,
  PROXY_SECRET_HEADER,
  proxySecretFrom,
} from './lib/client-ip';
import { contentSecurityPolicy, createNonce } from './lib/csp';
import { parseRealtimeUrl } from './lib/realtime/config';

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  // A client could send these itself; only this proxy may set them.
  headers.delete(CLIENT_IP_HEADER);
  headers.delete(PROXY_SECRET_HEADER);

  if (request.nextUrl.pathname.startsWith('/api/')) {
    const secret = proxySecretFrom(process.env.WEB_PROXY_SECRET);
    for (const [name, value] of Object.entries(
      forwardingHeaders(clientIpFrom(request.headers), secret),
    )) {
      headers.set(name, value);
    }
    return NextResponse.next({ request: { headers } });
  }

  const nonce = createNonce();
  const realtime = parseRealtimeUrl(process.env.NEXT_PUBLIC_REALTIME_URL);
  const csp = contentSecurityPolicy({
    nonce,
    dev: process.env.NODE_ENV === 'development',
    https: request.nextUrl.protocol === 'https:',
    realtimeOrigin: realtime.ok ? realtime.url : null,
  });
  // Next.js reads the nonce from the request's CSP header and puts it on its own scripts.
  headers.set('content-security-policy', csp);
  headers.set('x-nonce', nonce);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
