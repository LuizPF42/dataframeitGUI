// Mensagens entre a página e o worker Pyodide.

export interface WorkerInit {
  type: "init";
  indexURL: string;
  pyodidePackages: string[];
  pypiPackages: string[];
  dataframeitRequirement: string;
  /** caminho no FS do Pyodide → conteúdo (backend/services e módulos do modo estático) */
  files: Record<string, string>;
  supabaseUrl: string;
  anonKey: string;
}

export type ToWorker =
  | WorkerInit
  | { type: "token"; token: string | null }
  | { type: "keys"; keys: Record<string, string> }
  | { type: "call"; id: number; name: string; payload: unknown }
  | { type: "run"; id: number; kind: "run" | "run-field"; jobId: string; payload: unknown };

export type FromWorker =
  | { type: "ready" }
  | { type: "init-failed"; error: string }
  | { type: "loading"; message: string }
  | { type: "result"; id: number; ok: true; data: unknown }
  | { type: "result"; id: number; ok: false; status: number; detail: string }
  | { type: "status"; jobId: string; state: Record<string, unknown> }
  | { type: "job-finished"; jobId: string; error?: string };
