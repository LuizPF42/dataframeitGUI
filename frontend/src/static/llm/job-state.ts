// Estado das rodadas do LLM no navegador, separado do cliente dos workers
// para que a interface (faixa de aviso) não carregue o Pyodide nem o código
// Python só para saber se há rodada em andamento.

export interface JobView {
  state: Record<string, unknown>;
  running: boolean;
}

export const jobs = new Map<string, JobView>();
const listeners = new Set<() => void>();
let loadingMessage: string | null = null;

function emit() {
  for (const listener of listeners) listener();
}

export function setLoadingMessage(message: string | null) {
  loadingMessage = message;
  emit();
}

export function updateJob(jobId: string, state: Record<string, unknown>) {
  const running = state.status === "running";
  jobs.set(jobId, { state, running });
  emit();
}

export function finishJob(jobId: string, error?: string) {
  const view = jobs.get(jobId);
  const state = { ...(view?.state ?? {}) };
  if (error && state.status === "running") {
    state.status = "error";
    state.phase = "error";
    state.errors = [...((state.errors as string[] | undefined) ?? []), error];
  }
  jobs.set(jobId, { state, running: false });
  emit();
}

export function subscribeLlmJobs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hasRunningJob(): boolean {
  for (const view of jobs.values()) if (view.running) return true;
  return false;
}

export function currentLoadingMessage(): string | null {
  return loadingMessage;
}

export function markJobRunning(jobId: string) {
  const current = jobs.get(jobId);
  jobs.set(jobId, {
    state: current?.state ?? { status: "running", phase: "loading", progress: 0, total: 0, errors: [] },
    running: true,
  });
  emit();
}
