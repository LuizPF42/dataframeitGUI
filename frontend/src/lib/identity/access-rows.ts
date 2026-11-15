import "server-only";

import { createSupabaseAdmin } from "@/lib/supabase/admin";

/** Estado do vínculo de identidade de uma conta, no formato que
 * `clerkMappingAccessStatesByUserId` consome. */
export interface IdentityAccessRow {
  supabase_user_id: string;
  access_sync_version: number;
  clerk_deleted: boolean;
}

export type IdentityAccessRowsResult =
  | { data: IdentityAccessRow[]; error: null }
  | { data: null; error: { message: string } };

/**
 * Lê o vínculo de identidade das contas informadas. No modo hospedado ele mora
 * em `clerk_user_mapping`, deny-by-default para o cliente, por isso a leitura
 * usa a service role (só colunas de estado, filtradas pelos membros que a
 * página já leu pela RLS). O build estático troca este módulo por
 * `src/static/identity/access-rows.ts`, que deriva o mesmo estado da ativação
 * do perfil.
 */
export async function readIdentityAccessRows(
  userIds: readonly string[],
): Promise<IdentityAccessRowsResult> {
  if (userIds.length === 0) return { data: [], error: null };
  const { data, error } = await createSupabaseAdmin()
    .from("clerk_user_mapping")
    .select("supabase_user_id, access_sync_version, clerk_deleted")
    .in("supabase_user_id", [...userIds]);
  if (error) return { data: null, error: { message: error.message } };
  return { data: data ?? [], error: null };
}
