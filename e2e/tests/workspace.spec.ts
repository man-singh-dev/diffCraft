import { expect, test } from '../support/fixtures';
import { CART_PATCH, REVIEW_TITLE } from '../support/scenario';

test('create a workspace, add a member and create a review from a patch', async ({
  newUser,
  openAs,
}) => {
  const [owner, teammate] = await Promise.all([newUser('Ada'), newUser('Ben')]);
  const page = await openAs(owner);

  await page.goto('/workspaces');
  await page.getByLabel('Workspace name').fill('Checkout team');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Checkout team', level: 1 })).toBeVisible();

  await page.getByLabel('Email').fill(teammate.email);
  await page.getByRole('button', { name: 'Add member' }).click();
  await expect(page.getByText('Ben was added as Member.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Members (2)' })).toBeVisible();

  await page.getByRole('link', { name: 'Reviews' }).click();
  await page.getByRole('link', { name: 'New review' }).first().click();
  await page.getByLabel('Title').fill(REVIEW_TITLE);
  await page.getByLabel('Patch', { exact: true }).fill(CART_PATCH);
  await page.getByRole('button', { name: 'Create review' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toContainText(REVIEW_TITLE);
  const files = page.getByRole('region', { name: /^Files/ });
  for (const path of ['src/cart/discount.ts', 'src/cart/total.ts', 'src/cart/types.ts']) {
    await expect(files.getByRole('link', { name: path })).toBeVisible();
  }
});
