// Deletes the calling user's account. Every student table references auth.users
// with ON DELETE CASCADE, so this removes profile, answers, consents, matches,
// notifications and push subscriptions; submissions and error reports keep only
// their content (user_id is set to null).
//
// Deploy: supabase functions deploy delete-account
// The service-role key is available to Edge Functions automatically and never
// leaves Supabase.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'sign in required' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Identify the caller from their own token.
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await asUser.auth.getUser();
  if (error || !data.user) return json({ error: 'sign in required' }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error: deleteError } = await admin.auth.admin.deleteUser(data.user.id);
  if (deleteError) {
    // Log only the id, never profile data.
    console.error('delete-account failed', { user_id: data.user.id, code: deleteError.status });
    return json({ error: 'could not delete account' }, 500);
  }

  return json({ deleted: true });
});
