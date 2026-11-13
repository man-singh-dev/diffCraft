import { expect, test } from '../support/fixtures';
import { reviewPath, reviewWithMember } from '../support/scenario';

const TITLE = 'Example finding from the fake AI provider';
const FINDING = `AI finding: ${TITLE}`;

test('AI review with the fake provider: run, findings, feedback, dismiss, start a thread', async ({
  newUser,
  apiAs,
  openAs,
}) => {
  const { owner, review } = await reviewWithMember({ newUser, apiAs });
  const page = await openAs(owner);
  await page.goto(reviewPath(review));

  const card = page.getByRole('region', { name: 'AI review' });
  await expect(card.getByRole('status')).toHaveText('No AI review yet.');
  await card.getByRole('button', { name: 'Run AI review' }).click();
  await expect(card.getByRole('status')).toHaveText('AI review finished with 3 findings.');
  await expect(card.getByText('Fake analysis of 3 file(s).')).toBeVisible();

  const findings = card.getByRole('article', { name: FINDING });
  await expect(findings).toHaveCount(3);

  const first = findings.first();
  await first.getByRole('button', { name: 'Helpful (0)', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Helpful (1)', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await first.getByRole('button', { name: `Dismiss finding: ${TITLE}` }).click();
  await expect(findings).toHaveCount(2);

  await findings.first().getByRole('button', { name: 'Start thread' }).click();
  await expect(findings).toHaveCount(1);
  await expect(card.getByRole('status')).toHaveText('AI review finished with 1 finding.');

  // A finding becomes a line thread: listed on the review page, shown under its line on the files page.
  await expect(page.getByText('1 open thread on the code')).toBeVisible();
  await page
    .getByRole('region', { name: /^Files/ })
    .getByRole('link', { name: /^src\/cart\/[a-z]+\.ts:\d+$/ })
    .click();
  await expect(page).toHaveURL(/\/files#f-/);
  const comment = page.getByRole('listitem').filter({ hasText: /The fake provider marks/ });
  await expect(comment).toHaveCount(1);
  await expect(comment).toContainText(TITLE);
});
