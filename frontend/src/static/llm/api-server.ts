// `@/lib/api-server` no navegador: as actions que chamam o backend Python
// (limpeza de rodadas paradas, recuperação de campos do código Pydantic)
// rodam no navegador e usam o mesmo despacho dos componentes.
import { fetchFastAPI } from "@/static/llm/api";

export async function fetchFastAPIServer<T>(path: string, options?: RequestInit): Promise<T> {
  return fetchFastAPI<T>(path, options);
}
