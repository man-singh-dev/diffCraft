import { expect, test } from '../support/fixtures';
import { filesPath, reviewWithMember } from '../support/scenario';

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

test('files tab: unified and split views, highlighting, word-level changes', async ({
  newUser,
  apiAs,
  openAs,
}) => {
  const { owner, review } = await reviewWithMember({ newUser, apiAs });
  const page = await openAs(owner);
  await page.goto(filesPath(review));

  const views = page.getByRole('navigation', { name: 'Diff view' });
  await expect(views.getByRole('link', { name: 'Unified' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('table', { name: 'Unified diff' })).toHaveCount(3);

  await views.getByRole('link', { name: 'Split' }).click();
  await expect(views.getByRole('link', { name: 'Split' })).toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/view=split/);
  await expect(page.getByRole('table', { name: 'Side-by-side diff' })).toHaveCount(3);

  await views.getByRole('link', { name: 'Unified' }).click();
  await expect(page.getByRole('table', { name: 'Unified diff' })).toHaveCount(3);

  const total = page.getByRole('region', { name: 'src/cart/total.ts' });
  // Highlighted on the server: tokens arrive as spans with their own colors.
  const keyword = total.getByText('export', { exact: true }).first();
  await expect(keyword).toHaveAttribute('style', /color:/);

  const changedRow = total.getByRole('row').filter({ hasText: 'item.quantity' });
  await expect(changedRow.getByText('added line:')).toBeAttached();
  await expect(changedRow.getByText(/quantity/)).not.toHaveCSS('background-color', TRANSPARENT);
  await expect(changedRow.getByText(/total/)).toHaveCSS('background-color', TRANSPARENT);
});

test('a deep link to a line scrolls to it and highlights it', async ({
  newUser,
  apiAs,
  openAs,
}) => {
  const { owner, ownerApi, review } = await reviewWithMember({ newUser, apiAs });
  const files = await ownerApi.files(review);
  const total = files.find((file) => file.newPath === 'src/cart/total.ts')!;
  const page = await openAs(owner);
  await page.setViewportSize({ width: 1280, height: 420 });

  await page.goto(`${filesPath(review)}#f-${total.id}-R7`);

  const region = page.getByRole('region', { name: 'src/cart/total.ts' });
  const target = region.getByRole('row').filter({ hasText: 'item.quantity' });
  const other = region
    .getByRole('row')
    .filter({ hasText: "import { applyDiscount } from './discount';" });
  await expect(target).toBeInViewport();
  await expect(target.getByRole('cell').last()).not.toHaveCSS('background-color', TRANSPARENT);
  await expect(other.getByRole('cell').last()).toHaveCSS('background-color', TRANSPARENT);
});
