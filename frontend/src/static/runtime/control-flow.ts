// Erros de controle de fluxo equivalentes aos de `next/navigation`. O Next
// marca os seus com `digest`; os helpers da aplicação que deixam esses erros
// passar (`unstable_rethrow`) reconhecem os daqui pelo mesmo critério.

export class RedirectSignal extends Error {
  readonly digest = "NEXT_REDIRECT";
  constructor(
    readonly href: string,
    readonly mode: "replace" | "push" = "replace",
  ) {
    super(`NEXT_REDIRECT: ${href}`);
    this.name = "RedirectSignal";
  }
}

export class NotFoundSignal extends Error {
  readonly digest = "NEXT_HTTP_ERROR_FALLBACK;404";
  constructor() {
    super("NEXT_NOT_FOUND");
    this.name = "NotFoundSignal";
  }
}

export function isControlFlowSignal(error: unknown): error is RedirectSignal | NotFoundSignal {
  return error instanceof RedirectSignal || error instanceof NotFoundSignal;
}
