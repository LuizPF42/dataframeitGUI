// Emissor de identidade do modo estático: a sessão do Supabase Auth. Mesma
// assinatura de `lib/identity/server.ts` (Clerk); `lib/auth.ts` não muda.
//
// Não há vínculo a reconciliar: `sub` do JWT já é `profiles.id`, e a RLS o
// reconhece por `clerk_uid()` quando a instância tem `native_supabase_auth`.

import type { AuthResolution } from "@/lib/identity/types";
import { resolveFromUser, technicalSyncFailure } from "@/static/identity/from-user";
import { getSupabase } from "@/static/runtime/supabase";

export async function resolveIdentity(): Promise<AuthResolution> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) return technicalSyncFailure();
  if (!data.session) return { status: "signed-out" };
  return resolveFromUser(supabase, data.session.user);
}
