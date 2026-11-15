// Empacota a Edge Function `actions` do modo estático num único arquivo ESM.
//
// Entrada gerada: importa cada módulo de `src/actions` que usa a service role
// (lista calculada por `privileged-actions.mjs`) e o dreno da fila de
// auto-revisão, e os registra no despacho de `src/static/edge/handler.ts`.
// As trocas de módulo são as de `EDGE_ALIASES` (`aliases.mjs`).
//
// Saída:
//   out/edge/actions/index.js                      — usado pelo assistente
//   out/edge/supabase/functions/actions/index.ts   — para `supabase functions deploy`

import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EDGE_ALIASES } from "./aliases.mjs";
import { findPrivilegedActions, sourceAliasPlugin } from "./privileged-actions.mjs";

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const srcDir = path.join(frontendDir, "src");
const defaultOutDir = path.join(frontendDir, "out/edge");

/** Actions do modo hospedado que não existem no estático (conclusão de acesso do Clerk). */
const NOT_SERVED = new Set(["complete-access"]);

const toPosix = (p) => p.split(path.sep).join("/");

const REACT_CACHE_IMPORT = /import\s*\{([^}]*)\}\s*from\s*"react";?/;

/** `cache` do React → memória por requisição (`src/static/edge/request-cache.ts`). */
const requestCachePlugin = {
  name: "edge-request-cache",
  setup(build) {
    build.onLoad({ filter: /[\\/]src[\\/].*\.tsx?$/ }, async (args) => {
      let contents = await readFile(args.path, "utf8");
      const match = REACT_CACHE_IMPORT.exec(contents);
      if (match && /\bcache\b/.test(match[1])) {
        const rest = match[1]
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name && name !== "cache");
        const replacement =
          (rest.length ? `import { ${rest.join(", ")} } from "react";` : "") +
          `import { cache } from "@/static/edge/request-cache";`;
        contents = contents.replace(REACT_CACHE_IMPORT, replacement);
      }
      return { contents, loader: args.path.endsWith(".tsx") ? "tsx" : "ts" };
    });
  },
};

/** @param {{ outDir?: string }} [options] `outDir` padrão: `out/edge` (testes passam um temporário). */
export async function buildEdgeActions({ outDir = defaultOutDir } = {}) {
  const privileged = await findPrivilegedActions(srcDir);
  const modules = Object.keys(privileged).filter((module) => !NOT_SERVED.has(module));
  const entry = [
    `import { serveActions } from "@/static/edge/entry";`,
    `import { drainAutoReviewReconciliation } from "@/static/edge/internal";`,
    ...modules.map((module, index) => `import * as m${index} from "@/actions/${module}";`),
    `serveActions({`,
    ...modules.map((module, index) => `  ${JSON.stringify(module)}: m${index},`),
    `  internal: { drainAutoReviewReconciliation },`,
    `});`,
  ].join("\n");

  mkdirSync(path.join(outDir, "actions"), { recursive: true });
  const outfile = path.join(outDir, "actions/index.js");
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: srcDir, sourcefile: "edge-actions-entry.ts", loader: "ts" },
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    // Com os pacotes npm dentro (supabase-js, zod), o arquivo sem minificar
    // passa de 1,6 MB, perto do teto de 2 MB que a função de setup aceita no
    // deploy. Nomes preservados para as mensagens de erro do log.
    minify: true,
    keepNames: true,
    outfile,
    metafile: true,
    mainFields: ["module", "main"],
    conditions: ["deno", "worker", "import", "default"],
    external: ["node:*"],
    jsx: "automatic",
    resolveExtensions: [".ts", ".tsx", ".js", ".mjs"],
    define: { "process.env.NODE_ENV": '"production"' },
    banner: {
      js: [
        "// Gerado por scripts/static/build-edge-actions.mjs — não editar.",
        "globalThis.process ??= { env: Deno.env.toObject() };",
      ].join("\n"),
    },
    plugins: [sourceAliasPlugin(srcDir, EDGE_ALIASES, { externalPackages: false }), requestCachePlugin],
    logLevel: "warning",
  });

  const inputs = Object.keys(result.metafile.inputs).map(toPosix);
  const leaked = inputs.filter((input) =>
    /node_modules\/@clerk\/|lib\/clerk-sync\.ts$|lib\/identity\/server\.ts$/.test(input),
  );
  if (leaked.length) throw new Error(`Módulo do Clerk no bundle da Edge Function: ${leaked.join(", ")}`);

  const cliDir = path.join(outDir, "supabase/functions/actions");
  mkdirSync(cliDir, { recursive: true });
  copyFileSync(outfile, path.join(cliDir, "index.ts"));
  return { modules, outfile, bytes: Object.values(result.metafile.outputs)[0].bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { modules, outfile, bytes } = await buildEdgeActions();
  console.log(
    `Edge Function actions: ${modules.join(", ")} → ${path.relative(frontendDir, outfile)} (${Math.round(bytes / 1024)} kB)`,
  );
}
