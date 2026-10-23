import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'DiffCraft',
  description: 'Collaborative Code Review and AI-Assisted Debugging Platform',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 text-slate-50 antialiased">{children}</body>
    </html>
  );
}
