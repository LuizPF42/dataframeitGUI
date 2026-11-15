// `@/lib/identity/server` na Edge Function: a identidade é a do JWT validado
// na entrada (`auth.getUser`), não um valor enviado no corpo da requisição.
import type { AuthResolution } from "@/lib/identity/types";
import { currentContext } from "@/static/edge/context";
import { createSupabaseServer } from "@/static/edge/supabase-server";
import { resolveFromUser } from "@/static/identity/from-user";

export async function resolveIdentity(): Promise<AuthResolution> {
  return resolveFromUser(await createSupabaseServer(), currentContext().user);
}
