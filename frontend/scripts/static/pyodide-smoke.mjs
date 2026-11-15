// Fumaça do backend Python do modo estático, rodando no Pyodide (Node).
//
// Executa o caminho inteiro de "Rodar LLM" como no navegador: o `llm_runner`
// do backend, `static_backend.py`, o shim do Supabase, a ponte
// `run_sync` → `adataframeit` (JSPI) e o `langchain-openai` real — contra um
// servidor OpenAI simulado e um PostgREST falso em memória (o
// XMLHttpRequest síncrono do worker é trocado por um que responde daqui).
//
// Uso (fora do repositório, numa pasta com `npm i pyodide@314.0.7`):
//   node --experimental-wasm-jspi pyodide-smoke.mjs <wheel do dataframeit> [documentos] [paralelo]
//
// Sai com código 0 quando todas as asserções passam.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.cwd(), "noop.js"));
const { loadPyodide } = require("pyodide");

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, "../..");
const repo = path.resolve(frontend, "..");
const [wheelPath, docArg, parallelArg] = process.argv.slice(2);
if (!wheelPath) {
  console.error("uso: node --experimental-wasm-jspi pyodide-smoke.mjs <dataframeit.whl> [docs] [paralelo]");
  process.exit(2);
}
const DOCS = Number(docArg ?? 50);
const PARALLEL = Number(parallelArg ?? 5);

const { PYODIDE_PACKAGES, PYPI_PACKAGES } = await import(
  "data:text/javascript," +
    encodeURIComponent(
      readFileSync(path.join(frontend, "src/static/llm/packages.ts"), "utf8")
        .replace(/export function dataframeitRequirement[\s\S]*$/, "")
        .replace(/: string\b/g, ""),
    )
);

// ------------------------------------------------------- OpenAI simulado
let inFlight = 0;
let maxInFlight = 0;
let llmCalls = 0;
function fakeValue(schema) {
  if (schema?.enum) return schema.enum[0];
  if (schema?.anyOf) return fakeValue(schema.anyOf.find((s) => s.type !== "null") ?? {});
  switch (schema?.type) {
    case "boolean": return true;
    case "integer": case "number": return 1;
    case "array": return [];
    case "object": return {};
    default: return "valor simulado";
  }
}
function fakeObject(schema) {
  const out = {};
  for (const [name, prop] of Object.entries(schema?.properties ?? {})) out[name] = fakeValue(prop);
  return out;
}
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    inFlight += 1;
    llmCalls += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    const request = JSON.parse(body || "{}");
    setTimeout(() => {
      inFlight -= 1;
      const tool = request.tools?.[0]?.function;
      const schema = tool?.parameters ?? request.response_format?.json_schema?.schema;
      const args = JSON.stringify(fakeObject(schema));
      const message = tool
        ? { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: tool.name, arguments: args } }] }
        : { role: "assistant", content: args, refusal: null };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-smoke", object: "chat.completion", created: 0, model: request.model,
        choices: [{ index: 0, message, finish_reason: tool ? "tool_calls" : "stop", logprobs: null }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    }, 40);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const openaiBase = `http://127.0.0.1:${server.address().port}/v1`;

// ------------------------------------------------------- PostgREST falso
const PROJECT = "11111111-1111-4111-8111-111111111111";
const db = {
  project: {
    pydantic_code: 'from pydantic import BaseModel, Field\n\nclass Analysis(BaseModel):\n    campo_a: str = Field(description="Campo A")\n    campo_b: str = Field(description="Campo B")\n',
    prompt_template: "Analise o texto: {texto}",
    llm_provider: "openai",
    llm_model: "gpt-4o-mini",
    llm_kwargs: { parallel_requests: PARALLEL, rate_limit_delay: 0, include_justifications: false },
    description: "Projeto de fumaça",
    pydantic_fields: [],
    schema_version_major: 1, schema_version_minor: 0, schema_version_patch: 0,
    current_round_id: "22222222-2222-4222-8222-222222222222",
  },
  documents: Array.from({ length: DOCS }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    text: `Documento ${i + 1}`, title: `Doc ${i + 1}`, external_id: `d${i + 1}`,
  })),
  runs: new Map(),
  published: [],
  edgeCalls: 0,
  tokensSeen: new Set(),
};
const params = (url) => new URL(url).searchParams;
function route(method, url, body, headers) {
  db.tokensSeen.add(headers.authorization);
  const u = new URL(url);
  if (u.pathname === "/rest/v1/projects" && method === "GET") {
    return [200, headers.accept?.includes("object") ? db.project : [db.project]];
  }
  if (u.pathname === "/rest/v1/projects" && method === "PATCH") return [200, [db.project]];
  if (u.pathname === "/rest/v1/documents" && method === "GET") {
    const gt = params(url).get("id")?.replace(/^gt\./, "");
    const limit = Number(params(url).get("limit") ?? 1000);
    const rows = db.documents.filter((d) => !gt || d.id > gt).slice(0, limit);
    return [200, rows];
  }
  if (u.pathname === "/rest/v1/llm_runs" && method === "POST") {
    db.runs.set(body.job_id, { ...body });
    return [201, [body]];
  }
  if (u.pathname === "/rest/v1/llm_runs" && method === "PATCH") {
    const jobId = params(url).get("job_id")?.replace(/^eq\./, "");
    const row = db.runs.get(jobId);
    if (!row) return [200, []];
    Object.assign(row, body);
    return [200, [row]];
  }
  if (u.pathname === "/rest/v1/rpc/publish_llm_response_from_browser") {
    db.published.push(body.p_response);
    return [200, `00000000-0000-4000-9000-${String(db.published.length).padStart(12, "0")}`];
  }
  if (u.pathname === "/functions/v1/actions") {
    db.edgeCalls += 1;
    return [200, { ok: true, result: null, revalidated: false }];
  }
  return [404, { message: `rota falsa ausente: ${method} ${u.pathname}`, code: "PGRST000" }];
}
globalThis.XMLHttpRequest = class {
  static new() { return new this(); }
  constructor() { this.headers = {}; }
  open(method, url, async) {
    if (async !== false) throw new Error("o shim deve usar XHR síncrono");
    this.method = method; this.url = url;
  }
  setRequestHeader(k, v) { this.headers[k.toLowerCase()] = v; }
  getAllResponseHeaders() { return "content-type: application/json\r\n"; }
  send(body) {
    const [status, payload] = route(this.method, this.url, body ? JSON.parse(body) : null, this.headers);
    this.status = status;
    this.responseText = JSON.stringify(payload);
  }
};

