// Despacho da Edge Function `actions`: o equivalente, no modo estático, do
// endpoint de Server Actions do Next. Recebe `{ module, name, args }`, valida
// o JWT de quem chama e executa a action registrada com esse usuário no
// contexto. Só entram no registro as actions que precisam da service role
// (ver `scripts/static/privileged-actions.mjs`); as demais rodam no navegador.

import type { User } from "@supabase/supabase-js";
import { RedirectSignal } from "@/static/runtime/control-flow";
import { runWithContext, type EdgeRequestContext } from "@/static/edge/context";

type Action = (...args: unknown[]) => Promise<unknown>;
export type ActionRegistry = Record<string, Record<string, unknown>>;

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const GENERIC_FAILURE = "Não foi possível concluir a operação. Tente novamente.";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function lookup(registry: ActionRegistry, module: unknown, name: unknown): Action | null {
  if (typeof module !== "string" || typeof name !== "string") return null;
  if (!Object.prototype.hasOwnProperty.call(registry, module)) return null;
  const exports = registry[module];
  if (!Object.prototype.hasOwnProperty.call(exports, name)) return null;
  const candidate = exports[name];
  return typeof candidate === "function" ? (candidate as Action) : null;
}

export interface HandlerOptions {
  getUser(token: string): Promise<User | null>;
  waitUntil?(promise: Promise<unknown>): void;
}

export function createActionHandler(registry: ActionRegistry, options: HandlerOptions) {
  return async function handle(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    if (request.method !== "POST") return json(405, { ok: false, error: "Método não permitido." });

    const header = request.headers.get("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token) return json(401, { ok: false, error: "Não autenticado" });

    const user = await options.getUser(token).catch(() => null);
    if (!user) return json(401, { ok: false, error: "Não autenticado" });

    let body: { module?: unknown; name?: unknown; args?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json(400, { ok: false, error: "Requisição inválida." });
    }
    if (!body || !Array.isArray(body.args)) return json(400, { ok: false, error: "Requisição inválida." });

    const action = lookup(registry, body.module, body.name);
    if (!action) return json(404, { ok: false, error: "Ação desconhecida." });

    const context: EdgeRequestContext = {
      token,
      user,
      revalidated: false,
      memo: new Map(),
      background: [],
    };
    const args = body.args as unknown[];
    try {
      const result = await runWithContext(context, () => action(...args));
      if (context.background.length) options.waitUntil?.(Promise.allSettled(context.background));
      return json(200, { ok: true, result: result ?? null, revalidated: context.revalidated });
    } catch (error) {
      if (error instanceof RedirectSignal) {
        return json(200, { ok: true, result: null, redirect: error.href, revalidated: context.revalidated });
      }
      // Como o Next em produção: o detalhe da exceção fica no log, e o
      // navegador recebe uma mensagem genérica. Erros esperados as actions já
      // devolvem como valor (`{ error }`), não como exceção.
      console.error(
        JSON.stringify({
          event: "edge_action_failed",
          module: body.module,
          name: body.name,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return json(500, { ok: false, error: GENERIC_FAILURE, revalidated: context.revalidated });
    }
  };
}
