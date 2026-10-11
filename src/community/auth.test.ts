import { describe, expect, it } from 'vitest';
import {
  mapAuthError,
  normalizeUsername,
  validateEmail,
  validatePassword,
  validateUsername,
} from './auth';

describe('account input validation', () => {
  it('normalizes usernames and enforces the database format', () => {
    expect(normalizeUsername('  Alice_Writer ')).toBe('alice_writer');
    expect(validateUsername('ab')).not.toBeNull();
    expect(validateUsername('a'.repeat(25))).not.toBeNull();
    expect(validateUsername('bad name')).not.toBeNull();
    expect(validateUsername('bad-name')).not.toBeNull();
    expect(validateUsername('good_name_9')).toBeNull();
  });

  it('validates email addresses', () => {
    expect(validateEmail('')).not.toBeNull();
    expect(validateEmail('not-an-email')).not.toBeNull();
    expect(validateEmail('reader@example.com')).toBeNull();
  });

  it('requires a reasonable password length', () => {
    expect(validatePassword('short')).not.toBeNull();
    expect(validatePassword('longenough1')).toBeNull();
  });
});

describe('mapAuthError', () => {
  it('explains common Supabase errors clearly', () => {
    expect(mapAuthError(new Error('Invalid login credentials'))).toBe('Incorrect email or password.');
    expect(mapAuthError(new Error('Email not confirmed'))).toContain('confirm your email');
    expect(mapAuthError(new Error('User already registered'))).toContain('already exists');
    expect(mapAuthError({ message: 'For security purposes, you can only request this after 60 seconds', status: 429 })).toContain('Too many attempts');
  });

  it('passes through unknown messages', () => {
    expect(mapAuthError(new Error('Custom failure'))).toBe('Custom failure');
  });
});
