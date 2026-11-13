import { readFile } from 'node:fs/promises';
import { expect, test } from '../support/fixtures';
import { expectLive, filesPath, reviewWithMember } from '../support/scenario';

test('comment on a line, reply and resolve, seen live by the other user', async ({
  newUser,
  apiAs,
  openAs,
}) => {
  const { owner, member, review } = await reviewWithMember({ newUser, apiAs });
  const [ada, ben] = await Promise.all([openAs(owner), openAs(member)]);
  await Promise.all([ada.goto(filesPath(review)), ben.goto(filesPath(review))]);
  await Promise.all([expectLive(ada), expectLive(ben)]);

  const adaFile = ada.getByRole('region', { name: 'src/cart/total.ts' });
  const benFile = ben.getByRole('region', { name: 'src/cart/total.ts' });
  const comment = 'Should a missing quantity count as one item?';
  const reply = 'Quantity is always set by the cart API, so no.';

  await adaFile.getByRole('button', { name: 'Add a comment on line 7' }).click();
  await adaFile.getByLabel('Comment on line 7', { exact: true }).fill(comment);
  await adaFile.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(adaFile.getByText(comment)).toBeVisible();
  await expect(benFile.getByText(comment)).toBeVisible();

  await benFile.getByRole('button', { name: 'Reply', exact: true }).click();
  await benFile.getByLabel('Reply', { exact: true }).fill(reply);
  await benFile.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(benFile.getByText(reply)).toBeVisible();
  await expect(adaFile.getByText(reply)).toBeVisible();

  await adaFile.getByRole('button', { name: 'Resolve' }).click();
  await expect(adaFile.getByText('Resolved thread · 2 comments')).toBeVisible();
  await expect(benFile.getByText('Resolved thread · 2 comments')).toBeVisible();
});

test('a suggestion block can be downloaded as a patch', async ({ newUser, apiAs, openAs }) => {
  const { owner, review } = await reviewWithMember({ newUser, apiAs });
  const page = await openAs(owner);
  await page.goto(filesPath(review));
  const file = page.getByRole('region', { name: 'src/cart/total.ts' });

  await file.getByRole('button', { name: 'Add a comment on line 7' }).click();
  await file.getByRole('button', { name: 'Suggest change' }).click();
  const box = file.getByLabel('Comment on line 7', { exact: true });
  await expect(box).toHaveValue(/```suggestion\n {4}total \+= item\.price \* item\.quantity;\n```/);
  const suggested = (await box.inputValue()).replace(
    'item.price * item.quantity',
    'item.price * (item.quantity ?? 1)',
  );
  await box.fill(`Guard against a missing quantity:\n\n${suggested}`);
  await file.getByRole('button', { name: 'Comment', exact: true }).click();

  await expect(file.getByText('Suggested change')).toBeVisible();
  const download = page.waitForEvent('download');
  await file.getByRole('link', { name: 'Download patch' }).click();
  const patch = await readFile(await (await download).path(), 'utf8');

  expect((await download).suggestedFilename()).toMatch(/\.patch$/);
  expect(patch).toContain('--- a/src/cart/total.ts');
  expect(patch).toContain('+++ b/src/cart/total.ts');
  expect(patch).toContain('-    total += item.price * item.quantity;');
  expect(patch).toContain('+    total += item.price * (item.quantity ?? 1);');
});
