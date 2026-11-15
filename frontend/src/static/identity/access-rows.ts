// `@/lib/identity/access-rows` no modo estático. Sem Clerk não há
// `clerk_user_mapping`: a conta existe em `auth.users` e está pronta quando a
// pessoa já entrou ao menos uma vez (`profiles.activated_at`, gravado pelo
// trigger do primeiro login nativo). Conta pré-cadastrada que nunca entrou fica
// sem linha — o mesmo "pendente" do modo hospedado.

import type { IdentityAccessRowsResult } from "@/lib/identity/access-rows";
import { getSupabase } from "@/static/runtime/supabase";

export type { IdentityAccessRow, IdentityAccessRowsResult } from "@/lib/identity/access-rows";

export async function readIdentityAccessRows(
  userIds: readonly string[],
): Promise<IdentityAccessRowsResult> {
  if (userIds.length === 0) return { data: [], error: null };
  const { data, error } = await getSupabase()
    .from("profiles")
    .select("id, activated_at")
    .in("id", [...userIds]);
  if (error) return { data: null, error: { message: error.message } };
  return {
    data: ((data ?? []) as { id: string; activated_at: string | null }[])
      .filter((profile) => profile.activated_at !== null)
      .map((profile) => ({ supabase_user_id: profile.id, access_sync_version: 1, clerk_deleted: false })),
    error: null,
  };
}
