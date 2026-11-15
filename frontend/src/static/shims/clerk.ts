// O modo estático não tem Clerk. Os únicos módulos que o importam são o login
// e a conclusão de acesso do modo hospedado (fora da tabela de rotas) e o
// emissor de identidade do Clerk (trocado por `static/identity`). Se algo mais
// passar a importá-lo, a chamada falha alto em vez de fingir uma sessão.

function unavailable(name: string): never {
  throw new Error(`${name} do Clerk não existe no modo estático.`);
}

export const auth = () => unavailable("auth()");
export const currentUser = () => unavailable("currentUser()");
export const clerkClient = () => unavailable("clerkClient()");
export const useAuth = () => unavailable("useAuth()");
export const useClerk = () => unavailable("useClerk()");
export const useUser = () => unavailable("useUser()");
export const SignIn = () => unavailable("<SignIn>");
export const ClerkProvider = () => unavailable("<ClerkProvider>");
export const isClerkAPIResponseError = () => false;
export const ptBR = {};
