import { currentUser } from "@clerk/nextjs/server";
import { getVerifiedPrimaryEmail } from "@/lib/clerk-primary-email";
import { readSupabaseUidFromMetadata } from "@/lib/clerk-supabase-uid";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import type { AuthResolution } from "@/lib/identity/types";

// Emissor de identidade do modo hospedado: sessão do Clerk cruzada com
// `clerk_user_mapping`. O build estático substitui este módulo por
// `src/static/identity/server.ts` (Supabase Auth), com a mesma assinatura.

function technicalSyncFailure(actorEmail?: string): AuthResolution {
  return {
    status: "technical-sync-failure",
    reason: "sync-temporary-failure",
    ...(actorEmail ? { actorEmail } : {}),
  };
}

// Resolve o UUID Supabase da sessão SEM escrever nada: exige que
// metadata do Clerk e `clerk_user_mapping` existam simultaneamente. Nunca chama
// `reconcileClerkUserAccess` — a criação/reparo do vínculo é responsabilidade
// explícita da ação de conclusão de acesso, fora do render protegido.
type SupabaseIdentityRead =
  | { status: "resolved"; uid: string; mappingUid: string }
  | { status: "pending" }
  | { status: "unavailable" };

async function readSupabaseUid(
  clerkUserId: string,
  metadataUid: string | undefined,
): Promise<SupabaseIdentityRead> {
  const admin = createSupabaseAdmin();
  const { data: mapping, error: mappingError } = await admin
    .from("clerk_user_mapping")
    .select("supabase_user_id, access_sync_version")
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();
  // A leitura também valida que metadata e mapping continuam coerentes. Se ela
  // falha, autenticar apenas pela metadata esconderia uma divergência possível.
  if (mappingError) {
    console.error("[auth] leitura de clerk_user_mapping falhou", {
      clerkUserId,
      error: mappingError,
    });
    return { status: "unavailable" };
  }
  const mappingUid = mapping?.supabase_user_id ?? null;
  // Os dois lados são necessários: a metadata alimenta o JWT/RLS e o mapping
  // confirma o vínculo interno. Aceitar apenas um produziria duas identidades
  // observáveis diferentes na mesma request.
  if (
    !metadataUid ||
    !mapping ||
    !mappingUid ||
    mapping.access_sync_version < 1
  ) {
    return { status: "pending" };
  }
  return { status: "resolved", uid: metadataUid, mappingUid };
}

/**
 * Resolução de identidade autenticada, request-scoped e read-only.
 *
 * `cache()` deduplica a resolução Clerk + lookups em `clerk_user_mapping` e
 * `master_users` quando vários layouts, pages e helpers da mesma request pedem
 * a identidade. Não faz nenhuma escrita: quando
 * o vínculo interno está ausente, pendente ou divergente, retorna
 * `access-completion-required` para que a página protegida falhe fechada e
 * redirecione à conclusão de acesso, em vez de reparar no render.
 */
export async function resolveIdentity(): Promise<AuthResolution> {
  const user = await currentUser();
  if (!user) return { status: "signed-out" };

  const metadataUid = readSupabaseUidFromMetadata(user);
  const email = getVerifiedPrimaryEmail(user);

  // AuthUser exige o e-mail primário verificado em qualquer estado do vínculo.
  // Um secundário não pode substituir silenciosamente a identidade canônica.
  if (!email) {
    return technicalSyncFailure();
  }

  const identity = await readSupabaseUid(user.id, metadataUid);

  if (identity.status === "unavailable") {
    return technicalSyncFailure(email);
  }

  // Vínculo ainda não existe, mas o e-mail necessário para repará-lo já foi
  // validado acima.
  if (identity.status === "pending") {
    return {
      status: "access-completion-required",
      reason: "link-pending",
      actorEmail: email,
    };
  }

  const { uid, mappingUid } = identity;

  // Metadata e mapping apontam para identidades incompatíveis: não adivinhar
  // qual vale — encaminhar para reparo. "Divergente" é derivado desta
  // leitura, não fica gravado em coluna.
  if (uid !== mappingUid) {
    return {
      status: "access-completion-required",
      reason: "link-divergent",
      actorEmail: email,
    };
  }

  const admin = createSupabaseAdmin();
  const { data: masterRow, error: masterError } = await admin
    .from("master_users")
    .select("user_id")
    .eq("user_id", uid)
    .maybeSingle();
  // Sem confirmar `master_users`, não existe um `AuthUser` completo: rebaixar
  // silenciosamente um master para não-master esconderia uma falha de autorização.
  if (masterError) {
    console.error("[auth] leitura de master_users falhou", {
      supabaseUid: uid,
      error: masterError,
    });
    return technicalSyncFailure(email);
  }

  // Nota: a ativação de perfil (`activated_at`) NÃO acontece aqui.
  // Este caminho é read-only por design — a ativação é reparo de vínculo e vive
  // fora do render: no webhook `user.created` (com retry do Svix) e na ação
  // `completeAccess` da tela de conclusão. Não recolocar a escrita neste ponto:
  // além de reintroduzir mutação no caminho crítico, ela quebraria os testes de
  // contagem de lookups (auth-request-dedup / auth-no-remote-lookup).
  return {
    status: "authenticated",
    user: {
      id: uid,
      email,
      firstName: user.firstName,
      lastName: user.lastName,
      clerkId: user.id,
      isMaster: !!masterRow,
    },
  };
}
