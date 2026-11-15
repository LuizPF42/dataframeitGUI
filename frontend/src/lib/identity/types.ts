// Contrato de identidade comum aos dois emissores (Clerk no modo hospedado,
// Supabase Auth no modo estático). `lib/auth.ts` consome só isto e a função
// `resolveIdentity` de `lib/identity/server`.
export interface AuthUser {
  id: string; // Supabase UUID
  email: string;
  firstName: string | null;
  lastName: string | null;
  clerkId: string;
  isMaster: boolean;
}

// Resultado observável da resolução de identidade.
// É a fonte única que distingue os estados que a feature precisa separar —
// substitui o antigo `AuthUser | null`, que colapsava "sem sessão", "vínculo
// pendente" e "falha técnica" num único `null` e escondia a diferença dos
// layouts protegidos.
export type AuthResolution =
  | { status: "signed-out" }
  | { status: "authenticated"; user: AuthUser }
  | {
      status: "access-completion-required";
      reason: "link-pending" | "link-divergent";
      actorEmail: string;
    }
  | {
      status: "technical-sync-failure";
      reason: "sync-temporary-failure";
      actorEmail?: string;
    };
