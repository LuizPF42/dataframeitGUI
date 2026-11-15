// `next/server` na Edge Function: `after` vira trabalho mantido vivo depois da
// resposta (`EdgeRuntime.waitUntil`), como o Next faz após a Server Action.
import { currentContext } from "@/static/edge/context";

export function after(task: Promise<unknown> | (() => unknown)): void {
  const promise = Promise.resolve()
    .then(() => (typeof task === "function" ? task() : task))
    .catch((error: unknown) => console.error("[after] tarefa falhou", error));
  currentContext().background.push(promise);
}
