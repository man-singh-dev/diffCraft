import { describe, expect, it } from 'vitest';
import { verifyPassword } from './password.js';
import { DUMMY_PASSWORD_HASH } from './service.js';

describe('DUMMY_PASSWORD_HASH', () => {
  // verifyCredentials swallows verify errors, so a broken dummy hash would silently turn the
  // unknown-email path back into a fast one. Check it is a real hash with the live parameters.
  it('is a valid Argon2id hash with the same parameters as hashPassword', async () => {
    expect(DUMMY_PASSWORD_HASH).toContain('$argon2id$v=19$m=19456,t=2,p=1$');
    await expect(verifyPassword(DUMMY_PASSWORD_HASH, 'any password')).resolves.toBe(false);
  });
});
