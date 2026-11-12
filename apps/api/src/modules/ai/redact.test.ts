import { describe, expect, it } from 'vitest';
import { REDACTED, redactLine, redactLines } from './redact.js';

// Built from parts so no complete secret-shaped string sits in source for secret scanners to flag.
const TOKENS: [string, string][] = [
  ['an AWS access key id', 'AKIA' + 'Z'.repeat(16)],
  ['a GitHub token', 'ghp' + '_' + 'a'.repeat(36)],
  [
    'a fine-grained GitHub token',
    'github' + '_pat_' + '11' + 'A'.repeat(20) + '_' + 'b'.repeat(20),
  ],
  ['a Slack token', 'xoxb' + '-' + '1'.repeat(10) + '-' + 'a'.repeat(12)],
  [
    'a Slack webhook',
    'https://hooks.slack' +
      '.com/services/' +
      ['T' + '0'.repeat(8), 'B' + '0'.repeat(8), 'X'.repeat(24)].join('/'),
  ],
  ['a Stripe live key', 'sk' + '_live_' + 'a'.repeat(24)],
  ['a Stripe test key', 'rk' + '_test_' + 'a'.repeat(24)],
  ['an OpenAI-style key', 'sk' + '-proj-' + 'a'.repeat(24)],
  ['an Anthropic-style key', 'sk' + '-ant-api03-' + 'a'.repeat(24)],
  ['a Groq key', 'gsk' + '_' + 'a'.repeat(30)],
  ['a Google API key', 'AIza' + 'Sy' + 'A'.repeat(33)],
];

describe('redactLine', () => {
  it.each(TOKENS)('masks %s', (_name, token) => {
    expect(redactLine(`use(${token});`)).toBe(`use(${REDACTED});`);
  });

  it('masks credentials in a URL', () => {
    const out = redactLine('postgres://admin:hunter2@db.internal/app');
    expect(out).toBe(`postgres://admin:${REDACTED}@db.internal/app`);
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
  const pem = (edge: 'BEGIN' | 'END', kind = '') => `-----${edge} ${kind}PRIVATE KEY-----`;

  it('masks every line of a private key block, and nothing after it', () => {
    const lines = [
      'const key = `',
      pem('BEGIN', 'RSA '),
      'MIIEowIBAAKCAQEAabcdef',
      'Zm9vYmFyYmF6',
      pem('END', 'RSA '),
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
        pem('BEGIN', 'OPENSSH '),
        'b3BlbnNzaC1rZXktdjEAAAAA',
        pem('END', 'OPENSSH '),
        'next',
      ]),
    ).toEqual([REDACTED, REDACTED, REDACTED, 'next']);
    expect(redactLines([`"${pem('BEGIN')}\\nMIIE\\n${pem('END')}"`, 'next'])).toEqual([
      REDACTED,
      'next',
    ]);
  });

  it('applies the per-line patterns to other lines', () => {
    expect(redactLines(['SECRET_KEY=abc', 'plain'])).toEqual(['SECRET_KEY=[REDACTED]', 'plain']);
  });
});
