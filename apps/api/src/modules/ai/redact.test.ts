import { describe, expect, it } from 'vitest';
import { REDACTED, redactLine, redactLines } from './redact.js';

describe('redactLine', () => {
  it.each([
    ['an AWS access key id', 'const id = AKIAIOSFODNN7EXAMPLE;', 'AKIAIOSFODNN7EXAMPLE'],
    ['a GitHub token', 'auth: ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_abcdefghij'],
    ['a fine-grained GitHub token', 'github_pat_11ABCDEFG0123456789_abcdefghijk', 'github_pat_11'],
    ['a Slack token', 'slack(xoxb-1234567890-abcdefghijkl)', 'xoxb-1234567890'],
    ['a Slack webhook', 'post("https://hooks.slack.com/services/T000/B000/XXXXXXXX")', 'T000/B000'],
    ['a Stripe live key', 'stripe(sk_live_51Habcdefghijklmnop)', 'sk_live_51H'],
    ['a Stripe test key', 'stripe(rk_test_51Habcdefghijklmnop)', 'rk_test_51H'],
    ['an OpenAI-style key', 'new OpenAI(sk-proj-abcdefghijklmnopqrstuv)', 'sk-proj-abcdef'],
    ['an Anthropic-style key', 'client(sk-ant-api03-abcdefghijklmnopqrstuv)', 'sk-ant-api03'],
    ['a Groq key', 'groq(gsk_abcdefghijklmnopqrstuvwxyz)', 'gsk_abcdefghij'],
    ['a Google API key', 'key=AIzaSyA-abcdefghijklmnopqrstuvwxyz12345', 'AIzaSyA-abcdef'],
    ['credentials in a URL', 'postgres://admin:hunter2@db.internal/app', 'hunter2'],
  ])('masks %s', (_name, line, secret) => {
    const out = redactLine(line);
    expect(out).toContain(REDACTED);
    expect(out).not.toContain(secret);
  });

  it.each([
    ['API_KEY=abc123', 'API_KEY=[REDACTED]'],
    ['export DB_PASSWORD=p@ss word', 'export DB_PASSWORD=[REDACTED]'],
    ['  CLIENT_SECRET = xyz', '  CLIENT_SECRET = [REDACTED]'],
    ['AUTH_TOKEN="abc"', 'AUTH_TOKEN="[REDACTED]"'],
    ['const apiKey = "abc123";', 'const apiKey = "[REDACTED]";'],
    ["  password: 'hunter2',", "  password: '[REDACTED]',"],
    ['{"client_secret": "s3cr3t", "id": 1}', '{"client_secret": "[REDACTED]", "id": 1}'],
    ['token := `abc`', 'token := `[REDACTED]`'],
  ])('masks the value of %j', (line, expected) => {
    expect(redactLine(line)).toBe(expected);
  });

  it.each([
    'const total = items.reduce((a, b) => a + b, 0);',
    'if (user.isAdmin) return;',
    'const keyboard = new Keyboard();',
    'function getToken(request) {',
    'const x = sk;',
  ])('leaves ordinary code alone: %j', (line) => {
    expect(redactLine(line)).toBe(line);
  });
});

describe('redactLines', () => {
  it('masks every line of a private key block, and nothing after it', () => {
    const lines = [
      'const key = `',
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEAabcdef',
      'Zm9vYmFyYmF6',
      '-----END RSA PRIVATE KEY-----',
      '`;',
    ];
    expect(redactLines(lines)).toEqual([
      'const key = `',
      REDACTED,
      REDACTED,
      REDACTED,
      REDACTED,
      '`;',
    ]);
  });

  it('masks an OpenSSH key and a one-line key', () => {
    expect(
      redactLines([
        '-----BEGIN OPENSSH PRIVATE KEY-----',
        'b3BlbnNzaC1rZXktdjEAAAAA',
        '-----END OPENSSH PRIVATE KEY-----',
        'next',
      ]),
    ).toEqual([REDACTED, REDACTED, REDACTED, 'next']);
    expect(
      redactLines(['"-----BEGIN PRIVATE KEY-----\\nMIIE\\n-----END PRIVATE KEY-----"', 'next']),
    ).toEqual([REDACTED, 'next']);
  });

  it('applies the per-line patterns to other lines', () => {
    expect(redactLines(['SECRET_KEY=abc', 'plain'])).toEqual(['SECRET_KEY=[REDACTED]', 'plain']);
  });
});
