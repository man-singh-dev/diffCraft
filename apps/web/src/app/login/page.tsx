import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageCard } from '@/components/page-card';
import { getCurrentUser } from '@/lib/auth.server';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Log in · DiffCraft' };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/workspaces');

  return (
    <PageCard title="Welcome back" description="Log in to your DiffCraft account.">
      <LoginForm />
    </PageCard>
  );
}
