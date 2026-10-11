/* ─── Public community configuration ───
   The only module that reads Vite's `import.meta.env`. Keeping it separate
   makes the environment injectable: Vite and Vitest rewrite `import.meta.env`
   while transforming each module, so `vi.stubEnv()` cannot reach a module that
   reads it directly. Tests mock this module instead.

   Only the public project URL, the publishable/anon key and the optional OAuth
   allow-list belong here. A secret or service-role key must never be bundled
   into the browser. */

export interface CommunityEnv {
  /** `VITE_SUPABASE_URL`, trimmed; empty when unset. */
  url: string;
  /** `VITE_SUPABASE_ANON_KEY` — publishable or legacy anon key, trimmed. */
  anonKey: string;
  /** `VITE_SUPABASE_OAUTH_PROVIDERS`; `undefined` when the variable is absent. */
  oauthProviders: string | undefined;
}

export function readCommunityEnv(): CommunityEnv {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return {
    url: (env.VITE_SUPABASE_URL ?? '').trim(),
    anonKey: (env.VITE_SUPABASE_ANON_KEY ?? '').trim(),
    oauthProviders: env.VITE_SUPABASE_OAUTH_PROVIDERS,
  };
}
