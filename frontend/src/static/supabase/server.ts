// `@/lib/supabase/server` no navegador: o cliente da sessão do Supabase Auth.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/static/runtime/supabase";

export async function createSupabaseServer(): Promise<SupabaseClient> {
  return getSupabase();
}

export type SupabaseServerClient = SupabaseClient;
