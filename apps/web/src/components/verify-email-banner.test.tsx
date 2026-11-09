import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/api-client', () => ({ resendVerification: vi.fn() }));

const { VerifyEmailBanner } = await import('./verify-email-banner.js');

describe('VerifyEmailBanner', () => {
  it('renders nothing when logged out or verified', () => {
    expect(renderToStaticMarkup(<VerifyEmailBanner user={null} />)).toBe('');
    expect(
      renderToStaticMarkup(
        <VerifyEmailBanner user={{ email: 'ada@example.com', emailVerified: true }} />,
      ),
    ).toBe('');
  });

  it('asks an unverified user to verify, with a resend button', () => {
    const html = renderToStaticMarkup(
      <VerifyEmailBanner user={{ email: 'ada@example.com', emailVerified: false }} />,
    );
    expect(html).toContain('Verify your email. We sent a link to');
    expect(html).toContain('ada@example.com');
    expect(html).toMatch(/<button[^>]*>Resend email<\/button>/);
  });

  it('escapes the email', () => {
    const html = renderToStaticMarkup(
      <VerifyEmailBanner user={{ email: '<img src=x>@example.com', emailVerified: false }} />,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x&gt;@example.com');
  });
});
