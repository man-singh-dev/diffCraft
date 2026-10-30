import { Nav } from '@/components/nav';

// Shared by the logged-in pages. Each page still checks the session itself: a layout isn't
// re-rendered on client navigation, so it can't be the auth check.
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Nav />
      {children}
    </>
  );
}
