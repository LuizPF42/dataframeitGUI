// Cliente do assistente "Criar a nuvem do grupo". Fala com a Edge Function de
// setup dos mantenedores (supabase/functions/static-setup), que é quem chama a
// Management API do Supabase com o token OAuth que a pessoa concedeu.

import { siteRoot } from "@/static/runtime/base-path";

export interface SetupConfig {
  functionUrl: string;
  functionKey: string;
  oauthClientId: string;
}

export function readSetupConfig(): SetupConfig | null {
  const functionUrl = import.meta.env.VITE_SETUP_FUNCTION_URL;
  const functionKey = import.meta.env.VITE_SETUP_ANON_KEY;
  const oauthClientId = import.meta.env.VITE_SUPABASE_OAUTH_CLIENT_ID;
  return functionUrl && functionKey && oauthClientId ? { functionUrl, functionKey, oauthClientId } : null;
}

export { siteRoot };

function setupRedirectUri(): string {
  return `${siteRoot()}/nova-nuvem`;
}

class SetupError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SetupError";
  }
}

const ERROR_MESSAGES: Record<string, string> = {
  origin: "Este site não está autorizado no serviço de configuração.",
  not_configured: "O serviço de configuração ainda não tem o app OAuth do Supabase.",
  redirect: "Endereço de retorno não autorizado.",
  token: "Sessão do Supabase expirada. Entre de novo.",
  args: "Dados inválidos para esta etapa.",
  ref: "Projeto inválido.",
};

export async function setupCall<T>(config: SetupConfig, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(config.functionUrl, {
    method: "POST",
    headers: {
      apikey: config.functionKey,
      Authorization: `Bearer ${config.functionKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string } & T;
  if (!response.ok) {
    const detail = data.error === "upstream" && data.message ? `Supabase respondeu: ${data.message}` : null;
    throw new SetupError(detail ?? ERROR_MESSAGES[data.error ?? ""] ?? `Falha na etapa (${response.status}).`, response.status);
  }
  return data;
}

// ---------------------------------------------------------------- OAuth PKCE
const PKCE_KEY = "dataframeit:setup-pkce";

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(size = 32): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function startOAuth(config: SetupConfig, mode: "create" | "update"): Promise<void> {
  const verifier = randomString(48);
  const state = randomString(16);
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, mode }));
  const params = new URLSearchParams({
    client_id: config.oauthClientId,
    redirect_uri: setupRedirectUri(),
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  window.location.assign(`https://api.supabase.com/v1/oauth/authorize?${params.toString()}`);
}

/** Na volta do supabase.com: troca o código pelo token (via função de setup). */
export async function finishOAuth(
  config: SetupConfig,
): Promise<{ token: string; mode: "create" | "update" } | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return null;
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) ?? "null") as
    | { verifier: string; state: string; mode: "create" | "update" }
    | null;
  sessionStorage.removeItem(PKCE_KEY);
  window.history.replaceState(null, "", window.location.pathname);
  if (!saved || params.get("state") !== saved.state) {
    throw new SetupError("A volta do Supabase não corresponde a este navegador. Comece de novo.", 400);
  }
  const { access_token } = await setupCall<{ access_token: string }>(config, {
    op: "exchange",
    code,
    code_verifier: saved.verifier,
    redirect_uri: setupRedirectUri(),
  });
  return { token: access_token, mode: saved.mode };
}

// ------------------------------------------------------------ instalação
export interface MigrationEntry {
  version: string;
  name: string;
  sql: string;
}

async function fetchSiteFile(pathName: string): Promise<Response> {
  const response = await fetch(`${siteRoot()}/${pathName}`, { cache: "no-store" });
  if (!response.ok) throw new SetupError(`Arquivo ${pathName} ausente no site publicado.`, response.status);
  return response;
}

export async function loadInstallSql(): Promise<string> {
  return (await fetchSiteFile("schema/schema.sql")).text();
}

export async function loadMigrations(): Promise<MigrationEntry[]> {
  return (await fetchSiteFile("schema/migrations.json")).json() as Promise<MigrationEntry[]>;
}

export async function loadActionsBundle(): Promise<string> {
  return (await fetchSiteFile("edge/actions/index.js")).text();
}

const quote = (text: string) => `'${text.replace(/'/g, "''")}'`;

/** SQL das migrations que faltam numa nuvem já instalada (mesmo formato do schema.sql). */
export function pendingMigrationsSql(all: MigrationEntry[], applied: string[]): { sql: string; count: number } {
  const done = new Set(applied);
  const pending = all.filter((migration) => !done.has(migration.version));
  if (!pending.length) return { sql: "", count: 0 };
  const sql = [
    ...pending.map((m) => `-- ===== ${m.version}_${m.name} =====\n${m.sql}`),
    "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES\n" +
      pending.map((m) => `  (${quote(m.version)}, ${quote(m.name)})`).join(",\n") +
      "\nON CONFLICT (version) DO NOTHING;",
  ].join("\n");
  return { sql, count: pending.length };
}

export interface VerifyReport {
  native_auth: boolean;
  tables_without_rls: string[];
  migrations: number;
  publish_rpc: boolean;
  identity_fn: boolean;
}

export function verifyProblems(report: VerifyReport | null, expectedMigrations: number): string[] {
  if (!report) return ["A verificação não devolveu resultado."];
  const problems: string[] = [];
  if (!report.native_auth) problems.push("O login pelo Supabase Auth (modo nativo) não ficou ligado.");
  if (report.tables_without_rls.length) {
    problems.push(`Tabelas sem RLS: ${report.tables_without_rls.join(", ")}.`);
  }
  if (report.migrations < expectedMigrations) {
    problems.push(`Só ${report.migrations} de ${expectedMigrations} migrations registradas.`);
  }
  if (!report.publish_rpc || !report.identity_fn) problems.push("Funções do banco ausentes.");
  return problems;
}
