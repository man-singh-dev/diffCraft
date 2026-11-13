import { LOGIN_ATTEMPTS_PER_EMAIL } from '../env';
import { PASSWORD, uniqueEmail } from '../support/api';
import { expect, test } from '../support/fixtures';
import { verificationLinkFor } from '../support/mail';

test('sign up, verify the email, log out, log in and log out again', async ({ page, request }) => {
  const email = uniqueEmail('signup');

  await page.goto('/register');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Display name').fill('Grace');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/workspaces$/);
  await expect(page.getByText(`Verify your email. We sent a link to ${email}.`)).toBeVisible();

  await page.goto(await verificationLinkFor(request, email));
  await expect(page.getByRole('heading', { name: 'Confirm your email address' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('heading', { name: 'Your email is verified' })).toBeVisible();
  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();
  await expect(page.getByText(/Verify your email/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/workspaces');
  await expect(page).toHaveURL(/\/login/);
});

test('too many wrong logins get a friendly 429 message', async ({ page }) => {
  const email = uniqueEmail('locked');
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('not the right password');
  const submit = page.getByRole('button', { name: 'Log in' });

  for (let attempt = 1; attempt <= LOGIN_ATTEMPTS_PER_EMAIL + 1; attempt++) {
    const response = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/login'));
    await submit.click();
    const status = (await response).status();
    if (attempt <= LOGIN_ATTEMPTS_PER_EMAIL) {
      expect(status).toBe(401);
      await expect(page.getByText('Invalid email or password.')).toBeVisible();
    } else {
      expect(status).toBe(429);
      await expect(
        page.getByText(/^Too many attempts\. Try again in \d+ (seconds|minutes?)\.$/),
      ).toBeVisible();
    }
  }
});
