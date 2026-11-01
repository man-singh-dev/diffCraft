import { hasAtLeastRole } from '@diffcraft/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { FormError } from '@/components/form-field';
import { PageCard } from '@/components/page-card';
import { secondaryButton } from '@/components/styles';
import { getWorkspace } from '@/lib/api.server';
import { NewReviewForm } from './new-review-form';

export const metadata: Metadata = { title: 'New review · DiffCraft' };

export default async function NewReviewPage(
  props: PageProps<'/workspaces/[workspaceId]/reviews/new'>,
) {
  const { workspaceId } = await props.params;
  const workspace = await getWorkspace(workspaceId);

  if (!workspace.ok && workspace.status === 401) redirect('/login');
  if (!workspace.ok && workspace.status === 404) notFound();
  if (!workspace.ok) {
    return (
      <PageCard title="New review" description="Something went wrong.">
        <FormError>Couldn&apos;t load this workspace. Please try again in a moment.</FormError>
      </PageCard>
    );
  }

  const reviewsHref = `/workspaces/${workspaceId}/reviews`;

  if (!hasAtLeastRole(workspace.data.role, 'member')) {
    return (
      <PageCard title="New review" description="You need member access to create reviews.">
        <p className="text-sm text-slate-400">
          You are a viewer in {workspace.data.name}. Ask an admin to make you a member.
        </p>
        <Link href={reviewsHref} className={secondaryButton}>
          Back to reviews
        </Link>
      </PageCard>
    );
  }

  return (
    <PageCard
      wide
      title="New review"
      description={`Paste a unified diff or choose a .patch file to review in ${workspace.data.name}.`}
    >
      <NewReviewForm workspaceId={workspaceId} cancelHref={reviewsHref} />
    </PageCard>
  );
}
