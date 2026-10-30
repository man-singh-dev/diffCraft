'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogoutButton } from './logout-button';

const LINKS = [
  { href: '/workspaces', label: 'Workspaces' },
  { href: '/profile', label: 'Profile' },
] as const;

const linkClass =
  'rounded-md px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 aria-[current=page]:bg-slate-800 aria-[current=page]:text-white disabled:opacity-60';

/** Top bar for logged-in pages. */
export function Nav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-slate-800 bg-slate-900/60">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3"
      >
        <div className="flex items-center gap-1">
          <Link href="/" className="mr-3 text-sm font-bold text-violet-300">
            DiffCraft
          </Link>
          {LINKS.map(({ href, label }) => {
            const current = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                aria-current={current ? 'page' : undefined}
                className={linkClass}
              >
                {label}
              </Link>
            );
          })}
        </div>
        <LogoutButton className={linkClass} />
      </nav>
    </header>
  );
}
