// Tabela de rotas do modo estático, derivada da mesma árvore `src/app` do
// modo hospedado. Cada `page.tsx` vira uma rota; os `layout.tsx`, `loading.tsx`
// e `error.tsx` dos diretórios ancestrais compõem a cadeia, como no App Router.
//
// Ficam de fora: `app/layout.tsx` (o shell raiz do modo estático é
// `StaticRoot`), `app/auth/**` (login do Clerk; o modo estático tem a sua
// tela) e `app/api/**` (route handlers não existem num site estático).

import type { ComponentType, ReactNode } from "react";

type Loader<T = unknown> = () => Promise<{ default: T }>;
export type ServerComponent = (props: Record<string, unknown>) => ReactNode | Promise<ReactNode>;

// Os padrões negativos tiram do bundle o que o modo estático substitui.
const pages = import.meta.glob<{ default: ServerComponent }>([
  "../../app/**/page.tsx",
  "!../../app/auth/**",
  "!../../app/api/**",
]);
const layouts = import.meta.glob<{ default: ServerComponent }>([
  "../../app/**/layout.tsx",
  "!../../app/layout.tsx",
  "!../../app/auth/**",
  "!../../app/api/**",
]);
const loadings = import.meta.glob<{ default: ComponentType }>([
  "../../app/**/loading.tsx",
  "!../../app/auth/**",
]);
const errors = import.meta.glob<{
  default: ComponentType<{ error: Error; reset: () => void }>;
}>(["../../app/**/error.tsx", "!../../app/auth/**"]);

const APP_PREFIX = "../../app";
const EXCLUDED_DIRS = ["/auth", "/api"];

export interface RouteDefinition {
  /** Diretório relativo a `src/app`, ex.: "/(app)/projects/[id]/code". */
  dir: string;
  segments: Segment[];
  page: Loader<ServerComponent>;
  /** Do mais externo ao mais interno, excluindo o layout raiz. */
  layouts: { dir: string; load: Loader<ServerComponent> }[];
  loading: Loader<ComponentType> | null;
  error: Loader<ComponentType<{ error: Error; reset: () => void }>> | null;
}

type Segment =
  | { kind: "static"; value: string }
  | { kind: "dynamic"; name: string }
  | { kind: "catchAll"; name: string; optional: boolean };

function dirOf(key: string, file: string): string {
  return key.slice(APP_PREFIX.length, key.length - file.length - 1) || "";
}

function parseSegments(dir: string): Segment[] {
  return dir
    .split("/")
    .filter(Boolean)
    .filter((part) => !(part.startsWith("(") && part.endsWith(")")))
    .map((part): Segment => {
      const optionalCatchAll = /^\[\[\.\.\.(.+)\]\]$/.exec(part);
      if (optionalCatchAll) return { kind: "catchAll", name: optionalCatchAll[1], optional: true };
      const catchAll = /^\[\.\.\.(.+)\]$/.exec(part);
      if (catchAll) return { kind: "catchAll", name: catchAll[1], optional: false };
      const dynamic = /^\[(.+)\]$/.exec(part);
      if (dynamic) return { kind: "dynamic", name: dynamic[1] };
      return { kind: "static", value: part };
    });
}

function ancestors(dir: string): string[] {
  const parts = dir.split("/").filter(Boolean);
  const result: string[] = [];
  for (let i = 1; i <= parts.length; i++) result.push("/" + parts.slice(0, i).join("/"));
  return result;
}

function nearest<T>(map: Record<string, T>, file: string, dir: string): T | null {
  const chain = ancestors(dir).reverse();
  for (const candidate of chain) {
    const hit = map[`${APP_PREFIX}${candidate}/${file}`];
    if (hit) return hit;
  }
  return null;
}

function specificity(route: RouteDefinition): number[] {
  // Estático antes de dinâmico antes de catch-all, segmento a segmento.
  return route.segments.map((s) => (s.kind === "static" ? 0 : s.kind === "dynamic" ? 1 : 2));
}

export const routes: RouteDefinition[] = Object.entries(pages)
  .map(([key, page]) => ({ key, page, dir: dirOf(key, "page.tsx") }))
  .filter(({ dir }) => !EXCLUDED_DIRS.some((excluded) => dir === excluded || dir.startsWith(excluded + "/")))
  .map(({ dir, page }) => ({
    dir,
    segments: parseSegments(dir),
    page,
    layouts: ancestors(dir)
      .map((ancestor) => ({ dir: ancestor, load: layouts[`${APP_PREFIX}${ancestor}/layout.tsx`] }))
      .filter((entry): entry is { dir: string; load: Loader<ServerComponent> } => Boolean(entry.load)),
    loading: nearest(loadings, "loading.tsx", dir),
    error: nearest(errors, "error.tsx", dir),
  }))
  .sort((a, b) => {
    const sa = specificity(a);
    const sb = specificity(b);
    for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
      if (sa[i] !== sb[i]) return sa[i] - sb[i];
    }
    return sb.length - sa.length;
  });

export interface RouteMatch {
  route: RouteDefinition;
  params: Record<string, string | string[]>;
}

export function matchRoute(pathname: string, table: RouteDefinition[] = routes): RouteMatch | null {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  for (const route of table) {
    const params: Record<string, string | string[]> = {};
    let ok = true;
    let i = 0;
    for (const segment of route.segments) {
      if (segment.kind === "catchAll") {
        const rest = parts.slice(i);
        if (!segment.optional && rest.length === 0) ok = false;
        else if (rest.length > 0) params[segment.name] = rest;
        i = parts.length;
        break;
      }
      const part = parts[i];
      if (part === undefined) { ok = false; break; }
      if (segment.kind === "static" && segment.value !== part) { ok = false; break; }
      if (segment.kind === "dynamic") params[segment.name] = part;
      i++;
    }
    if (ok && i === parts.length) return { route, params };
  }
  return null;
}
