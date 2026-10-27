import { RegisterRequestSchema } from '@diffcraft/shared';
import { describe, expect, it } from 'vitest';
import { toFieldErrors, validateForm } from './form-errors.js';

describe('validateForm', () => {
  it('returns the parsed data for valid input', () => {
    const result = validateForm(RegisterRequestSchema, {
      email: '  Ada@Example.com ',
      displayName: 'Ada',
      password: 'correct horse battery',
    });
    expect(result).toEqual({
      success: true,
      data: { email: 'ada@example.com', displayName: 'Ada', password: 'correct horse battery' },
    });
  });

  it('returns friendly per-field messages', () => {
    const result = validateForm(RegisterRequestSchema, {
      email: 'not-an-email',
      displayName: '   ',
      password: 'short',
    });
    expect(result).toEqual({
      success: false,
      fieldErrors: {
        email: 'Enter a valid email address.',
        displayName: 'This field is required.',
        password: 'Must be at least 10 characters.',
      },
    });
  });
});

describe('toFieldErrors', () => {
  it('keeps the first message per field', () => {
    expect(
      toFieldErrors([
        { field: 'a', message: 'first' },
        { field: 'a', message: 'second' },
        { field: 'b', message: 'only' },
      ]),
    ).toEqual({ a: 'first', b: 'only' });
  });
});
