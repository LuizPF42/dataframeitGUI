// Operações internas da Edge Function, sem equivalente em `src/actions`.
//
// No modo hospedado o dreno da fila de auto-revisão fica atrás de um segredo
// compartilhado entre o FastAPI e o Next. No modo estático quem o acorda é o
// worker do LLM, no navegador do coordenador, depois de publicar respostas.
// Por isso o dreno exige coordenador (ou master) de algum projeto e não
// devolve as contagens, que somam todos os projetos da instância.

import { drainAutoReviewReconciliationRequests } from "@/lib/auto-review-reconciler";
import { createSupabaseServer } from "@/static/edge/supabase-server";

export async function drainAutoReviewReconciliation(): Promise<null> {
  const supabase = await createSupabaseServer();
  const [coordinated, master] = await Promise.all([
    supabase.rpc("auth_user_coordinator_or_creator_project_ids"),
    supabase.rpc("is_master"),
  ]);
  const ids = (coordinated.data ?? []) as unknown[];
  if (coordinated.error || master.error || (ids.length === 0 && master.data !== true)) {
    throw new Error("Somente coordenadores acordam a reconciliação da auto-revisão.");
  }
  await drainAutoReviewReconciliationRequests();
  return null;
}
