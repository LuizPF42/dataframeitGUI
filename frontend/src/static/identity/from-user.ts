// Identidade a partir de um usuário do Supabase Auth já validado — comum ao
// navegador (sessão local) e à Edge Function (JWT da requisição). Sem
// confirmar o papel de master não existe identidade completa (mesma regra do
// emissor Clerk): rebaixar em silêncio esconderia falha de acesso.

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AuthResolution } from "@/lib/identity/types";

export function technicalSyncFailure(actorEmail?: string): AuthResolution {
  return {
    status: "technical-sync-failure",
    reason: "sync-temporary-failure",
    ...(actorEmail ? { actorEmail } : {}),
  };
}

export async function resolveFromUser(supabase: SupabaseClient, user: User): Promise<AuthResolution> {
  const email = user.email?.toLowerCase();
  if (!email) return technicalSyncFailure();

  const [masterResult, profileResult] = await Promise.all([
    supabase.rpc("is_master"),
    supabase.from("profiles").select("first_name, last_name").eq("id", user.id).maybeSingle(),
  ]);
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
