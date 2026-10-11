import { describe, expect, it, vi } from 'vitest';
import { isAuthCallbackUrl } from './supabase';

/* The public variables are injected explicitly rather than stubbed: Vitest
   rewrites `import.meta.env` per module while transforming it, so `vi.stubEnv()`
   never reaches a module that reads it directly (see ./env.ts). Mocking the env
   module keeps these tests independent of the developer's `.env.local`. */
const config = vi.hoisted(() => ({ url: '', anonKey: '' }));

vi.mock('./env', () => ({ readCommunityEnv: () => ({ ...config, oauthProviders: undefined }) }));

describe('auth callback detection', () => {
  it('recognizes implicit-flow hash tokens', () => {
    expect(isAuthCallbackUrl('#access_token=abc&refresh_token=def&type=recovery', '')).toBe(true);
    expect(isAuthCallbackUrl('#error=access_denied&error_description=nope', '')).toBe(true);
  });

  it('recognizes PKCE and token_hash query callbacks', () => {
    expect(isAuthCallbackUrl('', '?code=abc123')).toBe(true);
    expect(isAuthCallbackUrl('', '?token_hash=abc&type=recovery')).toBe(true);
  });

  it('ignores ordinary hash routes', () => {
    expect(isAuthCallbackUrl('#reader/omniscient-readers-viewpoint/orv-1', '')).toBe(false);
    expect(isAuthCallbackUrl('#library?search=reader', '')).toBe(false);
  });
});

/* `getCommunityClient` memoizes per module instance, so each case imports a
   fresh copy of the module. */
describe('optional client', () => {
  it('degrades to unconfigured without public variables', async () => {
    config.url = '';
    config.anonKey = '';
    vi.resetModules();

    const community = await import('./supabase');

    expect(await community.getCommunityClient()).toBeNull();
    expect(community.getCommunityAvailability()).toBe('unconfigured');
    expect(community.getCommunityPublicUrl()).toBeNull();
  });

  it('starts and reports ready when both public variables are present', async () => {
    config.url = 'https://example.supabase.co';
    config.anonKey = 'sb_publishable_example';
    vi.resetModules();

    const community = await import('./supabase');
    const client = await community.getCommunityClient();

    expect(client).not.toBeNull();
    expect(community.getCommunityAvailability()).toBe('ready');
    expect(community.getCommunityPublicUrl()).toBe('https://example.supabase.co');
  });
});
