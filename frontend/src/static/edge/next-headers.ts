// `next/headers` na Edge Function. Nenhuma action privilegiada depende de
// cabeçalho ou cookie; o shim só evita que um import quebre o bundle.
export async function headers(): Promise<Headers> {
  return new Headers();
}

export async function cookies() {
  return {
    get: (_name: string) => undefined,
    getAll: () => [],
    has: (_name: string) => false,
  };
}
