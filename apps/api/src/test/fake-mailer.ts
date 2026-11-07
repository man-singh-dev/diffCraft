import type { Mailer, MailMessage } from '../mail/mailer.js';

export class FakeMailer implements Mailer {
  readonly messages: MailMessage[] = [];
  failWith: Error | null = null;

  send(message: MailMessage): Promise<void> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.messages.push(message);
    return Promise.resolve();
  }

  linksTo(email: string): string[] {
    return this.messages
      .filter((m) => m.to === email)
      .flatMap((m) => m.text.match(/https?:\/\/\S+/g) ?? []);
  }
}
