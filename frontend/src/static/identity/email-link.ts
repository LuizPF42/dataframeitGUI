// Retorno do link mágico do Supabase Auth (fluxo PKCE).
//
// O login do modo estático é por código de 6 dígitos quando o grupo tem SMTP
// próprio: só com ele o Supabase deixa trocar o modelo do e-mail por
// `{{ .Token }}`. Sem SMTP, o e-mail padrão traz um link, que volta para o site
// com `?code=` (ou `?error=`/`#error=` quando o link expirou ou já foi usado).
//
// Por que PKCE, e não o fluxo implícito: no implícito o link devolve os tokens
// no `#hash`, e uma tela que aceitasse qualquer `#access_token` deixaria um
// terceiro logar a vítima na conta dele (CSRF de login). No PKCE, o `code` só
// vira sessão no navegador que pediu o e-mail, que guarda o verificador.

export type EmailLinkResult =
  | { kind: "code"; code: string }
  | { kind: "error"; errorCode: string; description: string };

function paramsOf(search: string, hash: string): URLSearchParams[] {
  return [new URLSearchParams(search), new URLSearchParams(hash.replace(/^#/, ""))];
}

/** Lê o retorno do link na URL atual, ou `null` se a URL não veio de um link. */
export function readEmailLinkResult(search: string, hash: string): EmailLinkResult | null {
  const sources = paramsOf(search, hash);
  for (const params of sources) {
    const error = params.get("error") ?? params.get("error_code");
    if (error) {
      return {
        kind: "error",
        errorCode: params.get("error_code") ?? error,
        description: params.get("error_description") ?? "",
      };
    }
  }
  const code = sources[0].get("code");
  return code && /^[A-Za-z0-9-]{8,128}$/.test(code) ? { kind: "code", code } : null;
}

/** Mensagem em português para o retorno com erro, ou para a troca do code. */
export function describeEmailLinkError(errorCode: string, description = ""): string {
  const text = `${errorCode} ${description}`.toLowerCase();
  // O verificador vem antes: a mensagem dele também contém "invalid".
  if (text.includes("code verifier") || text.includes("code_verifier") || text.includes("flow_state")) {
    return "Abra o link no mesmo navegador em que você pediu o acesso.";
  }
  if (text.includes("otp_expired") || text.includes("expired") || text.includes("invalid")) {
    return "O link expirou ou já foi usado. Alguns filtros de e-mail abrem links antes de você; peça um novo e abra-o assim que chegar.";
  }
  return "Não foi possível entrar por este link. Peça um novo.";
}

/** Tira `code`/`error*` da URL (o code é de uso único e não deve ficar no histórico). */
export function stripEmailLinkParams(url: URL): string {
  for (const key of ["code", "error", "error_code", "error_description"]) url.searchParams.delete(key);
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}
