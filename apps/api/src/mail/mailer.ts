import type { FastifyBaseLogger } from 'fastify';
import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  close?(): void;
}

export function createSmtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async send({ to, subject, text }) {
      await transport.sendMail({ from, to, subject, text });
    },
    close() {
      transport.close();
    },
  };
}

// For environments without an email provider: the message, link included, goes to the log.
export function createLogMailer(log: FastifyBaseLogger): Mailer {
  return {
    send({ to, subject, text }) {
      log.info({ to, subject, text }, 'email not sent (MAIL_TRANSPORT=log)');
      return Promise.resolve();
    },
  };
}

export function createMailer(
  config: Pick<Config, 'MAIL_TRANSPORT' | 'MAIL_SMTP_URL' | 'MAIL_FROM'>,
  log: FastifyBaseLogger,
): Mailer {
  return config.MAIL_TRANSPORT === 'log'
    ? createLogMailer(log)
    : createSmtpMailer(config.MAIL_SMTP_URL, config.MAIL_FROM);
}
