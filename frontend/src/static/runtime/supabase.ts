// Cliente Supabase único do navegador, com a sessão do Supabase Auth. É o
// mesmo papel do cliente de `lib/supabase/server.ts` no modo hospedado: toda
// leitura e escrita sai com o JWT do usuário e passa pela RLS.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readConnection, type Connection } from "@/static/runtime/connection";

let client: SupabaseClient | null = null;
let clientFor: string | null = null;

class NotConnectedError extends Error {
  constructor() {
    super("Este navegador ainda não está conectado à nuvem do grupo.");
    this.name = "NotConnectedError";
  }
}

function projectRefOf(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0] ?? "local";
  } catch {
    return "local";
  }
}

export function createBrowserClient(connection: Connection): SupabaseClient {
  return createClient(connection.url, connection.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: `dataframeit-auth-${projectRefOf(connection.url)}`,
    },
  });
}

export function getSupabase(): SupabaseClient {
  const connection = readConnection();
  if (!connection) throw new NotConnectedError();
  const id = `${connection.url}|${connection.anonKey}`;
  if (!client || clientFor !== id) {
    client = createBrowserClient(connection);
    clientFor = id;
  }
  return client;
}

/** Token de acesso atual (renovado pelo supabase-js quando perto de expirar). */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabase().auth.getSession();
  return data.session?.access_token ?? null;
}
