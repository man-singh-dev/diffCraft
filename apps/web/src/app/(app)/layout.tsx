import { Nav } from '@/components/nav';
import { VerifyEmailBanner } from '@/components/verify-email-banner';
import { getCurrentUser } from '@/lib/auth.server';

// Each page still checks the session itself: a layout isn't re-rendered on client navigation.
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();

  return (
    <>
      <Nav />
      <VerifyEmailBanner user={user} />
      {children}
    </>
  );
}
