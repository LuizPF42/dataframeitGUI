// `next/cache` no modo estático. No modo hospedado, `revalidatePath` dentro de
// uma Server Action faz o Next reenviar a rota atual com dados novos. Aqui as
// páginas leem no navegador, então revalidar é pedir ao roteador para resolver
// a rota atual de novo (agrupado num único refresh por tick).

import { invalidateRequestCache } from "@/static/runtime/request-cache";
import { scheduleRefresh } from "@/static/runtime/navigation";

export function revalidatePath(_path?: string, _type?: "page" | "layout"): void {
  invalidateRequestCache();
  scheduleRefresh();
}

export function revalidateTag(_tag?: string, _profile?: unknown): void {
  invalidateRequestCache();
  scheduleRefresh();
}

export function updateTag(tag?: string): void {
  revalidateTag(tag);
}

export function unstable_cache<T extends (...args: never[]) => unknown>(fn: T): T {
  return fn;
}
