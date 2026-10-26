import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
  | string
  | undefined;

export const isConfigured = Boolean(url && key);

// Null until the two environment variables are set (see web/.env.example).
export const supabase: SupabaseClient | null = isConfigured
  ? createClient(url!, key!, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export function requireClient(): SupabaseClient {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}
