// Descobre quais módulos de `src/actions` alcançam a service role.
//
// No modo estático as Server Actions rodam no navegador, com o JWT do usuário
// e a RLS como fronteira — exceto as que, direta ou transitivamente, usam
// `createSupabaseAdmin` (`src/lib/supabase/admin.ts`). Essas rodam na Edge
// Function `actions` do projeto Supabase do grupo, com o mesmo código e os
// mesmos gates de hoje. A lista é calculada a cada build pelo grafo real de
// imports (esbuild), não mantida à mão: um módulo que passe a importar o admin
// muda de lado sozinho, e nunca leva a chave para o navegador.

import * as esbuild from "esbuild";
import { readdirSync } from "node:fs";
import path from "node:path";
import { ANALYSIS_ALIASES } from "./aliases.mjs";

const toPosix = (p) => p.split(path.sep).join("/").split("\\").join("/");

/**
 * Aplica as trocas do modo estático e resolve `@/x` para `src/x`, como o
 * tsconfig; demais pacotes ficam externos.
 */
export function sourceAliasPlugin(srcDir, aliases = ANALYSIS_ALIASES) {
  const frontendDir = path.dirname(srcDir);
  return {
    name: "source-alias",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        const target = aliases[args.path];
        return target ? { path: path.join(frontendDir, target) } : undefined;
      });
      build.onResolve({ filter: /^@\// }, (args) =>
        build.resolve("./" + args.path.slice(2), { resolveDir: srcDir, kind: args.kind }),
      );
      build.onResolve({ filter: /^[^./]/ }, (args) =>
        args.path.startsWith("@/") || args.kind === "entry-point" || path.isAbsolute(args.path)
          ? undefined
          : { path: args.path, external: true },
      );
    },
  };
}

async function analyze(entry, srcDir) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    platform: "neutral",
    format: "esm",
    logLevel: "silent",
    resolveExtensions: [".ts", ".tsx", ".js", ".mjs"],
    loader: { ".tsx": "tsx", ".ts": "ts" },
    jsx: "automatic",
    plugins: [sourceAliasPlugin(srcDir)],
  });
  const inputs = Object.keys(result.metafile.inputs).map(toPosix);
  const output = Object.values(result.metafile.outputs)[0];
  return {
    usesAdmin: inputs.some((input) => input.endsWith("lib/supabase/admin.ts")),
    exports: output.exports.filter((name) => name !== "default"),
  };
}

/**
 * @param {string} srcDir caminho absoluto de `frontend/src`
 * @returns {Promise<Record<string, string[]>>} módulo (sem extensão) → exports
 */
export async function findPrivilegedActions(srcDir) {
  const actionsDir = path.join(srcDir, "actions");
  const files = readdirSync(actionsDir).filter((file) => /\.ts$/.test(file) && !file.endsWith(".d.ts"));
  const privileged = {};
  for (const file of files.sort()) {
    const info = await analyze(path.join(actionsDir, file), srcDir);
    if (info.usesAdmin) privileged[file.replace(/\.ts$/, "")] = info.exports;
  }
  return privileged;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("privileged-actions.mjs")) {
  const srcDir = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../src");
  const privileged = await findPrivilegedActions(srcDir);
  for (const [module, names] of Object.entries(privileged)) {
    console.log(`${module}: ${names.join(", ")}`);
  }
}
