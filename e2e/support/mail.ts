import { expect, type APIRequestContext } from '@playwright/test';
import { MAILPIT_URL } from '../env';

interface MailpitSearch {
  messages: { ID: string; Subject: string }[];
}

/** The verification link from the newest email sent to this address (Mailpit catches every email). */
export async function verificationLinkFor(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(`${MAILPIT_URL}/api/v1/search`, {
          params: { query: `to:"${email}" subject:"Verify your DiffCraft email address"` },
        });
        const found = ((await res.json()) as MailpitSearch).messages;
        id = found[0]?.ID;
        return id;
      },
      { message: `a verification email for ${email}`, timeout: 15_000 },
    )
    .toBeTruthy();

  const res = await request.get(`${MAILPIT_URL}/api/v1/message/${id}`);
  const { Text } = (await res.json()) as { Text: string };
  const link = /https?:\/\/\S+\/verify-email\?token=[A-Za-z0-9_-]+/.exec(Text)?.[0];
  if (!link) throw new Error(`no verification link in the email to ${email}`);
  return link;
}
