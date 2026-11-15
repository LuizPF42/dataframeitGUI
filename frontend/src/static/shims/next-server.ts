// `next/server` no navegador: só `after` é usado fora dos route handlers. Sem
// resposta HTTP para esperar, o trabalho roda logo depois da tarefa atual e
// a falha é registrada, como o Next faz.

export function after(task: Promise<unknown> | (() => unknown)): void {
  setTimeout(() => {
    Promise.resolve()
      .then(() => (typeof task === "function" ? task() : task))
      .catch((error: unknown) => console.error("[after] tarefa falhou", error));
  }, 0);
}
