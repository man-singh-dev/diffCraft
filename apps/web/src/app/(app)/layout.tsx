import { Nav } from '@/components/nav';

// Each page still checks the session itself: a layout isn't re-rendered on client navigation.
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <Nav />
      {children}
    </>
  );
}
