/* ─── Optional Supabase client ───
   Community features are optional. If the public Supabase variables are
   absent, or the SDK fails to load, the app stays fully usable: the reader,
   library, downloads and local progress never depend on this module.

   Only the public URL and publishable/anon key are ever used here. A
   service-role key must never reach the browser. */

import type { SupabaseClient } from '@supabase/supabase-js';
import { emitCommunityEvent } from './events';
import { readCommunityEnv } from './env';

export type CommunityAvailability = 'unknown' | 'unconfigured' | 'ready';

export class CommunityUnavailableError extends Error {
  constructor(message = 'Community features are not available right now.') {
    super(message);
    this.name = 'CommunityUnavailableError';
  }
}

function readConfig(): { url: string; anonKey: string } | null {
  const { url, anonKey } = readCommunityEnv();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

let availability: CommunityAvailability = 'unknown';
let clientPromise: Promise<SupabaseClient | null> | null = null;
let readyClient: SupabaseClient | null = null;
let publicUrl: string | null = null;

export function getCommunityAvailability(): CommunityAvailability {
  return availability;
}

/** Synchronous best-effort check so UI can render before the SDK loads. */
export function isCommunityConfigured(): boolean {
  return readConfig() !== null;
}

export function getCommunityClientSync(): SupabaseClient | null {
  return readyClient;
}

export function getCommunityPublicUrl(): string | null {
  return publicUrl;
}

/** Loads and memoizes the client. Resolves to `null` when unconfigured. */
export function getCommunityClient(): Promise<SupabaseClient | null> {
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const config = readConfig();
    if (!config) {
      availability = 'unconfigured';
      emitCommunityEvent('availability');
      return null;
    }

    try {
      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(config.url, config.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'yomi-community-auth',
        },
      });
      readyClient = client;
      publicUrl = config.url;
      availability = 'ready';
      emitCommunityEvent('availability');
      return client;
    } catch (error) {
      // A failed SDK load must never break the reader.
      console.warn('Yomi community features could not start.', error);
      availability = 'unconfigured';
      emitCommunityEvent('availability');
      return null;
    }
  })();

  return clientPromise;
}

export async function requireCommunityClient(): Promise<SupabaseClient> {
  const client = await getCommunityClient();
  if (!client) throw new CommunityUnavailableError();
  return client;
}

/** Detects Supabase auth callback URLs so they can be consumed before routing. */
export function isAuthCallbackUrl(hash = window.location.hash, search = window.location.search): boolean {
  const normalizedHash = hash.replace(/^#/, '');
  const patterns = /(^|[#&?])(access_token|refresh_token|error|error_description|code|token_hash|type)=/;
  return patterns.test(normalizedHash) || /(^|[?&])(code|token_hash|error|error_description)=/.test(search);
}
