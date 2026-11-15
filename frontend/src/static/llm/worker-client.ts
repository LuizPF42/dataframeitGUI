// Lado da página do backend Python no navegador. Mantém dois workers Pyodide:
// um para rodadas do LLM (longas, uma por vez) e outro para as chamadas curtas
// (prévia do prompt, limpeza de rodadas paradas, recuperação de campos), para
// que estas não esperem uma rodada terminar.

import type { BackendResult } from "@/static/llm/backend";
import {
  allKnownKeys,
  ensureProviderKey,
  isProviderId,
  PROVIDER_LABELS,
} from "@/static/llm/key-store";
import {
  dataframeitRequirement,
  PYODIDE_INDEX_URL,
  PYODIDE_PACKAGES,
  PYPI_PACKAGES,
} from "@/static/llm/packages";
import type { FromWorker, ToWorker } from "@/static/llm/protocol";
import { finishJob, hasRunningJob, jobs, markJobRunning, setLoadingMessage, updateJob } from "@/static/llm/job-state";
import { readConnection } from "@/static/runtime/connection";
import { getAccessToken, getSupabase } from "@/static/runtime/supabase";
import supabaseShim from "@/static/llm/python/supabase_shim.py?raw";
import staticBackend from "@/static/llm/python/static_backend.py?raw";

const backendSources = import.meta.glob<string>(
  [
    "../../../../backend/services/__init__.py",
    "../../../../backend/services/llm_runner.py",
    "../../../../backend/services/pydantic_compiler.py",
    "../../../../backend/services/condition_evaluator.py",
  ],
  { query: "?raw", import: "default", eager: true },
);

function pythonFiles(): Record<string, string> {
  const files: Record<string, string> = {
    "/app/supabase_shim.py": supabaseShim,
    "/app/static_backend.py": staticBackend,
  };
  for (const [key, content] of Object.entries(backendSources)) {
    files[`/app/services/${key.slice(key.lastIndexOf("/") + 1)}`] = content;
  }
  return files;
}

// ---------------------------------------------------------------- workers
type Role = "job" | "utility";

interface Handle {
  worker: Worker;
  ready: Promise<void>;
  nextId: number;
  pending: Map<number, (result: BackendResult) => void>;
}

const handles = new Map<Role, Handle>();
let authSubscribed = false;

function broadcastToken(token: string | null) {
  for (const handle of handles.values()) handle.worker.postMessage({ type: "token", token } satisfies ToWorker);
}

function subscribeAuth() {
  if (authSubscribed) return;
  authSubscribed = true;
  getSupabase().auth.onAuthStateChange((_event, session) => broadcastToken(session?.access_token ?? null));
}

function spawn(role: Role): Handle {
  const existing = handles.get(role);
  if (existing) return existing;
  const connection = readConnection();
  if (!connection) throw new Error("Navegador sem conexão com a nuvem do grupo.");
  const worker = new Worker(new URL("./pyodide-worker.ts", import.meta.url), {
    type: "module",
    name: `dataframeit-python-${role}`,
  });
  const handle: Handle = { worker, ready: Promise.resolve(), nextId: 1, pending: new Map() };
  handle.ready = new Promise((resolve, reject) => {
    worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === "ready") resolve();
      else if (message.type === "init-failed") {
        handles.delete(role);
        reject(new Error(`Não foi possível carregar o Python do navegador: ${message.error}`));
      } else if (message.type === "loading") setLoadingMessage(message.message);
      else if (message.type === "result") {
        const settle = handle.pending.get(message.id);
        handle.pending.delete(message.id);
        settle?.(message.ok ? { ok: true, data: message.data } : { ok: false, status: message.status, detail: message.detail });
      } else if (message.type === "status") updateJob(message.jobId, message.state);
      else if (message.type === "job-finished") finishJob(message.jobId, message.error);
    });
  });
  handles.set(role, handle);
  subscribeAuth();
  const init: ToWorker = {
    type: "init",
    indexURL: PYODIDE_INDEX_URL,
    pyodidePackages: PYODIDE_PACKAGES,
    pypiPackages: PYPI_PACKAGES,
    dataframeitRequirement: dataframeitRequirement(new URL(import.meta.env.BASE_URL, window.location.origin).toString()),
    files: pythonFiles(),
    supabaseUrl: connection.url,
    anonKey: connection.anonKey,
  };
  worker.postMessage(init);
  void handle.ready.finally(() => setLoadingMessage(null)).catch(() => {});
  return handle;
}

async function callWorker(role: Role, name: string, payload: unknown): Promise<BackendResult> {
  const handle = spawn(role);
  try {
    await handle.ready;
  } catch (error) {
    return { ok: false, status: 503, detail: error instanceof Error ? error.message : String(error) };
  }
  handle.worker.postMessage({ type: "token", token: await getAccessToken() } satisfies ToWorker);
  const id = handle.nextId++;
  return new Promise((resolve) => {
    handle.pending.set(id, resolve);
    handle.worker.postMessage({ type: "call", id, name, payload } satisfies ToWorker);
  });
}

// ------------------------------------------------------------ estado dos jobs
const STATUS_KEYS = [
  "status",
  "phase",
  "progress",
  "total",
  "errors",
  "eta_seconds",
  "current_batch",
  "total_batches",
  "error_traceback",
  "error_type",
  "error_line",
  "error_column",
  "pydantic_code",
  "processed_complete",
  "processed_partial",
  "processed_empty",
] as const;

