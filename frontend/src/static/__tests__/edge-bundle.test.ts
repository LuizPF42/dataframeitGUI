import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildEdgeActions } from "../../../scripts/static/build-edge-actions.mjs";

// O bundle da Edge Function é publicado como um arquivo só (pela CLI ou pela
// op `deploy` do assistente, sem deno.json). Dois defeitos passaram pelos
// testes unitários e só apareceram no deploy real: pacotes npm saíam como
// import sem prefixo ("react", "zod"), que o Deno do Supabase recusa ao
// empacotar; e o shim de `next/navigation` do navegador entrava no bundle e
// lia `window.location` ao carregar, o que derrubaria o isolate no boot.

/** Teto do corpo da op `deploy` em `supabase/functions/static-setup/logica.mjs` (CODE_MAX). */
const SETUP_CODE_MAX = 2 * 1024 * 1024;

let dir: string;
let code: string;
let file: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), "edge-bundle-"));
  const { outfile } = (await buildEdgeActions({ outDir: dir })) as { outfile: string };
  file = outfile;
  code = readFileSync(outfile, "utf8");
}, 60_000);

afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("bundle da Edge Function actions", () => {
  it("só importa módulos embutidos (node:*), nunca pacote sem prefixo", () => {
    const specifiers = [
      ...code.matchAll(/\bfrom\s*"([^"]+)"/g),
      ...code.matchAll(/\bimport\s*\(\s*"([^"]+)"\s*\)/g),
      ...code.matchAll(/\bimport\s*"([^"]+)"/g),
    ].map((match) => match[1]);
    expect(specifiers.filter((specifier) => !specifier.startsWith("node:"))).toEqual([]);
  });

  it("não carrega código que só existe no navegador ou no Vite", () => {
    expect(code).not.toContain("import.meta.env");
    expect(code).not.toContain("src/static/shims/next-navigation");
  });

  it("cabe no deploy pelo assistente", () => {
    expect(Buffer.byteLength(code)).toBeLessThan(SETUP_CODE_MAX);
  });

  it("inicializa sem window e registra o handler no Deno.serve", async () => {
    const serve = vi.fn();
    const values: Record<string, string> = {
      SUPABASE_URL: "https://exemplo.supabase.co",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    };
    vi.stubGlobal("Deno", {
      serve,
      env: { get: (key: string) => values[key], toObject: () => ({ ...values }) },
    });
    expect(typeof (globalThis as { window?: unknown }).window).toBe("undefined");
    await import(/* @vite-ignore */ pathToFileURL(file).href);
    expect(serve).toHaveBeenCalledTimes(1);
    expect(typeof serve.mock.calls[0][0]).toBe("function");
  });
});