// ------------------------------------------------------------ Pyodide
const started = Date.now();
const py = await loadPyodide();
await py.loadPackage(PYODIDE_PACKAGES, { messageCallback: () => {} });
const micropip = py.pyimport("micropip");
for (const spec of PYPI_PACKAGES) await micropip.install.callKwargs(spec, { deps: false });
const wheelName = path.basename(wheelPath);
py.FS.writeFile(`/tmp/${wheelName}`, readFileSync(wheelPath));
await micropip.install.callKwargs(`emfs:/tmp/${wheelName}`, { deps: false });
console.log(`ambiente pronto em ${((Date.now() - started) / 1000).toFixed(1)} s`);

const files = {
  "/app/supabase_shim.py": "src/static/llm/python/supabase_shim.py",
  "/app/static_backend.py": "src/static/llm/python/static_backend.py",
};
for (const name of ["__init__", "llm_runner", "pydantic_compiler", "condition_evaluator"]) {
  files[`/app/services/${name}.py`] = path.join(repo, "backend/services", `${name}.py`);
}
for (const [target, source] of Object.entries(files)) {
  py.FS.mkdirTree(target.slice(0, target.lastIndexOf("/")));
  py.FS.writeFile(target, readFileSync(path.isAbsolute(source) ? source : path.join(frontend, source), "utf8"));
}
const statuses = [];
py.registerJsModule("static_bridge", {
  token: () => "jwt-do-coordenador",
  status: (jobId, json) => statuses.push(JSON.parse(json)),
});
py.runPython(`import sys, os; sys.path.insert(0, "/app"); os.environ["OPENAI_BASE_URL"] = ${JSON.stringify(openaiBase)}`);
const backend = py.pyimport("static_backend");
backend.configure("http://supabase.falso", "chave-anon");
backend.set_provider_keys(JSON.stringify({ openai: "sk-simulada" }));

const startResult = JSON.parse(backend.call("start_run", JSON.stringify({ project_id: PROJECT, filter_mode: "all" })));
if (!startResult.ok) throw new Error(`start_run falhou: ${JSON.stringify(startResult)}`);
const jobId = startResult.data.job_id;

const runStarted = Date.now();
await backend.run_job.callPromising("run", jobId, JSON.stringify({ project_id: PROJECT, filter_mode: "all" }));
const seconds = (Date.now() - runStarted) / 1000;
server.close();

// ------------------------------------------------------------ asserções
const run = db.runs.get(jobId);
const last = statuses.at(-1) ?? {};
const checks = [
  ["rodada aberta em llm_runs", Boolean(run)],
  ["rodada concluída", run?.status === "completed"],
  ["status espelhado para o JS", last.status === "completed" && last.progress === DOCS],
  [`${DOCS} respostas publicadas pela RPC do navegador`, db.published.length === DOCS],
  ["respostas com os campos do schema", db.published.every((r) => r.answers?.campo_a === "valor simulado")],
  ["um documento por resposta", new Set(db.published.map((r) => r.document_id)).size === DOCS],
  [`paralelismo real (máx. em voo ${maxInFlight})`, PARALLEL === 1 ? maxInFlight === 1 : maxInFlight > 1 && maxInFlight <= PARALLEL],
  ["JWT do coordenador em toda chamada ao banco", db.tokensSeen.size === 1 && db.tokensSeen.has("Bearer jwt-do-coordenador")],
  ["reconciliação da auto-revisão acordada pela Edge Function", db.edgeCalls >= 1],
];
console.log(`rodada: ${DOCS} documentos, ${llmCalls} chamadas ao LLM, paralelo ${PARALLEL}, ${seconds.toFixed(1)} s`);
let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "OK  " : "FALHOU"} ${label}`);
  if (!ok) failed += 1;
}
if (run?.status !== "completed") console.log("llm_runs:", JSON.stringify(run, null, 1).slice(0, 3000));
process.exit(failed ? 1 : 0);
