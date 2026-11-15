// `next/headers` no modo estático. Só dois usos na aplicação: `x-pathname`
// (deep-link da conclusão de acesso) e o cookie da divisão de tela da
// Comparação. Ambos têm equivalente direto no navegador.

import { getSnapshot } from "@/static/runtime/navigation";

export async function headers(): Promise<Headers> {
  const { pathname, search } = getSnapshot();
  return new Headers({ "x-pathname": `${pathname}${search}` });
}

interface CookieValue {
  name: string;
  value: string;
}

function parseCookies(): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of document.cookie.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name) map.set(name, decodeURIComponent(part.slice(index + 1).trim()));
  }
  return map;
}

export async function cookies() {
  const jar = parseCookies();
  return {
    get(name: string): CookieValue | undefined {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll(): CookieValue[] {
      return [...jar.entries()].map(([name, value]) => ({ name, value }));
    },
    has(name: string): boolean {
      return jar.has(name);
    },
  };
}
