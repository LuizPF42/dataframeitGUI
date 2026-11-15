// Chamada às actions privilegiadas, que no modo estático rodam na Edge Function
// `actions` do projeto Supabase do grupo. O corpo leva só o nome da action e
// os argumentos; a identidade vai no JWT do usuário, que a Edge Function
// valida e repassa à mesma camada `lib/auth` das demais actions.

import { getSupabase } from "@/static/runtime/supabase";
import { invalidateRequestCache } from "@/static/runtime/request-cache";
import { scheduleRefresh } from "@/static/runtime/navigation";

interface EdgeActionResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
  revalidated?: boolean;
  redirect?: string;
}

export async function invokeEdgeAction(module: string, name: string, args: unknown[]): Promise<unknown> {
  const { data, error } = await getSupabase().functions.invoke<EdgeActionResponse>("actions", {
    body: { module, name, args },
  });
  if (error) {
    // FunctionsHttpError traz a resposta: a mensagem da action vem no corpo.
    const context = (error as { context?: Response }).context;
    const detail = context ? await context.json().catch(() => null) : null;
    throw new Error((detail as EdgeActionResponse | null)?.error ?? error.message);
  }
  if (!data) throw new Error("Resposta vazia da Edge Function `actions`.");
  if (data.revalidated) {
    invalidateRequestCache();
    scheduleRefresh();
  }
  if (!data.ok) throw new Error(data.error ?? "Falha na action.");
  return data.result;
}
