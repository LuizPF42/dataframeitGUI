// `@/lib/supabase/server` na Edge Function: cliente com o JWT de quem chamou.
// As leituras e escritas comuns das actions continuam passando pela RLS.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { currentContext, env } from "@/static/edge/context";

export async function createSupabaseServer(): Promise<SupabaseClient> {
  const { token } = currentContext();
  return createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export type SupabaseServerClient = SupabaseClient;
