import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageCard } from '@/components/page-card';
import { getCurrentUser } from '@/lib/auth.server';
import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'Sign up · DiffCraft' };

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect('/workspaces');

  return (
    <PageCard title="Create your account" description="Join DiffCraft to start reviewing code.">
      <RegisterForm />
    </PageCard>
  );
}
