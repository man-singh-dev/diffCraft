import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';
import { CART_PATCH, expectLive, filesPath, REVIEW_TITLE, reviewPath } from '../support/scenario';

const patch = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}.patch`, import.meta.url), 'utf8');
const imagePath = (name: string) =>
  fileURLToPath(new URL(`../../docs/images/${name}.png`, import.meta.url));

async function save(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: imagePath(name), animations: 'disabled', caret: 'hide' });
}

test('README screenshots', async ({ newUser, apiAs, openAs }) => {
  const [maya, diego, priya] = await Promise.all([
    newUser('Maya Chen'),
    newUser('Diego Alvarez'),
    newUser('Priya Natarajan'),
  ]);
  const [mayaApi, diegoApi, priyaApi] = await Promise.all([
    apiAs(maya),
    apiAs(diego),
    apiAs(priya),
  ]);

  const workspace = await mayaApi.createWorkspace('Storefront');
  await mayaApi.addMember(workspace.id, diego.email, 'member');
  await mayaApi.addMember(workspace.id, priya.email, 'admin');

  const merged = await diegoApi.createReview(
    workspace.id,
    'Fix rounding of tax totals',
    patch('tax'),
    'Totals were off by a cent for some baskets: round tax per line in cents.',
  );
  await diegoApi.assignReviewers(merged, [maya.id]);
  await mayaApi.decide(merged, 'approve', 'Matches what the payment provider charges.');
  await diegoApi.merge(merged);

  const closed = await priyaApi.createReview(
    workspace.id,
    'Try a client-side image cache',
    patch('images'),
  );
  await priyaApi.close(closed);

  await priyaApi.createReview(
    workspace.id,
    'Cache product images at the edge',
    patch('images'),
    'Serves product images from the CDN with a 30-day immutable cache.',
  );

  const review = await mayaApi.createReview(
    workspace.id,
    REVIEW_TITLE,
    CART_PATCH,
    'Lets customers enter a discount code at checkout and counts item quantities in the total.',
  );
  const files = await mayaApi.files(review);
  const fileId = (path: string) => files.find((f) => f.newPath === path)!.id;

  await mayaApi.assignReviewers(review, [diego.id, priya.id]);
  const quantity = await diegoApi.createThread(
    review,
    'Should a missing quantity count as one item? Older carts in localStorage may not have it.',
    { fileId: fileId('src/cart/total.ts'), side: 'new', line: 7 },
  );
  await mayaApi.reply(
    review,
    quantity.id,
    'Good catch. The cart API always sends it, but restored carts might not. I will default it to 1.',
  );
  await priyaApi.createThread(
    review,
    'Codes pasted from emails often have trailing spaces:\n\n```suggestion\n  const rate = CODES[code.trim().toUpperCase()];\n```',
    { fileId: fileId('src/cart/discount.ts'), side: 'new', line: 8 },
  );
  await priyaApi.createThread(review, 'Can we ship this behind the checkout.discounts flag?');
  await diegoApi.decide(review, 'request_changes', 'Please handle a missing quantity first.');
  await priyaApi.decide(review, 'approve', 'Looks good once the quantity fix is in.');

  await mayaApi.runAnalysis(review);
  await expect
    .poll(async () => (await mayaApi.latestAnalysis(review)).job?.status, { timeout: 30_000 })
    .toBe('succeeded');

  const page = await openAs(maya);

  await page.goto(`/workspaces/${workspace.id}/reviews`);
  await expect(page.getByRole('link', { name: new RegExp(REVIEW_TITLE) })).toBeVisible();
  await save(page, 'review-list');

  await page.goto(`${filesPath(review)}?view=split#f-${fileId('src/cart/total.ts')}-R7`);
  await expectLive(page);
  await expect(page.getByText(/Should a missing quantity count as one item/)).toBeVisible();
  await page.getByText(/Should a missing quantity count as one item/).scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -260);
  await save(page, 'diff-viewer');

  await page.goto(reviewPath(review));
  await expectLive(page);
  const ai = page.getByRole('region', { name: 'AI review' });
  await expect(ai.getByRole('status')).toHaveText(/AI review finished with 3 findings\./);
  await ai.getByRole('heading', { name: 'AI review' }).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -16));
  await save(page, 'ai-review');

  const mergeBox = page.getByRole('region', { name: "Can't merge yet" });
  await expect(mergeBox.getByText('Diego Alvarez requested changes')).toBeVisible();
  await mergeBox.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -16));
  await save(page, 'approvals');

  await page.evaluate(() => window.scrollTo(0, 0));
  const bell = page.getByRole('button', { name: /^Notifications, \d+ unread$/ });
  await expect(bell).toBeVisible();
  await bell.click();
  await expect(
    page.getByRole('region', { name: 'Notifications' }).getByRole('link').first(),
  ).toBeVisible();
  await save(page, 'notifications');
});
