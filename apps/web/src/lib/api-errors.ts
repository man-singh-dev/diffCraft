import type { ApiFailure } from './api-client';

const MESSAGES: Partial<Record<string, string>> = {
  last_owner: 'A workspace needs at least one owner. Make someone else an owner first.',
  already_member: 'That person is already a member of this workspace.',
  user_not_found: 'No DiffCraft account uses that email. Ask them to sign up first.',
  member_not_found: 'That person is no longer a member. Refresh the page to see the latest list.',
  workspace_not_found: "This workspace doesn't exist any more, or you are no longer a member.",
  cannot_remove_self: 'To remove yourself, use "Leave workspace".',
  unauthenticated: 'Your session has ended. Log in again.',
};

export function describeApiError(failure: ApiFailure): string {
  const known = MESSAGES[failure.code];
  if (known) return known;
  if (failure.status === 403) {
    return "You don't have permission to do that. Your role may have changed; refresh the page.";
  }
  if (failure.status === 422) return 'Check the highlighted fields.';
  return failure.message;
}
