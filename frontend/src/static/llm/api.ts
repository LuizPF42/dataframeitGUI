// `@/lib/api` no modo estático. Os componentes continuam chamando as mesmas
// rotas do backend Python (`/llm/run`, `/llm/status/{id}`, …); aqui elas são
// atendidas pelo backend que roda no próprio navegador, num Web Worker com
// Pyodide (`./backend`). Não há servidor: a chave de LLM é do coordenador e a
// escrita no banco sai com o JWT dele.

import { dispatchBackendRequest } from "@/static/llm/backend";

class MissingAuthTokenError extends Error {
  constructor() {
    super("Sessão indisponível. Faça login novamente.");
    this.name = "MissingAuthTokenError";
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type GetToken = () => Promise<string | null>;

export async function requireSupabaseToken(getToken: GetToken): Promise<string> {
  const token = await getToken();
  if (!token) throw new MissingAuthTokenError();
  return token;
}

export async function fetchFastAPI<T>(
  path: string,
  options?: RequestInit,
  _token?: string,
): Promise<T> {
  const body = typeof options?.body === "string" ? (JSON.parse(options.body) as unknown) : undefined;
  const result = await dispatchBackendRequest(options?.method ?? "GET", path, body);
  if (!result.ok) throw new ApiError(result.detail, result.status);
  return result.data as T;
}

/** Sem API remota para acordar; o Pyodide carrega sob demanda. */
export function warmUpApi(): void {}
