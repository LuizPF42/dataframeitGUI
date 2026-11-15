// Ponto de entrada da Edge Function `actions` (Deno, Supabase Edge Runtime).
// O registro de actions é gerado no build (`scripts/static/build-edge-actions.mjs`).
import { createClient } from "@supabase/supabase-js";
import { env } from "@/static/edge/context";
import { createActionHandler, type ActionRegistry } from "@/static/edge/handler";

declare const Deno: { serve(handler: (request: Request) => Response | Promise<Response>): void };
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

export function serveActions(registry: ActionRegistry): void {
  const auth = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth;
  const handler = createActionHandler(registry, {
    async getUser(token) {
      const { data, error } = await auth.getUser(token);
      return error ? null : data.user;
    },
    waitUntil(promise) {
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(promise);
    },
  });
  Deno.serve(handler);
}
