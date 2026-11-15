// `server-only` no modo estático. No Next o pacote impede que um módulo de
// servidor entre no bundle do cliente. Aqui a fronteira equivalente é outra: o
// que precisa de segredo (service role) roda na Edge Function, e o build do
// navegador falha se `src/lib/supabase/admin.ts` aparecer no grafo dele.
export {};
