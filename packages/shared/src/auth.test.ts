import { describe, expect, it } from 'vitest';
import {
  ErrorResponseSchema,
  LoginRequestSchema,
  PublicUserSchema,
  RegisterRequestSchema,
} from './auth.js';

const validRegister = {
  email: 'user@example.com',
  password: 'correct horse battery',
  displayName: 'Ada',
};

describe('RegisterRequestSchema', () => {
  it('parses a valid request', () => {
    expect(RegisterRequestSchema.parse(validRegister)).toEqual(validRegister);
  });

  it('trims and lowercases the email', () => {
    const parsed = RegisterRequestSchema.parse({ ...validRegister, email: '  Ada@Example.COM ' });
    expect(parsed.email).toBe('ada@example.com');
  });

  it('trims the display name but not the password', () => {
    const parsed = RegisterRequestSchema.parse({
      ...validRegister,
      displayName: '  Ada  ',
      password: '  spaces kept  ',
    });
    expect(parsed.displayName).toBe('Ada');
    expect(parsed.password).toBe('  spaces kept  ');
  });

  it('rejects an invalid email', () => {
    expect(RegisterRequestSchema.safeParse({ ...validRegister, email: 'nope' }).success).toBe(
      false,
    );
  });

  it('rejects an email longer than 254 characters', () => {
    const email = `${'a'.repeat(64)}@${'b'.repeat(186)}.com`; // 255 chars
    expect(RegisterRequestSchema.safeParse({ ...validRegister, email }).success).toBe(false);
  });

  it('enforces password length 10–128', () => {
    const withPassword = (password: string) =>
      RegisterRequestSchema.safeParse({ ...validRegister, password }).success;
    expect(withPassword('a'.repeat(9))).toBe(false);
    expect(withPassword('a'.repeat(10))).toBe(true);
    expect(withPassword('a'.repeat(128))).toBe(true);
    expect(withPassword('a'.repeat(129))).toBe(false);
  });

  it('enforces display name length 1–80 after trimming', () => {
    const withName = (displayName: string) =>
      RegisterRequestSchema.safeParse({ ...validRegister, displayName }).success;
    expect(withName('   ')).toBe(false);
    expect(withName('a'.repeat(80))).toBe(true);
    expect(withName('a'.repeat(81))).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(RegisterRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('LoginRequestSchema', () => {
  it('trims and lowercases the email', () => {
    const parsed = LoginRequestSchema.parse({ email: '  Ada@Example.COM ', password: 'x' });
    expect(parsed.email).toBe('ada@example.com');
  });

  it('does not apply the sign-up password rules', () => {
    expect(LoginRequestSchema.safeParse({ email: 'a@x.com', password: 'short' }).success).toBe(
      true,
    );
  });

  it('enforces password length 1–128', () => {
    const withPassword = (password: string) =>
      LoginRequestSchema.safeParse({ email: 'a@x.com', password }).success;
    expect(withPassword('')).toBe(false);
    expect(withPassword('a'.repeat(128))).toBe(true);
    expect(withPassword('a'.repeat(129))).toBe(false);
  });

  it('rejects missing fields and an empty email', () => {
    expect(LoginRequestSchema.safeParse({}).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ email: '   ', password: 'x' }).success).toBe(false);
  });
});

describe('PublicUserSchema', () => {
  const validUser = {
    id: '0199f3a4-5b6c-7d8e-9f01-23456789abcd',
    email: 'user@example.com',
    displayName: 'Ada',
    createdAt: '2026-10-24T10:00:00.000Z',
  };

  it('parses a valid public user', () => {
    expect(PublicUserSchema.parse(validUser)).toEqual(validUser);
  });

  it('strips a password hash if one is passed in', () => {
    const parsed = PublicUserSchema.parse({ ...validUser, passwordHash: '$argon2id$...' });
    expect(parsed).not.toHaveProperty('passwordHash');
  });

  it('rejects a non-ISO createdAt', () => {
    expect(PublicUserSchema.safeParse({ ...validUser, createdAt: 'yesterday' }).success).toBe(
      false,
    );
  });
});

describe('ErrorResponseSchema', () => {
  it('parses an error with and without details', () => {
    const error = { code: 'email_taken', message: 'Email already registered.' };
    expect(ErrorResponseSchema.parse({ error })).toEqual({ error });
    expect(ErrorResponseSchema.parse({ error: { ...error, details: [{ a: 1 }] } })).toEqual({
      error: { ...error, details: [{ a: 1 }] },
    });
  });

  it('rejects a body without code or message', () => {
    expect(ErrorResponseSchema.safeParse({ error: { message: 'x' } }).success).toBe(false);
    expect(ErrorResponseSchema.safeParse({ error: { code: 'x' } }).success).toBe(false);
  });
});
