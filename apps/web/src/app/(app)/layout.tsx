import { Nav } from '@/components/nav';
import { VerifyEmailBanner } from '@/components/verify-email-banner';
import { getUnreadNotificationCount } from '@/lib/api.server';
import { getCurrentUser } from '@/lib/auth.server';

// Each page still checks the session itself: a layout isn't re-rendered on client navigation.
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await getCurrentUser();
  const unread = user ? await getUnreadNotificationCount() : null;

  return (
    <>
      <Nav unreadCount={unread === null ? null : unread.ok ? unread.data : 0} />
      <VerifyEmailBanner user={user} />
      {children}
    </>
  );
}
