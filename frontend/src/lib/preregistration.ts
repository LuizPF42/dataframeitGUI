import { createSupabaseAdmin } from "@/lib/supabase/admin";

// Pré-registro de membro sem conta: cria `auth.users` (o trigger
// `handle_new_user` cria o profile pendente) ou reaproveita o placeholder
// existente. Não depende do provedor de login — o modo hospedado (Clerk) e o
// estático (Supabase Auth) usam este mesmo caminho; `lib/clerk-sync.ts`
// reexporta daqui.

type SupabaseAdmin = ReturnType<typeof createSupabaseAdmin>;

/**
 * Conflito estrutural de identidade: o estado do Clerk e o do banco são
 * coerentes entre si, mas incompatíveis com a operação pedida. Repetir a
 * chamada produz o mesmo resultado, então quem trata precisa oferecer uma saída
 * — não um "tente novamente". Falhas de rede, indisponibilidade e corridas
 * continuam sendo Error comum, onde o retry faz sentido.
 */
export class ClerkIdentityConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClerkIdentityConflictError";
  }
}

type PreregisteredProfile = {
  id: string;
  activated_at: string | null;
};

async function requireUnclaimedPlaceholder(
  admin: SupabaseAdmin,
  profile: PreregisteredProfile,
): Promise<string> {
  if (profile.activated_at !== null) {
    throw new ClerkIdentityConflictError(
      "Este e-mail já pertence a uma conta ativa",
    );
  }

  const { data: mapping, error } = await admin
    .from("clerk_user_mapping")
    .select("clerk_user_id")
    .eq("supabase_user_id", profile.id)
    .maybeSingle();
  if (error) {
    throw new Error(`Erro ao verificar mapping Clerk: ${error.message}`);
  }
  if (mapping) {
    throw new ClerkIdentityConflictError(
      "Este pré-registro já pertence a uma conta Clerk",
    );
  }
  return profile.id;
}

/**
 * Localiza a identidade Supabase pelo profile, que é a representação exigida
 * pela aplicação, ou cria auth.users e deixa o trigger criar esse profile.
 * Uma falha de createUser só é tratada como corrida quando a releitura prova
 * que o profile concorrente já existe.
 */
async function findOrCreatePreregisteredSupabaseUser(
  admin: SupabaseAdmin,
  email: string,
): Promise<string> {
  const { data: profile, error: profileReadError } = await admin
    .from("profiles")
    .select("id, activated_at")
    .eq("email", email)
    .maybeSingle();

  if (profileReadError) {
    throw new Error(`Erro ao consultar profile: ${profileReadError.message}`);
  }
  if (profile) return requireUnclaimedPlaceholder(admin, profile);

  const { data, error: createUserError } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (!createUserError && data.user) {
    return requireUnclaimedPlaceholder(admin, {
      id: data.user.id,
      activated_at: null,
    });
  }

  if (!createUserError) {
    throw new Error("Erro ao criar usuário Supabase: resposta sem usuário");
  }

  const { data: racedProfile, error: racedProfileReadError } = await admin
    .from("profiles")
    .select("id, activated_at")
    .eq("email", email)
    .maybeSingle();

  if (racedProfileReadError) {
    throw new Error(
      `Erro ao reconsultar profile: ${racedProfileReadError.message}`,
    );
  }
  if (racedProfile) return requireUnclaimedPlaceholder(admin, racedProfile);

  throw new Error(`Erro ao criar usuário Supabase: ${createUserError.message}`);
}

/**
 * Cria um placeholder Supabase-only para pré-registro de membro sem conta:
 * auth.users com email confirmado + profiles via trigger handle_new_user,
 * com activated_at = NULL (pendente). Não cria usuário Clerk — o auto-join
 * acontece no signup real, quando reconcileClerkUserAccess mapeia o novo
 * Clerk user para este profile pelo e-mail.
 */
export async function preregisterSupabaseUser(email: string): Promise<string> {
  return findOrCreatePreregisteredSupabaseUser(
    createSupabaseAdmin(),
    email.trim().toLowerCase(),
  );
}
