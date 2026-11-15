// Contexto por requisição da Edge Function `actions`. O mesmo isolate do
// Deno atende requisições concorrentes; o AsyncLocalStorage é o que dá a cada
// chamada o seu JWT, a sua memória de `cache()` e o seu registro de
// revalidação, sem estado global compartilhado entre usuários.

import { AsyncLocalStorage } from "node:async_hooks";
import type { User } from "@supabase/supabase-js";

export interface EdgeRequestContext {
  token: string;
  user: User;
  revalidated: boolean;
  memo: Map<unknown, Map<string, unknown>>;
  background: Promise<unknown>[];
}

const storage = new AsyncLocalStorage<EdgeRequestContext>();

export function runWithContext<T>(context: EdgeRequestContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(context, fn);
}

export function currentContext(): EdgeRequestContext {
  const context = storage.getStore();
  if (!context) throw new Error("Chamada fora de uma requisição da Edge Function.");
  return context;
}

export function env(name: string): string {
  const value = (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno?.env.get(name)
    ?? (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[name];
  if (!value) throw new Error(`Variável de ambiente ausente na Edge Function: ${name}`);
  return value;
}
