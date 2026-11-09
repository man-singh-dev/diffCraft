import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const verifyEmail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ verifyEmail, resendVerification: vi.fn() }));

const { VerifyEmailForm, VerifyEmailView, INVALID_LINK_MESSAGE } =
  await import('./verify-email-form.js');

const TOKEN = 'a'.repeat(43);
const noop = () => {};

describe('VerifyEmailForm', () => {
  it('shows the invalid state with no Confirm button when there is no valid token', () => {
    const html = renderToStaticMarkup(<VerifyEmailForm token={null} loggedIn={false} />);
    expect(html).toContain(INVALID_LINK_MESSAGE);
    expect(html).not.toContain('Confirm</button>');
    expect(html).toContain('Log in to get a new link');
  });

  it('waits for a click instead of verifying on load', () => {
    const html = renderToStaticMarkup(<VerifyEmailForm token={TOKEN} loggedIn={false} />);
    expect(html).toContain('Confirm your email address');
    expect(html).toMatch(/<button[^>]*>Confirm<\/button>/);
    expect(verifyEmail).not.toHaveBeenCalled();
  });
});

describe('VerifyEmailView', () => {
  it('disables the button while confirming', () => {
    const html = renderToStaticMarkup(
      <VerifyEmailView phase={{ kind: 'confirming' }} loggedIn={false} onConfirm={noop} />,
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Confirming…<\/button>/);
  });

  it('shows the generic API message on error, with a way to get a new link', () => {
    const message = 'This verification link is invalid or has expired.';
    const phase = { kind: 'error', message } as const;

    const loggedOut = renderToStaticMarkup(
      <VerifyEmailView phase={phase} loggedIn={false} onConfirm={noop} />,
    );
    expect(loggedOut).toContain(message);
    expect(loggedOut).toContain('href="/login"');
    expect(loggedOut).not.toContain('Resend email');

    const loggedIn = renderToStaticMarkup(
      <VerifyEmailView phase={phase} loggedIn onConfirm={noop} />,
    );
    expect(loggedIn).toContain('Resend email');
    expect(loggedIn).not.toContain('Log in to get a new link');
  });

  it.each([
    [true, '/workspaces', 'Continue'],
    [false, '/login', 'Log in'],
  ])('on success (logged in: %s) links to %s', (loggedIn, href, label) => {
    const html = renderToStaticMarkup(
      <VerifyEmailView phase={{ kind: 'success' }} loggedIn={loggedIn} onConfirm={noop} />,
    );
    expect(html).toContain('Your email is verified');
    expect(html).toMatch(new RegExp(`<a[^>]*href="${href}"[^>]*>${label}</a>`));
  });
});
