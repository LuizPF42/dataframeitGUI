// `next/navigation` na Edge Function: só a parte de servidor (sinais de
// controle de fluxo). O shim do navegador (`shims/next-navigation.ts`) lê
// `window.location` e `import.meta.env` ao carregar, o que derruba o Deno na
// inicialização; os hooks dele também não têm sentido numa action. Uma action
// privilegiada que importar um hook passa a falhar no build ("No matching
// export"), e não em produção.
import {
  isControlFlowSignal,
  NotFoundSignal,
  RedirectSignal,
} from "@/static/runtime/control-flow";

export function redirect(href: string): never {
  throw new RedirectSignal(href, "replace");
}

export function permanentRedirect(href: string): never {
  throw new RedirectSignal(href, "replace");
}

export function notFound(): never {
  throw new NotFoundSignal();
}

export function unstable_rethrow(error: unknown): void {
  if (isControlFlowSignal(error)) throw error;
}
