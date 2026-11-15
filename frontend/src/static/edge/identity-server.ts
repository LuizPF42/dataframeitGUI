// `@/lib/identity/server` na Edge Function: a identidade é a do JWT validado
// na entrada (`auth.getUser`), não um valor enviado no corpo da requisição.
import type { AuthResolution } from "@/lib/identity/types";
import { currentContext } from "@/static/edge/context";
import { createSupabaseServer } from "@/static/edge/supabase-server";

export async function resolveIdentity(): Promise<AuthResolution> {
  const { user } = currentContext();
  const email = user.email?.toLowerCase();
  if (!email) return { status: "technical-sync-failure", reason: "sync-temporary-failure" };

  const supabase = await createSupabaseServer();
  const [masterResult, profileResult] = await Promise.all([
    supabase.rpc("is_master"),
    supabase.from("profiles").select("first_name, last_name").eq("id", user.id).maybeSingle(),
  ]);
  if (masterResult.error) {
    return { status: "technical-sync-failure", reason: "sync-temporary-failure", actorEmail: email };
  }
  const profile = profileResult.data as { first_name: string | null; last_name: string | null } | null;
  return {
    status: "authenticated",
    user: {
      id: user.id,
      email,
      firstName: profile?.first_name ?? null,
      lastName: profile?.last_name ?? null,
      clerkId: user.id,
      isMaster: masterResult.data === true,
    },
  };
}
