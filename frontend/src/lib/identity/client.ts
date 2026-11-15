"use client";

import { useAuth, useClerk } from "@clerk/nextjs";

// Identidade do lado do cliente, no modo hospedado (Clerk). O build estático
// substitui este módulo por `src/static/identity/client.ts` (Supabase Auth),
// com as mesmas assinaturas; componentes não importam `@clerk/nextjs` direto.

/** Função que devolve um token de sessão fresco (ou `null` sem sessão). */
export function useSessionToken(): () => Promise<string | null> {
  return useAuth().getToken;
}

/** Encerra a sessão e leva para `redirectUrl`. */
export function useSignOut(): (options?: { redirectUrl?: string }) => Promise<void> {
  return useClerk().signOut;
}
