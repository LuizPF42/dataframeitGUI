// Estado de navegação do modo estático: a URL do navegador é a fonte única, e
// os componentes assinam mudanças por `useSyncExternalStore`. Substitui o
// roteador do Next, que no export estático recarregaria a página inteira a cada
// clique em rota dinâmica (os IDs vêm do banco do grupo e não existem no build).

import { basePath } from "@/static/runtime/base-path";

type Listener = () => void;

const listeners = new Set<Listener>();
let refreshToken = 0;

export interface LocationSnapshot {
  pathname: string;
  search: string;
  hash: string;
  /** Muda a cada `router.refresh()`/revalidação: força nova resolução da rota. */
  refreshToken: number;
}

let snapshot: LocationSnapshot = readLocation();

function readLocation(): LocationSnapshot {
  const raw = window.location.pathname;
  const pathname =
    basePath && raw.startsWith(basePath) ? raw.slice(basePath.length) || "/" : raw;
  return {
    pathname,
    search: window.location.search,
    hash: window.location.hash,
    refreshToken,
  };
}

function emit(): void {
  snapshot = readLocation();
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot(): LocationSnapshot {
  return snapshot;
}

/** Converte um href da aplicação ("/projects/1") em URL do navegador. */
export function toBrowserUrl(href: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) return href;
  if (href.startsWith("?") || href.startsWith("#")) {
    return `${window.location.pathname}${href}`;
  }
  if (!href.startsWith("/")) {
    const base = new URL(window.location.href);
    return new URL(href, base).pathname + new URL(href, base).search + new URL(href, base).hash;
  }
  return `${basePath}${href}`;
}

export function isExternal(href: string): boolean {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//")) return false;
  try {
    return new URL(href, window.location.href).origin !== window.location.origin;
  } catch {
    return true;
  }
}

export function navigate(
  href: string,
  options: { replace?: boolean; scroll?: boolean } = {},
): void {
  if (isExternal(href)) {
    window.location.assign(href);
    return;
  }
  const url = toBrowserUrl(href);
  if (options.replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  emit();
  if (options.scroll !== false && !url.includes("#")) window.scrollTo(0, 0);
}

export function refresh(): void {
  refreshToken += 1;
  emit();
}

let pendingRefresh: ReturnType<typeof setTimeout> | null = null;

/** Agrupa várias revalidações da mesma ação num único refresh. */
export function scheduleRefresh(): void {
  if (pendingRefresh) return;
  pendingRefresh = setTimeout(() => {
    pendingRefresh = null;
    refresh();
  }, 0);
}

window.addEventListener("popstate", emit);
