import type { Metadata } from 'next';
import { getCurrentUser } from '@/lib/auth.server';
import { isVerificationToken } from '@/lib/email-verification';
import { VerifyEmailForm } from './verify-email-form';

// The URL holds a single-use token: never send it on to another site.
export const metadata: Metadata = { title: 'Verify email · DiffCraft', referrer: 'no-referrer' };

export default async function VerifyEmailPage(props: PageProps<'/verify-email'>) {
  const [{ token }, user] = await Promise.all([props.searchParams, getCurrentUser()]);

  return (
    <VerifyEmailForm token={isVerificationToken(token) ? token : null} loggedIn={user !== null} />
  );
}
