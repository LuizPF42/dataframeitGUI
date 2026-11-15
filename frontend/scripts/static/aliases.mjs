// Trocas de módulo que definem o modo estático. É a única lista: o build do
// site (Vite), a análise de quais actions precisam da service role e o bundle
// da Edge Function leem daqui, para que os três vejam o mesmo grafo.
//
// Chave: especificador importado pela aplicação. Valor: caminho relativo a
// `frontend/`. `target` diz em qual runtime a troca vale.

/** Trocas comuns ao navegador e à Edge Function. */
const SHARED_ALIASES = {
  "@/lib/runtime-mode": "src/static/runtime-mode.ts",
  "next/navigation": "src/static/shims/next-navigation.ts",
  "next/cache": "src/static/shims/next-cache.ts",
  "next/headers": "src/static/shims/next-headers.ts",
  "next/server": "src/static/shims/next-server.ts",
  "next/link": "src/static/shims/next-link.tsx",
  "next/dynamic": "src/static/shims/next-dynamic.tsx",
  "server-only": "src/static/shims/server-only.ts",
  "@clerk/nextjs": "src/static/shims/clerk.ts",
  "@clerk/nextjs/server": "src/static/shims/clerk.ts",
  "@clerk/nextjs/errors": "src/static/shims/clerk.ts",
  "@clerk/localizations": "src/static/shims/clerk.ts",
};

/** Navegador: identidade da sessão do Supabase Auth, sem service role. */
export const BROWSER_ALIASES = {
  ...SHARED_ALIASES,
  "@/lib/identity/server": "src/static/identity/server.ts",
  "@/lib/identity/client": "src/static/identity/client.ts",
  "@/lib/supabase/server": "src/static/supabase/server.ts",
  "@/lib/supabase/admin": "src/static/supabase/admin.ts",
  "@/lib/identity/access-rows": "src/static/identity/access-rows.ts",
  "@/lib/api": "src/static/llm/api.ts",
  "@/lib/api-server": "src/static/llm/api-server.ts",
};

/** Edge Function: identidade do JWT da requisição; service role real. */
export const EDGE_ALIASES = {
  ...SHARED_ALIASES,
  "@/lib/identity/server": "src/static/edge/identity-server.ts",
  "@/lib/supabase/server": "src/static/edge/supabase-server.ts",
  "@/lib/supabase/admin": "src/static/edge/supabase-admin.ts",
  "@/lib/api-server": "src/static/edge/api-server.ts",
  "@/lib/clerk-sync": "src/static/edge/clerk-sync-native.ts",
  "next/navigation": "src/static/edge/next-navigation.ts",
  "next/cache": "src/static/edge/next-cache.ts",
  "next/server": "src/static/edge/next-server.ts",
  "next/headers": "src/static/edge/next-headers.ts",
};

/** Para a análise: tudo como no navegador, menos o admin, que fica real. */
export const ANALYSIS_ALIASES = Object.fromEntries(
  Object.entries(BROWSER_ALIASES).filter(([key]) => key !== "@/lib/supabase/admin"),
);
