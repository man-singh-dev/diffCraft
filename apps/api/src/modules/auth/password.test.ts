import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

const PASSWORD = 'correct horse battery staple';

describe('hashPassword / verifyPassword', () => {
  it('produces an Argon2id hash with the OWASP parameters', async () => {
    const passwordHash = await hashPassword(PASSWORD);
    expect(passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(passwordHash).toContain('m=19456,t=2,p=1');
  });

  it('gives different hashes for the same password (random salt)', async () => {
    const [a, b] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);
    expect(a).not.toBe(b);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const passwordHash = await hashPassword(PASSWORD);
    expect(await verifyPassword(passwordHash, PASSWORD)).toBe(true);
    expect(await verifyPassword(passwordHash, `${PASSWORD}!`)).toBe(false);
  });
});
