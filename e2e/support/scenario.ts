import { readFileSync } from 'node:fs';
import { expect, type Page } from '@playwright/test';
import type { Review, TestUser, UserApi } from './api';

export const CART_PATCH = readFileSync(new URL('../fixtures/cart.patch', import.meta.url), 'utf8');
export const REVIEW_TITLE = 'Apply discount codes at checkout';

export const reviewPath = (review: Review) =>
  `/workspaces/${review.workspaceId}/reviews/${review.number}`;
export const filesPath = (review: Review) => `${reviewPath(review)}/files`;

interface ScenarioFixtures {
  newUser: (displayName: string) => Promise<TestUser>;
  apiAs: (user: TestUser) => Promise<UserApi>;
}

/** An owner who authored a review of the cart patch, and a second member of the workspace. */
export async function reviewWithMember(
  { newUser, apiAs }: ScenarioFixtures,
  { owner: ownerName = 'Ada', member: memberName = 'Ben', role = 'member' } = {},
) {
  const [owner, member] = await Promise.all([newUser(ownerName), newUser(memberName)]);
  const ownerApi = await apiAs(owner);
  const workspace = await ownerApi.createWorkspace('Checkout team');
  await ownerApi.addMember(workspace.id, member.email, role);
  const review = await ownerApi.createReview(
    workspace.id,
    REVIEW_TITLE,
    CART_PATCH,
    'Lets customers enter a discount code at checkout and counts item quantities in the total.',
  );
  return { owner, member, ownerApi, workspaceId: workspace.id, review };
}

/** Waits until the page has joined the review's live room, so events sent from now on reach it. */
export async function expectLive(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: 'Live updates' })).toHaveText(
    /^Live updates:\s*Live$/,
  );
}
