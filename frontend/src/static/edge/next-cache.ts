// `next/cache` na Edge Function: a revalidação é registrada e devolvida ao
// navegador, que refaz a rota atual (ver `src/static/edge-client.ts`).
import { currentContext } from "@/static/edge/context";

export function revalidatePath(_path?: string, _type?: "page" | "layout"): void {
  currentContext().revalidated = true;
}

export function revalidateTag(_tag?: string, _profile?: unknown): void {
  currentContext().revalidated = true;
}

export function updateTag(tag?: string): void {
  revalidateTag(tag);
}

export function unstable_cache<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn;
}
