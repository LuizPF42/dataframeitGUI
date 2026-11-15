// `@/lib/identity/client` no modo estático (Supabase Auth).
import { useCallback } from "react";
import { navigate } from "@/static/runtime/navigation";
import { getAccessToken, getSupabase } from "@/static/runtime/supabase";

export function useSessionToken(): () => Promise<string | null> {
  return getAccessToken;
}

export function useSignOut(): (options?: { redirectUrl?: string }) => Promise<void> {
  return useCallback(async (options?: { redirectUrl?: string }) => {
    const { error } = await getSupabase().auth.signOut();
    if (error) throw error;
    navigate(options?.redirectUrl ?? "/auth/login", { replace: true });
  }, []);
}
