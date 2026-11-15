// Emissor de identidade do modo estático: a sessão do Supabase Auth. Mesma
// assinatura de `lib/identity/server.ts` (Clerk); `lib/auth.ts` não muda.
//
// Não há vínculo a reconciliar: `sub` do JWT já é `profiles.id`, e a RLS o
// reconhece por `clerk_uid()` quando a instância tem `native_supabase_auth`.

import type { AuthResolution } from "@/lib/identity/types";
import { getSupabase } from "@/static/runtime/supabase";

function technicalSyncFailure(actorEmail?: string): AuthResolution {
  return {
    status: "technical-sync-failure",
    reason: "sync-temporary-failure",
    ...(actorEmail ? { actorEmail } : {}),
  };
}

export async function resolveIdentity(): Promise<AuthResolution> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getSession();
  if (error) return technicalSyncFailure();
  const session = data.session;
  if (!session) return { status: "signed-out" };

  const { user } = session;
  const email = user.email?.toLowerCase();
  if (!email) return technicalSyncFailure();

  const [masterResult, profileResult] = await Promise.all([
    supabase.rpc("is_master"),
    supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  // Sem confirmar o papel de master não existe identidade completa (mesma
  // regra do emissor Clerk): rebaixar em silêncio esconderia falha de acesso.
  if (masterResult.error) return technicalSyncFailure(email);

  const profile = profileResult.data as { first_name: string | null; last_name: string | null } | null;
  return {
    status: "authenticated",
    user: {
      id: user.id,
      email,
      firstName: profile?.first_name ?? null,
      lastName: profile?.last_name ?? null,
      clerkId: user.id,
      isMaster: masterResult.data === true,
    },
  };
}
