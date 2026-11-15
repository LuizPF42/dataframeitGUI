// Despacho das rotas do backend Python para o worker Pyodide. Implementação
// completa em `./worker-client.ts`; este módulo é a fronteira estável usada
// por `api.ts`.

export type BackendResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; detail: string };

export async function dispatchBackendRequest(
  method: string,
  path: string,
  body: unknown,
): Promise<BackendResult> {
  const { callBackend } = await import("@/static/llm/worker-client");
  return callBackend(method, path, body);
}
