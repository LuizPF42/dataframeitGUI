// Worker do backend Python do modo estático. Carrega o Pyodide sob demanda,
// instala o ambiente fixado em `packages.ts`, copia `backend/services` para o
// sistema de arquivos e atende as chamadas de `worker-client.ts`.

import type { FromWorker, ToWorker, WorkerInit } from "@/static/llm/protocol";

// Sem `lib: webworker` (ele trocaria os tipos globais do projeto inteiro): só
// o que o worker usa do escopo global.
const scope = globalThis as unknown as {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent<ToWorker>) => void): void;
};

interface PyProxyFn {
  (...args: unknown[]): unknown;
  callPromising?: (...args: unknown[]) => Promise<unknown>;
}

interface Pyodide {
  loadPackage(names: string[], options?: { messageCallback?: (message: string) => void }): Promise<void>;
  runPythonAsync(code: string): Promise<unknown>;
  runPython(code: string): unknown;
  pyimport(name: string): Record<string, PyProxyFn>;
  registerJsModule(name: string, module: object): void;
  FS: { mkdirTree(path: string): void; writeFile(path: string, data: string): void };
}

let token: string | null = null;
let backend: Record<string, PyProxyFn> | null = null;
let ready: Promise<void> | null = null;

function post(message: FromWorker) {
  scope.postMessage(message);
}

async function initialize(init: WorkerInit): Promise<void> {
  post({ type: "loading", message: "Carregando o Python do navegador…" });
  const { loadPyodide } = (await import(/* @vite-ignore */ `${init.indexURL}pyodide.mjs`)) as {
    loadPyodide(options: { indexURL: string }): Promise<Pyodide>;
  };
  const py = await loadPyodide({ indexURL: init.indexURL });

  post({ type: "loading", message: "Instalando o dataframeit e os provedores de LLM…" });
  await py.loadPackage(init.pyodidePackages, { messageCallback: () => {} });
  const micropip = py.pyimport("micropip");
  for (const spec of [...init.pypiPackages, init.dataframeitRequirement]) {
    const install = micropip.install as PyProxyFn & {
      callKwargs(spec: string, kwargs: Record<string, unknown>): Promise<unknown>;
    };
    await install.callKwargs(spec, { deps: false });
  }

  for (const [path, content] of Object.entries(init.files)) {
    py.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
    py.FS.writeFile(path, content);
  }
  py.registerJsModule("static_bridge", {
    token: () => token,
    status: (jobId: string, json: string) =>
      post({ type: "status", jobId, state: JSON.parse(json) as Record<string, unknown> }),
  });
  py.runPython(`import sys; sys.path.insert(0, "/app")`);
  backend = py.pyimport("static_backend");
  (backend.configure as PyProxyFn)(init.supabaseUrl, init.anonKey);
}

async function handle(message: ToWorker): Promise<void> {
  if (message.type === "init") {
    ready = initialize(message).then(
      () => post({ type: "ready" }),
      (error: unknown) => {
        post({ type: "init-failed", error: error instanceof Error ? error.message : String(error) });
        throw error;
      },
    );
    return;
  }
  if (message.type === "token") {
    token = message.token;
    return;
  }
  await ready;
  if (!backend) return;
  if (message.type === "keys") {
    (backend.set_provider_keys as PyProxyFn)(JSON.stringify(message.keys));
    return;
  }
  if (message.type === "call") {
    const raw = (backend.call as PyProxyFn)(message.name, JSON.stringify(message.payload ?? {})) as string;
    const parsed = JSON.parse(raw) as { ok: boolean; data?: unknown; status?: number; detail?: string };
    post(
      parsed.ok
        ? { type: "result", id: message.id, ok: true, data: parsed.data }
        : { type: "result", id: message.id, ok: false, status: parsed.status ?? 500, detail: parsed.detail ?? "Erro" },
    );
    return;
  }
  if (message.type === "run") {
    const runJob = backend.run_job as PyProxyFn;
    try {
      // `callPromising` entra no Python com JSPI: é o que permite ao runner
      // síncrono esperar o provedor de LLM por `run_sync` sem threads.
      if (!runJob.callPromising) throw new Error("Pyodide sem suporte a callPromising (JSPI).");
      await runJob.callPromising(message.kind, message.jobId, JSON.stringify(message.payload));
      post({ type: "job-finished", jobId: message.jobId });
    } catch (error) {
      post({
        type: "job-finished",
        jobId: message.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

scope.addEventListener("message", (event) => {
  void handle(event.data).catch((error: unknown) => console.error("[pyodide-worker]", error));
});
