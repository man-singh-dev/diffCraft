import { expect, test } from '../support/fixtures';
import { expectLive, reviewPath, reviewWithMember } from '../support/scenario';

test('assign a reviewer; a change request blocks the merge, an approval allows it', async ({
  newUser,
  apiAs,
  openAs,
}) => {
  const { owner, member, review } = await reviewWithMember({ newUser, apiAs });
  const ada = await openAs(owner);
  await ada.goto(reviewPath(review));
  await expectLive(ada);

  const reviewers = ada.getByRole('region', { name: /^Reviewers/ });
  await reviewers.getByRole('button', { name: 'Add reviewers' }).click();
  await reviewers.getByRole('checkbox', { name: 'Ben' }).check();
  await reviewers.getByRole('button', { name: 'Add 1' }).click();
  await expect(reviewers.getByRole('heading', { name: 'Reviewers (1)' })).toBeVisible();
  await expect(reviewers.getByRole('listitem').filter({ hasText: 'Ben' })).toBeVisible();

  const ben = await openAs(member);
  await ben.goto(reviewPath(review));
  const yourReview = ben.getByRole('region', { name: 'Your review' });
  await yourReview.getByLabel('Comment (optional)').fill('Please handle a missing quantity first.');
  await yourReview.getByRole('button', { name: 'Request changes' }).click();

  const merge = ada.getByRole('region', { name: /merge/i });
  await expect(merge.getByRole('heading', { name: "Can't merge yet" })).toBeVisible();
  await expect(
    merge.getByRole('listitem').filter({ hasText: 'Ben requested changes' }),
  ).toBeVisible();
  await expect(merge.getByRole('button', { name: 'Merge' })).toBeDisabled();

  await yourReview.getByRole('button', { name: 'Approve' }).click();
  await expect(merge.getByRole('heading', { name: 'Ready to merge' })).toBeVisible();
  await merge.getByRole('button', { name: 'Merge' }).click();
  await merge.getByRole('button', { name: 'Confirm' }).click();

  await expect(ada.getByText('Merged', { exact: true }).first()).toBeVisible();
  await expect(merge).toHaveCount(0);
});
