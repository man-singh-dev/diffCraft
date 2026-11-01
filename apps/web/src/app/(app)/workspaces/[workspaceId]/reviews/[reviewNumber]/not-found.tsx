import Link from 'next/link';
import { PageCard } from '@/components/page-card';
import { primaryButton } from '@/components/styles';

// Also shown for a workspace you aren't in: the API doesn't tell the two apart.
export default function ReviewNotFound() {
  return (
    <PageCard
      title="Review not found"
      description="It doesn't exist, was deleted, or is in a workspace you aren't a member of."
    >
      <Link href="/workspaces" className={primaryButton}>
        Back to your workspaces
      </Link>
    </PageCard>
  );
}
