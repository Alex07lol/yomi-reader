import { describe, expect, it } from 'vitest';
import { getCommunityAvailability, getCommunityClient, isAuthCallbackUrl } from './supabase';

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

describe('optional client', () => {
  it('degrades to unconfigured without public variables', async () => {
    const client = await getCommunityClient();
    expect(client).toBeNull();
    expect(getCommunityAvailability()).toBe('unconfigured');
  });
});
