// `next/navigation` no modo estático. Mesma superfície que a aplicação usa
// (useRouter, usePathname, useSearchParams, useParams, redirect, notFound,
// unstable_rethrow), servida pelo roteador próprio em `runtime/navigation`.

import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import {
  getSnapshot,
  navigate,
  refresh,
  subscribe,
} from "@/static/runtime/navigation";
import {
  isControlFlowSignal,
  NotFoundSignal,
  RedirectSignal,
} from "@/static/runtime/control-flow";

export const RouteParamsContext = createContext<Record<string, string | string[]>>({});

export interface AppRouterInstance {
  push(href: string, options?: { scroll?: boolean }): void;
  replace(href: string, options?: { scroll?: boolean }): void;
  refresh(): void;
  back(): void;
  forward(): void;
  prefetch(href: string): void;
}

const router: AppRouterInstance = {
  push: (href, options) => navigate(href, { scroll: options?.scroll }),
  replace: (href, options) => navigate(href, { replace: true, scroll: options?.scroll }),
  refresh: () => refresh(),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  prefetch: () => {},
};

function useLocationSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

export function useRouter(): AppRouterInstance {
  return router;
}

export function usePathname(): string {
  return useLocationSnapshot().pathname;
}

export function useSearchParams(): URLSearchParams {
  const { search } = useLocationSnapshot();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useParams<T extends Record<string, string | string[]>>(): T {
  return useContext(RouteParamsContext) as T;
}

export function redirect(href: string): never {
  throw new RedirectSignal(href, "replace");
}

export function permanentRedirect(href: string): never {
  throw new RedirectSignal(href, "replace");
}

export function notFound(): never {
  throw new NotFoundSignal();
}

export function unstable_rethrow(error: unknown): void {
  if (isControlFlowSignal(error)) throw error;
}

export type ReadonlyURLSearchParams = URLSearchParams;