function statusFromState(state: Record<string, unknown>) {
  const result: Record<string, unknown> = {};
  for (const key of STATUS_KEYS) result[key] = state[key] ?? null;
  result.errors = Array.isArray(state.errors) ? state.errors : [];
  for (const key of ["progress", "total", "current_batch", "total_batches", "processed_complete", "processed_partial", "processed_empty"]) {
    result[key] = typeof state[key] === "number" ? state[key] : 0;
  }
  return result;
}

/** Mesmo formato de `_status_from_row` (llm_runner.py), para rodadas de outra aba. */
function statusFromRow(row: Record<string, unknown>) {
  return {
    status: row.status ?? "error",
    phase: row.phase ?? "error",
    progress: row.progress ?? 0,
    total: row.total ?? 0,
    errors: row.error_message ? [row.error_message] : [],
    eta_seconds: null,
    current_batch: 0,
    total_batches: 0,
    error_traceback: row.error_traceback ?? null,
    error_type: row.error_type ?? null,
    error_line: row.error_line ?? null,
    error_column: row.error_column ?? null,
    pydantic_code: row.pydantic_code ?? null,
    processed_complete: row.processed_complete ?? 0,
    processed_partial: row.processed_partial ?? 0,
    processed_empty: row.processed_empty ?? 0,
  };
}

async function jobStatus(jobId: string): Promise<BackendResult> {
  const view = jobs.get(jobId);
  if (view) return { ok: true, data: statusFromState(view.state) };
  const { data, error } = await getSupabase()
    .from("llm_runs")
    .select(
      "status, phase, progress, total, error_message, error_type, error_traceback, error_line, error_column, pydantic_code, processed_complete, processed_partial, processed_empty",
    )
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, detail: error.message };
  if (!data) {
    return { ok: true, data: { ...statusFromRow({}), errors: ["Job not found"] } };
  }
  return { ok: true, data: statusFromRow(data as Record<string, unknown>) };
}

// ---------------------------------------------------------------- rodadas
function supportsJspi(): boolean {
  return typeof (WebAssembly as unknown as { Suspending?: unknown }).Suspending === "function";
}

async function startRun(kind: "run" | "run-field", payload: Record<string, unknown>): Promise<BackendResult> {
  if (!supportsJspi()) {
    return {
      ok: false,
      status: 400,
      detail:
        "Rodar o LLM no navegador exige um navegador com JSPI (Chrome ou Edge recentes). " +
        "Abra esta página num deles para executar.",
    };
  }
  if (hasRunningJob()) {
    return { ok: false, status: 409, detail: "Já há uma execução do LLM rodando nesta aba." };
  }
  const projectId = payload.project_id;
  if (typeof projectId !== "string") return { ok: false, status: 422, detail: "project_id inválido" };
  const { data: project, error } = await getSupabase()
    .from("projects")
    .select("llm_provider")
    .eq("id", projectId)
    .maybeSingle();
  if (error) return { ok: false, status: 500, detail: error.message };
  const provider = (project as { llm_provider?: string } | null)?.llm_provider;
  if (!isProviderId(provider)) {
    return { ok: false, status: 400, detail: "Escolha provedor e modelo em LLM > Configurar e salve antes de rodar." };
  }
  const key = await ensureProviderKey(provider);
  if (!key) {
    return { ok: false, status: 400, detail: `Informe a chave de API de ${PROVIDER_LABELS[provider]} para rodar o LLM.` };
  }

  const handle = spawn("job");
  handle.worker.postMessage({ type: "keys", keys: allKnownKeys() } satisfies ToWorker);
  const started = await callWorker("job", kind === "run" ? "start_run" : "start_run_field", payload);
  if (!started.ok) return started;
  const jobId = (started.data as { job_id: string }).job_id;
  markJobRunning(jobId);
  handle.worker.postMessage({ type: "run", id: handle.nextId++, kind, jobId, payload } satisfies ToWorker);
  return { ok: true, data: { job_id: jobId } };
}

/** Despacho das rotas do backend Python (mesmos caminhos do FastAPI). */
export async function callBackend(method: string, path: string, body: unknown): Promise<BackendResult> {
  const route = path.replace(/^\/api/, "");
  const payload = (body ?? {}) as Record<string, unknown>;
  if (method === "POST" && route === "/llm/run") return startRun("run", payload);
  if (method === "POST" && route === "/llm/run-field") return startRun("run-field", payload);
  const status = /^\/llm\/status\/([0-9a-f-]{36})$/i.exec(route);
  if (method === "GET" && status) return jobStatus(status[1]);
  if (method === "POST" && route === "/llm/preview-prompt") return callWorker("utility", "preview_prompt", payload);
  if (method === "POST" && route === "/llm/cleanup-stale") return callWorker("utility", "cleanup_stale", payload);
  if (method === "POST" && route === "/pydantic/recover-fields") return callWorker("utility", "recover_fields", payload);
  if (method === "GET" && route === "/health") return { ok: true, data: { status: "ok" } };
  return { ok: false, status: 404, detail: `Rota ${route} não existe no modo estático.` };
}
