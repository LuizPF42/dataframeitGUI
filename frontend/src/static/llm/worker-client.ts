import type { BackendResult } from "@/static/llm/backend";

export async function callBackend(_method: string, path: string, _body: unknown): Promise<BackendResult> {
  return { ok: false, status: 503, detail: `Rota ${path} ainda não disponível no navegador.` };
}
