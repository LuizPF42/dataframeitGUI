// Erros de controle de fluxo equivalentes aos de `next/navigation`. O shim de
// `unstable_rethrow` e o roteador os reconhecem pela classe.

export class RedirectSignal extends Error {
  constructor(
    readonly href: string,
    readonly mode: "replace" | "push" = "replace",
  ) {
    super(`NEXT_REDIRECT: ${href}`);
    this.name = "RedirectSignal";
  }
}

export class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundSignal";
  }
}

export function isControlFlowSignal(error: unknown): error is RedirectSignal | NotFoundSignal {
  return error instanceof RedirectSignal || error instanceof NotFoundSignal;
}
