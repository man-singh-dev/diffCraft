import type { PublicUser } from '@diffcraft/shared';
import { ResendVerification } from './resend-verification';
import { smallSecondaryButton } from './styles';

export function VerifyEmailBanner({
  user,
}: {
  user: Pick<PublicUser, 'email' | 'emailVerified'> | null;
}) {
  if (!user || user.emailVerified) return null;

  return (
    <div className="border-b border-amber-800/50 bg-amber-950/40">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 text-sm text-amber-200">
        <p>
          Verify your email. We sent a link to <span className="font-medium">{user.email}</span>.
        </p>
        <ResendVerification buttonClassName={smallSecondaryButton} />
      </div>
    </div>
  );
}
