import Link from 'next/link';
import { PageCard } from '@/components/page-card';
import { primaryButton } from '@/components/styles';

// Same message for a missing workspace and one you aren't in: the API doesn't tell them apart.
export default function WorkspaceNotFound() {
  return (
    <PageCard
      title="Workspace not found"
      description="It doesn't exist, or you aren't a member of it."
    >
      <Link href="/workspaces" className={primaryButton}>
        Back to your workspaces
      </Link>
    </PageCard>
  );
}
