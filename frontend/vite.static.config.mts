// Build do modo estático (GitHub Pages + Supabase do grupo).
//
//   npm run build:static        → gera `out/` (site) e `out/edge/actions.js`
//   npm run dev:static          → servidor local em http://localhost:5173
//
// O site reaproveita `src/app`, `src/components`, `src/lib` e `src/actions` do
// modo hospedado. As diferenças de infraestrutura são trocas de módulo
// declaradas em `scripts/static/aliases.mjs`; as actions que precisam da
// service role viram chamadas à Edge Function `actions` (ver
// `scripts/static/privileged-actions.mjs`).

import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { BROWSER_ALIASES } from "./scripts/static/aliases.mjs";
import { findPrivilegedActions } from "./scripts/static/privileged-actions.mjs";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(frontendDir, "src");
const outDir = path.join(frontendDir, "out");
const toPosix = (p: string) => p.split(path.sep).join("/");

/** Actions privilegiadas → proxies que chamam a Edge Function. */
function edgeActionsPlugin(): Plugin {
  let privileged: Record<string, string[]> = {};
  const actionsDir = toPosix(path.join(srcDir, "actions"));
  return {
    name: "dataframeit-edge-actions",
    enforce: "pre",
    async buildStart() {
      privileged = await findPrivilegedActions(srcDir);
    },
    load(id) {
      const file = toPosix(id.split("?")[0]);
      if (!file.startsWith(actionsDir + "/")) return null;
      const moduleName = file.slice(actionsDir.length + 1).replace(/\.ts$/, "");
      const names = privileged[moduleName];
      if (!names) return null;
      const lines = [
        `// Gerado pelo build estático: \`${moduleName}\` usa a service role e roda na Edge Function.`,
        `import { invokeEdgeAction } from "@/static/edge-client";`,
        ...names.map(
          (name) =>
            `export async function ${name}(...args) { return invokeEdgeAction(${JSON.stringify(moduleName)}, ${JSON.stringify(name)}, args); }`,
        ),
      ];
      return lines.join("\n");
    },
  };
}

/** `cache` do React → cache por resolução de rota (ver runtime/request-cache). */
function requestCachePlugin(): Plugin {
  return {
    name: "dataframeit-request-cache",
    enforce: "pre",
    transform(code, id) {
      if (!toPosix(id).startsWith(toPosix(srcDir)) || !/import\s*\{[^}]*\bcache\b[^}]*\}\s*from\s*"react"/.test(code)) {
        return null;
      }
      return code.replace(/import\s*\{([^}]*)\}\s*from\s*"react";?/, (_match, names: string) => {
        const rest = names
          .split(",")
          .map((name) => name.trim())
          .filter((name) => name && name !== "cache");
        const reactImport = rest.length ? `import { ${rest.join(", ")} } from "react";` : "";
        return `${reactImport}import { cache } from "@/static/runtime/request-cache";`;
      });
    },
  };
}

/** Falha o build se a service role ou o Clerk entrarem no grafo do navegador. */
function boundaryGuardPlugin(): Plugin {
  const forbidden = [
    toPosix(path.join(srcDir, "lib/supabase/admin.ts")),
    toPosix(path.join(srcDir, "lib/identity/server.ts")),
    toPosix(path.join(srcDir, "lib/clerk-sync.ts")),
  ];
  return {
    name: "dataframeit-boundary-guard",
    buildEnd() {
      const ids = [...this.getModuleIds()].map((id) => toPosix(id.split("?")[0]));
      const leaked = ids.filter((id) => forbidden.includes(id) || id.includes("/node_modules/@clerk/"));
      if (leaked.length) {
        this.error(`Módulo proibido no bundle do navegador: ${leaked.join(", ")}`);
      }
    },
  };
}

/** GitHub Pages: rota profunda cai no 404.html, que precisa ser o próprio app. */
function spaFallbackPlugin(): Plugin {
  return {
    name: "dataframeit-spa-fallback",
    apply: "build",
    closeBundle() {
      const index = path.join(outDir, "index.html");
      if (existsSync(index)) copyFileSync(index, path.join(outDir, "404.html"));
    },
  };
}

const exactAliases = Object.entries(BROWSER_ALIASES).map(([find, target]) => ({
  find: new RegExp(`^${find.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`),
  replacement: path.join(frontendDir, target),
}));

export default defineConfig(({ mode }) => ({
  root: path.join(frontendDir, "static"),
  base: process.env.STATIC_BASE_PATH ?? "/",
  envDir: frontendDir,
  publicDir: path.join(frontendDir, "static/public"),
  plugins: [edgeActionsPlugin(), requestCachePlugin(), boundaryGuardPlugin(), spaFallbackPlugin()],
  resolve: {
    alias: [
      ...exactAliases,
      { find: /^@\//, replacement: srcDir + "/" },
    ],
  },
  define: {
    // Código compartilhado lê `process.env.X` (flags opcionais do servidor);
    // no navegador todas valem `undefined`.
    "process.env": JSON.stringify({ NODE_ENV: mode === "production" ? "production" : "development" }),
  },
  esbuild: { jsx: "automatic" },
  worker: { format: "es" },
  build: {
    outDir,
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    target: "es2022",
    rollupOptions: {
      onwarn(warning, warn) {
        // "use client"/"use server" são diretivas do Next; num SPA não há
        // fronteira servidor/cliente a preservar, e o aviso se repetiria por
        // componente.
        if (warning.code === "MODULE_LEVEL_DIRECTIVE") return;
        warn(warning);
      },
    },
  },
  // `backend/services/*.py` entra no worker Pyodide como texto (`?raw`).
  server: { port: 5173, fs: { allow: [path.resolve(frontendDir, "..")] } },
}));
