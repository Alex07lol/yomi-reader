import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOAuthProviders, OAUTH_PROVIDER_LABELS, signInWithOAuth } from './auth';

const h = vi.hoisted(() => {
  const state = { called: 0, config: null as Record<string, unknown> | null };
  return { state };
});

/* The allow-list comes from the environment; inject it explicitly so the test
   does not depend on a developer's `.env.local` (see ./env.ts). */
const env = vi.hoisted(() => ({ oauthProviders: undefined as string | undefined }));

vi.mock('./env', () => ({
  readCommunityEnv: () => ({ url: '', anonKey: '', oauthProviders: env.oauthProviders }),
}));

vi.mock('./supabase', () => ({
  getCommunityClient: async () => h.state.config,
  requireCommunityClient: async () => {
    if (!h.state.config) throw new Error('unconfigured');
    return h.state.config;
  },
  CommunityUnavailableError: class CommunityUnavailableError extends Error {},
}));

afterEach(() => {
  h.state.called = 0;
  h.state.config = null;
  env.oauthProviders = undefined;
});

describe('getOAuthProviders', () => {
  it('defaults to Google and GitHub when unset', () => {
    expect(getOAuthProviders()).toEqual(['google', 'github']);
  });

  it('reads the allow-list from the environment when no override is given', () => {
    env.oauthProviders = 'github';
    expect(getOAuthProviders()).toEqual(['github']);

    env.oauthProviders = '';
    expect(getOAuthProviders()).toEqual([]);
  });

  it('honours an explicit allow-list', () => {
    expect(getOAuthProviders('github')).toEqual(['github']);
  });

  it('ignores unknown providers and disables the row when empty', () => {
    expect(getOAuthProviders('twitter, google')).toEqual(['google']);
    expect(getOAuthProviders('')).toEqual([]);
  });

  it('labels each known provider', () => {
    expect(OAUTH_PROVIDER_LABELS.google).toBe('Google');
    expect(OAUTH_PROVIDER_LABELS.github).toBe('GitHub');
  });
});

describe('signInWithOAuth', () => {
  it('asks Supabase to begin the provider flow with a redirect back to the app', async () => {
    const oauthMock = vi.fn(async (_arg: { provider: string; options: { redirectTo?: string } }) => {
      h.state.called += 1;
      return { data: { provider: 'github', url: 'https://example.test' }, error: null };
    });
    h.state.config = { auth: { signInWithOAuth: oauthMock } } as unknown as Record<string, unknown>;

    await signInWithOAuth('github');

    expect(h.state.called).toBe(1);
    const arg = oauthMock.mock.calls[0][0];
    expect(arg.provider).toBe('github');
    expect(arg.options.redirectTo).toContain(window.location.origin);
  });

  it('surfaces a provider error as a friendly message', async () => {
    h.state.config = {
      auth: { signInWithOAuth: async () => ({ data: null, error: { message: 'Provider is not enabled' } }) },
    } as unknown as Record<string, unknown>;

    await expect(signInWithOAuth('google')).rejects.toThrow(/Provider is not enabled/);
  });
});
