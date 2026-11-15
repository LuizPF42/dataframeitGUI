// `@/lib/supabase/admin` na Edge Function. A service role existe só aqui, na
// variável de ambiente que o próprio Supabase injeta na função; nunca sai para
// o navegador. Os usos são os mesmos do modo hospedado, com os mesmos gates.
import { createClient } from "@supabase/supabase-js";
import { env } from "@/static/edge/context";

export function createSupabaseAdmin() {
  return createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
