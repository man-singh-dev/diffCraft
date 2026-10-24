import { type Algorithm, hash, type Options, verify } from '@node-rs/argon2';

// OWASP Password Storage Cheat Sheet, first Argon2id option: m=19 MiB, t=2, p=1.
// `Algorithm` is an ambient const enum (unusable with isolatedModules); 2 is Argon2id.
const ARGON2ID_OPTIONS: Options = {
  algorithm: 2 as Algorithm,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
};

/** Hashes a password with Argon2id and a random salt. Returns a PHC string ("$argon2id$..."). */
export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID_OPTIONS);
}

/** Checks a password against a stored hash. The parameters are read from the hash itself. */
export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}
