// Edge Function do assistente "Criar a nuvem do grupo" (modo estático).
// Fica num projeto Supabase dos mantenedores, não no de cada grupo. Segredos:
//   DFIT_OAUTH_CLIENT_ID, DFIT_OAUTH_CLIENT_SECRET — app OAuth do supabase.com
//   ALLOWED_ORIGINS — origens do site publicado (ex.: https://grupo.github.io)
// Lógica e justificativa em logica.mjs.
import { handle } from "./logica.mjs";

declare const Deno: {
  serve(handler: (request: Request) => Response | Promise<Response>): void;
  env: { toObject(): Record<string, string> };
};

Deno.serve((req: Request) => handle(req, Deno.env.toObject()));
