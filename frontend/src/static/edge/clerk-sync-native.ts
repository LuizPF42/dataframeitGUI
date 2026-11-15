// `@/lib/clerk-sync` na Edge Function do modo estático. As actions de equipe
// (`actions/members.ts`) usam três peças deste módulo: o erro de conflito, o
// pré-registro (que não depende do Clerk e vem de `lib/preregistration`) e a
// prova de posse de um e-mail. Sem Clerk, a dona de um e-mail é a conta de
// `auth.users` com e-mail confirmado que já entrou ao menos uma vez; a versão
// do snapshot é a que `assert_identity_write_proof` confere no modo nativo.

import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { ClerkIdentityConflictError } from "@/lib/preregistration";

export { ClerkIdentityConflictError, preregisterSupabaseUser } from "@/lib/preregistration";

export type ReconciledClerkEmailOwner =
  | { status: "resolved"; userId: string; snapshotVersion: number }
  | { status: "unowned" }
  | { status: "changed" };

export async function reconcileVerifiedClerkEmailOwner(
  rawEmail: string,
): Promise<ReconciledClerkEmailOwner> {
  const email = rawEmail.trim().toLowerCase();
  const { data, error } = await createSupabaseAdmin().rpc("native_email_owner", { p_email: email });
  if (error) throw new Error(`Erro ao consultar a dona do e-mail: ${error.message}`);
  const owners = (data ?? []) as { user_id: string; snapshot_version: number | string }[];
  if (owners.length > 1) {
    throw new ClerkIdentityConflictError("Mais de uma conta possui o e-mail verificado");
  }
  const owner = owners[0];
  if (!owner) return { status: "unowned" };
  return { status: "resolved", userId: owner.user_id, snapshotVersion: Number(owner.snapshot_version) };
}
