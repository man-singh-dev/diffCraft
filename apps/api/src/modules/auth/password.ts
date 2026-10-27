import { type Algorithm, hash, type Options, verify } from '@node-rs/argon2';
const ARGON2ID_OPTIONS: Options = {
  algorithm: 2 as Algorithm,
  memoryCost: 19_456, // KiB
  timeCost: 2,
  parallelism: 1,
};
export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2ID_OPTIONS);
}
export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}
