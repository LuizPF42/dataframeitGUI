// Conexão do site estático com o Supabase do grupo.
//
// O mesmo site publicado no GitHub Pages serve qualquer grupo: a URL do
// projeto e a chave anônima (ambas públicas por desenho — quem protege os dados
// é a RLS) chegam pelo "link para a equipe" (`/conectar#url=…&key=…&nome=…`) e
// ficam no navegador. Um grupo que publique o próprio fork pode fixá-las no
// build com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.

export interface Connection {
  url: string;
  anonKey: string;
  name?: string;
}

const STORAGE_KEY = "dataframeit:connection";

function fromBuild(): Connection | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && anonKey ? { url, anonKey, name: import.meta.env.VITE_GROUP_NAME as string | undefined } : null;
}

export function isValidSupabaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const local = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    return parsed.protocol === "https:" || (local && parsed.protocol === "http:");
  } catch {
    return false;
  }
}

export function readConnection(): Connection | null {
  const built = fromBuild();
  if (built) return built;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Connection>;
    if (typeof parsed.url !== "string" || typeof parsed.anonKey !== "string") return null;
    if (!isValidSupabaseUrl(parsed.url)) return null;
    return { url: parsed.url, anonKey: parsed.anonKey, name: parsed.name };
  } catch {
    return null;
  }
}

export function saveConnection(connection: Connection): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
}

export function clearConnection(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Armazenamento bloqueado: não há o que limpar.
  }
}

/** Lê `#url=…&key=…&nome=…` do link para a equipe. */
export function parseTeamLink(hash: string): Connection | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const url = params.get("url");
  const anonKey = params.get("key");
  if (!url || !anonKey || !isValidSupabaseUrl(url)) return null;
  return { url: url.replace(/\/$/, ""), anonKey, name: params.get("nome") ?? undefined };
}

/** Monta o link para a equipe a partir da origem do site publicado. */
export function buildTeamLink(siteUrl: string, connection: Connection): string {
  const params = new URLSearchParams({ url: connection.url, key: connection.anonKey });
  if (connection.name) params.set("nome", connection.name);
  return `${siteUrl.replace(/\/$/, "")}/conectar#${params.toString()}`;
}

export function isBuildConnection(): boolean {
  return fromBuild() !== null;
}
