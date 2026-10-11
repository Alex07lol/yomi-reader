/* ─── Auth service ───
   Thin, typed wrapper over Supabase Auth. Reading never requires an account;
   these calls are only used for community actions and the account menu. */

import type { Session, User } from '@supabase/supabase-js';
import { getCommunityClient, requireCommunityClient } from './supabase';

export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
export const MIN_PASSWORD_LENGTH = 8;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): string | null {
  const username = normalizeUsername(raw);
  if (!username) return 'Choose a username.';
  if (username.length < 3) return 'Usernames need at least 3 characters.';
  if (username.length > 24) return 'Usernames can be at most 24 characters.';
  if (!USERNAME_PATTERN.test(username)) return 'Use only lowercase letters, numbers and underscores.';
  return null;
}

export function validateEmail(raw: string): string | null {
  const email = raw.trim();
  if (!email) return 'Enter your email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
  if (email.length > 254) return 'That email address is too long.';
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return 'Enter a password.';
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > 200) return 'That password is too long.';
  return null;
}

/** Turns Supabase auth errors into calm, actionable copy. */
export function mapAuthError(error: unknown): string {
  const message = error instanceof Error
    ? error.message
    : typeof (error as { message?: unknown } | null)?.message === 'string'
      ? (error as { message: string }).message
      : String(error ?? '');
  const code = (error as { code?: string } | null)?.code ?? '';
  const status = (error as { status?: number } | null)?.status ?? 0;
  const lower = message.toLowerCase();

  if (lower.includes('invalid login credentials')) return 'Incorrect email or password.';
  if (lower.includes('email not confirmed')) return 'Please confirm your email address first. Check your inbox.';
  if (lower.includes('user already registered') || code === 'user_already_exists') {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (lower.includes('password should be at least')) return `Choose a password with at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (lower.includes('token has expired') || lower.includes('expired')) return 'That link has expired. Request a new one.';
  if (lower.includes('for security purposes') || status === 429) return 'Too many attempts. Please wait a moment and try again.';
  if (lower.includes('unable to validate email')) return 'Enter a valid email address.';
  if (lower.includes('signups not allowed')) return 'New accounts are currently disabled.';
  if (lower.includes('duplicate key') && lower.includes('username')) return 'That username is already taken.';
  if (lower.includes('database error saving new user')) return 'That username is already taken. Try a different one.';
  return message || 'Something went wrong. Please try again.';
}

export async function getSession(): Promise<Session | null> {
  const client = await getCommunityClient();
  if (!client) return null;
  const { data, error } = await client.auth.getSession();
  if (error) return null;
  return data.session ?? null;
}

export async function getCurrentUser(): Promise<User | null> {
  const client = await getCommunityClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  if (error) return null;
  return data.user ?? null;
}

function authRedirectUrl(path = ''): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return `${window.location.origin}${window.location.pathname}${path}`;
}

export async function signUp(input: { email: string; password: string; username: string }): Promise<{ needsEmailConfirmation: boolean }> {
  const client = await requireCommunityClient();
  const username = normalizeUsername(input.username);
  const { data, error } = await client.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      data: { username },
      emailRedirectTo: authRedirectUrl(),
    },
  });
  if (error) throw new Error(mapAuthError(error));
  return { needsEmailConfirmation: !data.session };
}

export async function signIn(email: string, password: string): Promise<void> {
  const client = await requireCommunityClient();
  const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(mapAuthError(error));
}

export async function signOut(): Promise<void> {
  const client = await getCommunityClient();
  if (!client) return;
  await client.auth.signOut();
}

export async function sendPasswordReset(email: string): Promise<void> {
  const client = await requireCommunityClient();
  const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: authRedirectUrl(),
  });
  if (error) throw new Error(mapAuthError(error));
}

export async function resendConfirmation(email: string): Promise<void> {
  const client = await requireCommunityClient();
  const { error } = await client.auth.resend({
    type: 'signup',
    email: email.trim(),
    options: { emailRedirectTo: authRedirectUrl() },
  });
  if (error) throw new Error(mapAuthError(error));
}

export async function updatePassword(password: string): Promise<void> {
  const client = await requireCommunityClient();
  const { error } = await client.auth.updateUser({ password });
  if (error) throw new Error(mapAuthError(error));
}

/** Confirms a recovery/signup token delivered as `?token_hash=…&type=…`. */
export async function verifyEmailToken(tokenHash: string, type: string): Promise<void> {
  const client = await requireCommunityClient();
  const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: type as 'recovery' });
  if (error) throw new Error(mapAuthError(error));
}

export async function isModerator(): Promise<boolean> {
  const client = await getCommunityClient();
  if (!client) return false;
  const { data, error } = await client.rpc('is_community_moderator');
  if (error) return false;
  return data === true;
}

/* ─── OAuth providers ───
   Providers are enabled in the Supabase dashboard (Authentication → Providers).
   The frontend never holds provider secrets; Supabase brokers the whole flow
   and returns to `authRedirectUrl()`. Only the providers listed in the optional
   `VITE_SUPABASE_OAUTH_PROVIDERS` variable are offered, defaulting to the two
   most common. */

export type OAuthProvider = 'google' | 'github';

export const OAUTH_PROVIDER_LABELS: Record<OAuthProvider, string> = {
  google: 'Google',
  github: 'GitHub',
};

const KNOWN_OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'github'];

export function getOAuthProviders(rawOverride?: string): OAuthProvider[] {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const raw = rawOverride ?? env.VITE_SUPABASE_OAUTH_PROVIDERS;
  if (raw === undefined) return [...KNOWN_OAUTH_PROVIDERS];
  const requested = raw.split(',').map((value) => value.trim().toLowerCase());
  return KNOWN_OAUTH_PROVIDERS.filter((provider) => requested.includes(provider));
}

/** Redirects the browser to the provider; resolves only on an immediate error. */
export async function signInWithOAuth(provider: OAuthProvider): Promise<void> {
  const client = await requireCommunityClient();
  const { error } = await client.auth.signInWithOAuth({
    provider,
    options: { redirectTo: authRedirectUrl() },
  });
  if (error) throw new Error(mapAuthError(error));
}
