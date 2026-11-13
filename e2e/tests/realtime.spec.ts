import { expect, test } from '../support/fixtures';
import { expectLive, REVIEW_TITLE, reviewPath, reviewWithMember } from '../support/scenario';

test('two people on the same review see each other', async ({ newUser, apiAs, openAs }) => {
  const { owner, member, review } = await reviewWithMember({ newUser, apiAs });
  const [ada, ben] = await Promise.all([openAs(owner), openAs(member)]);
  await Promise.all([ada.goto(reviewPath(review)), ben.goto(reviewPath(review))]);
  await Promise.all([expectLive(ada), expectLive(ben)]);

  await expect(ada.getByText('Viewing this review: you and Ben.')).toBeAttached();
  await expect(ben.getByText('Viewing this review: you and Ada.')).toBeAttached();
  await expect(ada.getByText('You, Ben viewing')).toBeVisible();

  await ben.close();
  await expect(ada.getByText('Only you viewing')).toBeVisible();
});

test("a reply shows up in the author's notification bell and leads to the thread", async ({
  newUser,
  apiAs,
  openAs,
}) => {
  const { owner, member, ownerApi, review } = await reviewWithMember({ newUser, apiAs });
  const question = 'Do we need a feature flag for discount codes?';
  const answer = 'Yes, behind checkout.discounts until marketing is ready.';
  const thread = await ownerApi.createThread(review, question);

  const ada = await openAs(owner);
  await ada.goto('/workspaces');
  await expect(ada.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();

  const ben = await openAs(member);
  await ben.goto(reviewPath(review));
  const conversation = ben.getByRole('region', { name: 'Conversation' });
  await conversation.getByRole('button', { name: 'Reply', exact: true }).click();
  await conversation.getByLabel('Reply', { exact: true }).fill(answer);
  await conversation.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(conversation.getByText(answer)).toBeVisible();

  const bell = ada.getByRole('button', { name: 'Notifications, 1 unread' });
  await expect(bell).toBeVisible();
  await bell.click();
  await ada
    .getByRole('region', { name: 'Notifications' })
    .getByRole('link', { name: `Ben replied on #${review.number} ${REVIEW_TITLE}` })
    .click();

  await expect(ada).toHaveURL(new RegExp(`${reviewPath(review)}#thread-${thread.id}$`));
  await expect(ada.getByText(question)).toBeVisible();
  await expect(ada.getByText(answer)).toBeVisible();
  await expect(ada.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
});

test('a member removed while their tab is open loses access at once', async ({
  newUser,
  apiAs,
  openAs,
}) => {
  const { owner, member, workspaceId, review } = await reviewWithMember({ newUser, apiAs });
  const ben = await openAs(member);
  await ben.goto(reviewPath(review));
  await expectLive(ben);

  const ada = await openAs(owner);
  await ada.goto(`/workspaces/${workspaceId}`);
  const row = ada.getByRole('listitem').filter({ hasText: member.email });
  await row.getByRole('button', { name: 'Remove', exact: true }).click();
  await row.getByRole('button', { name: 'Remove Ben' }).click();
  await expect(ada.getByRole('heading', { name: 'Members (1)' })).toBeVisible();

  await expect(
    ben.getByRole('alert').filter({ hasText: 'You no longer have access to this review.' }),
  ).toBeVisible();
  await expect(ben.getByRole('link', { name: 'Go to your workspaces' })).toBeVisible();
  await expect(ben.getByRole('status').filter({ hasText: 'Live updates' })).toHaveText(
    /^Live updates:\s*No access$/,
  );
});
