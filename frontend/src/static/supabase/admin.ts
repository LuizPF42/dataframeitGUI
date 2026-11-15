// `@/lib/supabase/admin` no navegador. A service role nunca chega ao bundle do
// site: as operações que precisam dela rodam na Edge Function `actions` do
// projeto Supabase do grupo (ver `src/static/actions`). Chegar aqui é defeito
// do build — um módulo privilegiado entrou no grafo do navegador — e falha alto.

export function createSupabaseAdmin(): never {
  throw new Error(
    "Operação privilegiada chamada no navegador. No modo estático ela deve " +
      "passar pela Edge Function `actions`.",
  );
}
