// Substituto de `cache` do React para o modo estático. No servidor, `cache()`
// deduplica por request a identidade e o contexto de acesso que layouts e
// pages pedem várias vezes. No navegador o `cache` do React não memoriza nada,
// e cada layout repetiria as mesmas consultas. Aqui a "request" é uma
// resolução de rota: o roteador abre uma época a cada navegação ou refresh, e
// toda revalidação a encerra. Entradas também expiram por tempo, para que uma
// ação disparada muito depois do carregamento não use identidade velha.

const TTL_MS = 30_000;

let epoch = 0;
const caches = new Set<Map<string, { epoch: number; at: number; value: unknown }>>();

export function invalidateRequestCache(): void {
  epoch += 1;
  for (const map of caches) map.clear();
}

/** Abre uma nova época (chamado pelo roteador antes de resolver a rota). */
export function beginRequest(): void {
  invalidateRequestCache();
}

function keyOf(args: unknown[]): string | null {
  try {
    return JSON.stringify(args);
  } catch {
    return null;
  }
}

export function cache<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const map = new Map<string, { epoch: number; at: number; value: unknown }>();
  caches.add(map);
  return (...args: A): R => {
    const key = keyOf(args);
    if (key === null) return fn(...args);
    const hit = map.get(key);
    const now = Date.now();
    if (hit && hit.epoch === epoch && now - hit.at < TTL_MS) return hit.value as R;
    const value = fn(...args);
    map.set(key, { epoch, at: now, value });
    if (value instanceof Promise) {
      // Falha não fica memorizada: a próxima chamada tenta de novo.
      value.catch(() => {
        if (map.get(key)?.value === value) map.delete(key);
      });
    }
    return value;
  };
}
