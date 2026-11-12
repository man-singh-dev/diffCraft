import type { Metadata } from 'next';
import { connection } from 'next/server';
import './globals.css';

export const metadata: Metadata = {
  title: 'DiffCraft',
  description: 'Collaborative Code Review and AI-Assisted Debugging Platform',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // A page rendered at build time has no request, so no CSP nonce on its scripts, and the CSP would block them.
  await connection();
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col bg-slate-950 text-slate-50 antialiased">
        {children}
      </body>
    </html>
  );
}
